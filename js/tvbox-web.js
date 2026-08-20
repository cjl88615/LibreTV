let tvboxConfig = null;
let liveChannels = [];
let currentHls = null;
let currentRuntimeFilter = 'all';

async function bootWebTV() {
  await loadConfig();
  bindEvents();
}

async function loadConfig() {
  setStatus('正在读取 TVBox 配置…');
  try {
    const response = await fetch('/tvbox/config', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '配置读取失败');
    tvboxConfig = data;
    renderConfigSummary(data);
    renderSites();
    renderLiveSources(data.lives || []);
    if ((data.lives || []).length > 0) await loadLiveSource(0);
    setStatus('TVBox 配置读取成功。直播已启用；JAR/JS 点播源当前先展示兼容状态。');
  } catch (error) {
    setStatus(`读取失败：${error.message}`, true);
    document.getElementById('channelList').innerHTML = '<div class="text-center text-red-400 py-10">直播源加载失败</div>';
    document.getElementById('siteList').innerHTML = '<div class="text-red-400">TVBox 配置加载失败。</div>';
  }
}

function renderConfigSummary(data) {
  document.getElementById('sourceUrl').textContent = data.source || '-';
  document.getElementById('sourceTime').textContent = `最近读取：${formatTime(data.fetchedAt)}`;
  document.getElementById('siteCount').textContent = data.stats?.sites ?? 0;
  document.getElementById('liveSourceCount').textContent = data.stats?.liveSources ?? 0;
  document.getElementById('jarCount').textContent = data.stats?.jarSites ?? 0;
  document.getElementById('jsCount').textContent = data.stats?.jsSites ?? 0;
  document.getElementById('webCount').textContent = data.stats?.webSites ?? 0;
}

function renderLiveSources(lives) {
  const select = document.getElementById('liveSourceSelect');
  select.innerHTML = '';
  lives.forEach((live, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = live.name || `直播源 ${index + 1}`;
    select.appendChild(option);
  });
}

async function loadLiveSource(index) {
  const list = document.getElementById('channelList');
  list.innerHTML = '<div class="text-center text-gray-500 py-10">正在读取直播频道…</div>';
  document.getElementById('liveInfo').textContent = '正在加载…';
  try {
    const response = await fetch(`/tvbox/live?source=${encodeURIComponent(index)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '直播源读取失败');
    liveChannels = data.channels || [];
    document.getElementById('liveInfo').textContent = `${data.name} · ${liveChannels.length} 个频道`;
    renderChannels();
  } catch (error) {
    liveChannels = [];
    document.getElementById('liveInfo').textContent = '加载失败';
    list.innerHTML = `<div class="text-center text-red-400 py-10 px-4">${escapeHtml(error.message)}</div>`;
  }
}

function renderChannels() {
  const query = document.getElementById('channelSearch').value.trim().toLowerCase();
  const list = document.getElementById('channelList');
  const filtered = liveChannels.filter(item => !query || `${item.name} ${item.group}`.toLowerCase().includes(query));

  if (!filtered.length) {
    list.innerHTML = '<div class="text-center text-gray-500 py-10">没有匹配频道</div>';
    return;
  }

  const groups = new Map();
  filtered.forEach(channel => {
    const group = channel.group || '未分类';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(channel);
  });

  list.innerHTML = '';
  groups.forEach((channels, group) => {
    const title = document.createElement('div');
    title.className = 'px-2 pt-3 pb-1 text-xs text-gray-500 sticky top-0 bg-[#111]';
    title.textContent = `${group} (${channels.length})`;
    list.appendChild(title);

    channels.forEach(channel => {
      const button = document.createElement('button');
      button.className = 'channel w-full text-left border border-transparent rounded-lg px-3 py-2.5 mb-1';
      button.dataset.url = channel.url;
      button.innerHTML = `<div class="font-medium text-sm truncate">${escapeHtml(channel.name)}</div><div class="text-[11px] text-gray-600 truncate">${escapeHtml(channel.url)}</div>`;
      button.addEventListener('click', () => playChannel(channel, button));
      list.appendChild(button);
    });
  });
}

function playChannel(channel, button) {
  document.querySelectorAll('.channel.active').forEach(el => el.classList.remove('active'));
  button?.classList.add('active');

  const video = document.getElementById('video');
  const hint = document.getElementById('playerHint');
  const external = document.getElementById('openExternal');
  document.getElementById('nowPlaying').textContent = `${channel.group || '未分类'} · ${channel.name}`;
  hint.classList.add('hidden');
  external.href = channel.url;
  external.classList.remove('hidden');

  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();

  const lower = channel.url.toLowerCase();
  if (lower.includes('.m3u8') && window.Hls && Hls.isSupported()) {
    currentHls = new Hls({ enableWorker: true, lowLatencyMode: true });
    currentHls.loadSource(channel.url);
    currentHls.attachMedia(video);
    currentHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    currentHls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) showPlayerMessage('播放失败：该频道可能存在跨域、HTTP 混合内容、Referer/UA 或鉴权限制。');
    });
    return;
  }

  video.src = channel.url;
  video.play().catch(() => showPlayerMessage('浏览器无法直接自动播放该频道，请点击播放按钮；若仍失败，可能需要代理/特殊请求头。'));
}

function showPlayerMessage(message) {
  const hint = document.getElementById('playerHint');
  hint.textContent = message;
  hint.classList.remove('hidden');
}

function renderSites() {
  const container = document.getElementById('siteList');
  const sites = (tvboxConfig?.sites || []).filter(site => currentRuntimeFilter === 'all' || site.runtime === currentRuntimeFilter);
  if (!sites.length) {
    container.innerHTML = '<div class="text-gray-500">没有匹配站点。</div>';
    return;
  }

  container.innerHTML = sites.map(site => {
    const badgeClass = site.runtime === 'jar' ? 'text-orange-300 border-orange-900/60 bg-orange-950/30' : site.runtime === 'js' ? 'text-blue-300 border-blue-900/60 bg-blue-950/30' : site.runtime === 'web' ? 'text-green-300 border-green-900/60 bg-green-950/30' : 'text-gray-400 border-gray-700 bg-gray-900';
    const state = site.runtime === 'jar' ? '待接入 JAR Runtime' : site.runtime === 'js' ? '待接入 JS Runtime' : site.runtime === 'web' ? '可继续做 Web 适配' : '待分析';
    return `<div class="site-card border border-[#2d2d2d] rounded-xl p-3 bg-[#121212]">
      <div class="flex items-start justify-between gap-2">
        <div class="font-medium break-words">${escapeHtml(site.name)}</div>
        <span class="shrink-0 text-[11px] px-2 py-1 rounded-full border ${badgeClass}">${escapeHtml(site.runtimeLabel)}</span>
      </div>
      <div class="mt-2 text-xs text-gray-500 font-mono break-all">${escapeHtml(site.api || '(无 api)')}</div>
      <div class="mt-3 flex items-center justify-between text-xs"><span class="text-gray-500">${escapeHtml(state)}</span><span class="text-gray-600">type=${site.type ?? '-'}</span></div>
    </div>`;
  }).join('');
}

function bindEvents() {
  document.getElementById('refreshBtn').addEventListener('click', loadConfig);
  document.getElementById('channelSearch').addEventListener('input', renderChannels);
  document.getElementById('liveSourceSelect').addEventListener('change', e => loadLiveSource(Number(e.target.value || 0)));
  document.querySelectorAll('.runtimeFilter').forEach(button => {
    button.addEventListener('click', () => {
      currentRuntimeFilter = button.dataset.runtime || 'all';
      document.querySelectorAll('.runtimeFilter').forEach(el => el.classList.remove('border-purple-500', 'text-purple-300'));
      button.classList.add('border-purple-500', 'text-purple-300');
      renderSites();
    });
  });
}

function setStatus(message, isError = false) {
  const box = document.getElementById('statusBox');
  box.textContent = message;
  box.className = `mt-4 text-sm ${isError ? 'text-red-400' : 'text-gray-400'}`;
}

function formatTime(value) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function startWhenAuthorized() {
  if (typeof isPasswordVerified === 'function' && !isPasswordVerified()) return;
  bootWebTV();
}

document.addEventListener('DOMContentLoaded', startWhenAuthorized);
document.addEventListener('passwordVerified', bootWebTV);
