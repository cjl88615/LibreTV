const state = {
  config: null,
  recommendType: 'movie',
  recommendTag: '热门',
  recommendStart: 0,
  liveChannels: [],
  liveLoaded: false,
  currentLiveMeta: null,
  detail: null,
  detailLine: 0,
  vodHls: null,
  liveHls: null,
  bound: false
};

const TAGS = {
  movie: ['热门', '最新', '豆瓣高分', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑'],
  tv: ['热门', '国产剧', '美剧', '英剧', '韩剧', '日剧', '港剧', '日本动画', '综艺', '纪录片']
};

const PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <rect width="400" height="600" fill="#171717"/>
  <text x="200" y="285" text-anchor="middle" fill="#666" font-size="36">Taliabu</text>
  <text x="200" y="335" text-anchor="middle" fill="#555" font-size="28">WebTV</text>
</svg>`)}`;

async function boot() {
  bindEvents();
  renderTags();
  await Promise.allSettled([loadConfig(), loadRecommendations()]);
}

function bindEvents() {
  if (state.bound) return;
  state.bound = true;

  document.getElementById('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const keyword = document.getElementById('searchInput').value.trim();
    if (keyword) searchVod(keyword, false);
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    state.recommendStart = 0;
    state.liveLoaded = false;
    await Promise.allSettled([loadConfig(), loadRecommendations()]);
    toast('已刷新');
  });

  document.getElementById('brandBtn').addEventListener('click', () => switchSection('home'));
  document.getElementById('nextBatchBtn').addEventListener('click', () => {
    state.recommendStart += 18;
    if (state.recommendStart > 162) state.recommendStart = 0;
    loadRecommendations();
  });
  document.getElementById('closeSearchBtn').addEventListener('click', () => {
    document.getElementById('searchSection').classList.add('hidden');
  });
  document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', event => {
    if (event.target.id === 'detailModal') closeDetail();
  });

  document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => switchSection(button.dataset.section));
  });

  document.getElementById('channelSearch').addEventListener('input', renderChannels);
  document.getElementById('liveSourceSelect').addEventListener('change', event => loadLiveSource(Number(event.target.value || 0)));
}

async function loadConfig() {
  setSourceStatus('正在读取 TVBox 配置…');
  try {
    const data = await fetchJson('/tvbox/config');
    state.config = data;
    document.getElementById('miniSourceStatus').textContent = `${data.stats?.sites ?? 0} 个站点 · ${data.stats?.liveSources ?? 0} 个直播源`;
    document.getElementById('sourceUrl').textContent = data.source || '-';
    document.getElementById('sourceTime').textContent = `最近读取：${formatTime(data.fetchedAt)}`;
    document.getElementById('siteCount').textContent = data.stats?.sites ?? 0;
    document.getElementById('liveSourceCount').textContent = data.stats?.liveSources ?? 0;
    document.getElementById('jarCount').textContent = data.stats?.jarSites ?? 0;
    document.getElementById('jsCount').textContent = data.stats?.jsSites ?? 0;
    document.getElementById('webCount').textContent = data.stats?.webSites ?? 0;
    setSourceStatus('TVBox 配置读取正常。网页点播使用可播放适配层；直播继续读取 TVBox lives。');
    renderSourceSites(data.sites || []);
    renderLiveSources(data.lives || []);
  } catch (error) {
    document.getElementById('miniSourceStatus').textContent = 'TVBox 源连接失败';
    setSourceStatus(`配置读取失败：${error.message}`, true);
  }
}

function renderTags() {
  const bar = document.getElementById('tagBar');
  bar.innerHTML = '';
  TAGS[state.recommendType].forEach(tag => {
    const button = document.createElement('button');
    button.className = `tag-btn shrink-0 px-3.5 py-1.5 rounded-full border text-sm ${tag === state.recommendTag ? 'active' : 'border-[#333] bg-[#161616] text-gray-300'}`;
    button.textContent = tag;
    button.addEventListener('click', () => {
      state.recommendTag = tag;
      state.recommendStart = 0;
      renderTags();
      loadRecommendations();
    });
    bar.appendChild(button);
  });
}

async function loadRecommendations() {
  const grid = document.getElementById('recommendGrid');
  const status = document.getElementById('recommendStatus');
  document.getElementById('recommendTitle').textContent = `${state.recommendTag}${state.recommendType === 'movie' ? '电影' : '电视剧'}`;
  status.textContent = '正在获取最新推荐…';
  grid.innerHTML = skeletonCards(14);

  try {
    const params = new URLSearchParams({
      type: state.recommendType,
      tag: state.recommendTag,
      start: String(state.recommendStart),
      limit: '18'
    });
    const data = await fetchJson(`/webtv/recommend?${params.toString()}`);
    renderRecommendationCards(data.items || []);
    status.textContent = `${data.items?.length || 0} 部 · 更新于 ${formatTime(data.fetchedAt)}`;
  } catch (error) {
    grid.innerHTML = emptyBox(`热门推荐读取失败：${error.message}`);
    status.textContent = '推荐加载失败，可直接使用顶部搜索。';
  }
}

function renderRecommendationCards(items) {
  const grid = document.getElementById('recommendGrid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = emptyBox('当前标签没有推荐内容');
    return;
  }
  items.forEach(item => {
    const card = createPosterCard({
      title: item.title,
      pic: item.cover,
      badge: item.rate ? `★ ${item.rate}` : (item.isNew ? '新' : ''),
      sub: state.recommendType === 'movie' ? '电影' : '电视剧'
    });
    card.addEventListener('click', () => openRecommendation(item));
    grid.appendChild(card);
  });
}

async function openRecommendation(item) {
  toast(`正在匹配《${item.title}》的可播放线路…`);
  const results = await searchVod(item.title, true);
  if (!results.length) return;
  const exact = results.find(v => compact(v.name) === compact(item.title)) || results[0];
  await openDetail(exact);
}

async function searchVod(keyword, quietAutoOpen = false) {
  const section = document.getElementById('searchSection');
  const grid = document.getElementById('searchGrid');
  const status = document.getElementById('searchStatus');
  document.getElementById('searchTitle').textContent = `“${keyword}” 的结果`;
  section.classList.remove('hidden');
  status.textContent = '正在从可播放线路搜索…';
  grid.innerHTML = skeletonCards(8);
  if (!quietAutoOpen) section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const data = await fetchJson(`/webtv/search?wd=${encodeURIComponent(keyword)}`);
    const results = data.results || [];
    renderSearchResults(results);
    const bad = (data.errors || []).length;
    status.textContent = results.length ? `找到 ${results.length} 个结果${bad ? ` · ${bad} 个源超时/失败` : ''}` : '没有找到可播放结果';
    if (!results.length && quietAutoOpen) toast('没有匹配到可播放线路，请换一个标题或稍后重试');
    return results;
  } catch (error) {
    grid.innerHTML = emptyBox(`搜索失败：${error.message}`);
    status.textContent = '搜索失败';
    if (quietAutoOpen) toast(`搜索失败：${error.message}`);
    return [];
  }
}

function renderSearchResults(results) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  if (!results.length) {
    grid.innerHTML = emptyBox('没有匹配到可播放资源');
    return;
  }
  results.forEach(item => {
    const card = createPosterCard({
      title: item.name,
      pic: item.pic,
      badge: item.remarks || item.year || '',
      sub: `${item.sourceName}${item.year ? ` · ${item.year}` : ''}`
    });
    card.addEventListener('click', () => openDetail(item));
    grid.appendChild(card);
  });
}

async function openDetail(item) {
  const modal = document.getElementById('detailModal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('detailTitle').textContent = '正在读取详情…';
  document.getElementById('detailSource').textContent = item.sourceName || '';
  document.getElementById('detailPoster').src = imageUrl(item.pic);
  document.getElementById('detailPoster').onerror = event => { event.currentTarget.src = PLACEHOLDER; };
  document.getElementById('detailMeta').textContent = '';
  document.getElementById('detailPeople').textContent = '';
  document.getElementById('detailContent').textContent = '';
  document.getElementById('lineTabs').innerHTML = '';
  document.getElementById('episodeList').innerHTML = '<div class="col-span-full text-gray-500 py-5">正在读取播放线路…</div>';
  resetVodPlayer();

  try {
    const data = await fetchJson(`/webtv/detail?source=${encodeURIComponent(item.sourceKey)}&id=${encodeURIComponent(item.id)}`);
    state.detail = data.vod;
    state.detailLine = 0;
    renderDetail();
  } catch (error) {
    document.getElementById('detailTitle').textContent = item.name || '详情读取失败';
    document.getElementById('episodeList').innerHTML = `<div class="col-span-full text-red-400 py-5">${escapeHtml(error.message)}</div>`;
  }
}

function renderDetail() {
  const vod = state.detail;
  if (!vod) return;
  const poster = document.getElementById('detailPoster');
  poster.src = imageUrl(vod.pic);
  poster.onerror = event => { event.currentTarget.src = PLACEHOLDER; };
  document.getElementById('detailSource').textContent = `播放来源：${vod.sourceName}`;
  document.getElementById('detailTitle').textContent = vod.name || '未命名';
  document.getElementById('detailMeta').textContent = [vod.typeName, vod.year, vod.area, vod.remarks].filter(Boolean).join(' · ');
  document.getElementById('detailPeople').textContent = [vod.director ? `导演：${vod.director}` : '', vod.actor ? `主演：${vod.actor}` : ''].filter(Boolean).join('  ');
  document.getElementById('detailContent').textContent = vod.content || '暂无简介';

  const tabs = document.getElementById('lineTabs');
  tabs.innerHTML = '';
  (vod.lines || []).forEach((line, index) => {
    const button = document.createElement('button');
    button.className = `line-btn shrink-0 px-3 py-1.5 rounded-lg border text-sm ${index === state.detailLine ? 'active' : 'border-[#333] bg-[#171717]'}`;
    button.textContent = `${line.name} (${line.episodes.length})`;
    button.addEventListener('click', () => {
      state.detailLine = index;
      renderDetail();
    });
    tabs.appendChild(button);
  });

  const episodes = document.getElementById('episodeList');
  episodes.innerHTML = '';
  const line = vod.lines?.[state.detailLine];
  if (!line?.episodes?.length) {
    episodes.innerHTML = '<div class="col-span-full text-gray-500 py-5">这个资源没有返回剧集/播放地址</div>';
    return;
  }
  line.episodes.forEach(ep => {
    const button = document.createElement('button');
    button.className = 'px-2 py-2 rounded-lg bg-[#171717] border border-[#333] hover:border-violet-500 text-sm truncate';
    button.textContent = ep.name;
    button.title = ep.name;
    button.addEventListener('click', () => playVodEpisode(ep, line));
    episodes.appendChild(button);
  });
}

function playVodEpisode(ep, line) {
  const raw = String(ep.url || '').trim();
  const box = document.getElementById('vodPlayerBox');
  const video = document.getElementById('vodVideo');
  const hint = document.getElementById('vodPlayerHint');
  box.classList.remove('hidden');
  document.getElementById('vodPlayingName').textContent = `${state.detail?.name || ''} · ${line.name} · ${ep.name}`;
  resetHls('vod');
  video.pause();
  video.removeAttribute('src');
  video.load();
  hint.classList.add('hidden');
  hint.classList.remove('flex');

  if (!/^https?:\/\//i.test(raw)) {
    showVodHint('这个剧集返回的是 TVBox 内部播放 ID，需要 Spider 的 playerContent() 二次解析；请先换另一条线路。');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const proxied = streamUrl(raw);
  const lower = raw.toLowerCase();
  if (lower.includes('.m3u8') && window.Hls && Hls.isSupported()) {
    state.vodHls = new Hls({ enableWorker: true, lowLatencyMode: false });
    state.vodHls.loadSource(proxied);
    state.vodHls.attachMedia(video);
    state.vodHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    state.vodHls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) showVodHint('该线路播放失败，请换线路或换集。');
    });
  } else {
    video.src = proxied;
    video.play().catch(() => {});
    video.onerror = () => showVodHint('浏览器无法直接播放这个地址，请换另一条线路。');
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showVodHint(message) {
  const hint = document.getElementById('vodPlayerHint');
  hint.textContent = message;
  hint.classList.remove('hidden');
  hint.classList.add('flex');
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.detail = null;
  resetVodPlayer();
}

function resetVodPlayer() {
  resetHls('vod');
  const video = document.getElementById('vodVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  document.getElementById('vodPlayerBox').classList.add('hidden');
  const hint = document.getElementById('vodPlayerHint');
  hint.classList.add('hidden');
  hint.classList.remove('flex');
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
    const data = await fetchJson(`/tvbox/live?source=${encodeURIComponent(index)}`);
    state.liveChannels = data.channels || [];
    state.currentLiveMeta = state.config?.lives?.[index] || null;
    state.liveLoaded = true;
    document.getElementById('liveInfo').textContent = `${data.name} · ${state.liveChannels.length} 个频道`;
    renderChannels();
  } catch (error) {
    state.liveChannels = [];
    document.getElementById('liveInfo').textContent = '加载失败';
    list.innerHTML = `<div class="text-center text-red-400 py-10 px-4">${escapeHtml(error.message)}</div>`;
  }
}

function renderChannels() {
  const query = document.getElementById('channelSearch').value.trim().toLowerCase();
  const list = document.getElementById('channelList');
  const filtered = state.liveChannels.filter(item => !query || `${item.name} ${item.group}`.toLowerCase().includes(query));
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
      button.innerHTML = `<div class="font-medium text-sm truncate">${escapeHtml(channel.name)}</div>`;
      button.addEventListener('click', () => playLiveChannel(channel, button));
      list.appendChild(button);
    });
  });
}

function playLiveChannel(channel, button) {
  document.querySelectorAll('.channel.active').forEach(el => el.classList.remove('active'));
  button.classList.add('active');
  document.getElementById('liveNowPlaying').textContent = `${channel.group || '未分类'} · ${channel.name}`;
  const hint = document.getElementById('livePlayerHint');
  hint.classList.add('hidden');
  resetHls('live');
  const video = document.getElementById('liveVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();

  const proxied = streamUrl(channel.url, state.currentLiveMeta?.ua || '');
  if (window.Hls && Hls.isSupported()) {
    state.liveHls = new Hls({ enableWorker: true, lowLatencyMode: true });
    state.liveHls.loadSource(proxied);
    state.liveHls.attachMedia(video);
    state.liveHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    state.liveHls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        hint.textContent = '直播播放失败，这个频道可能需要特殊 Referer、Cookie 或 TVBox 嗅探。';
        hint.classList.remove('hidden');
      }
    });
  } else {
    video.src = proxied;
    video.play().catch(() => {});
  }
}

function renderSourceSites(sites) {
  const container = document.getElementById('siteList');
  container.innerHTML = sites.map(site => {
    const badge = site.runtime === 'jar' ? 'JAR Spider' : site.runtime === 'js' ? 'JS Spider' : site.runtime === 'web' ? 'Web/CMS' : '未知';
    return `<div class="border border-[#2c2c2c] rounded-xl p-3 bg-[#151515]">
      <div class="flex items-start justify-between gap-2"><div class="font-medium">${escapeHtml(site.name)}</div><span class="text-[11px] text-violet-300 shrink-0">${badge}</span></div>
      <div class="mt-2 text-[11px] text-gray-600 font-mono break-all">${escapeHtml(site.api || '')}</div>
    </div>`;
  }).join('');
}

async function switchSection(section) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.section === section));
  const home = document.getElementById('homeSection');
  const live = document.getElementById('liveSection');
  const sources = document.getElementById('sourcesSection');
  home.classList.add('hidden');
  live.classList.add('hidden');
  sources.classList.add('hidden');

  if (section === 'live') {
    live.classList.remove('hidden');
    if (!state.liveLoaded && (state.config?.lives || []).length) await loadLiveSource(Number(document.getElementById('liveSourceSelect').value || 0));
    return;
  }
  if (section === 'sources') {
    sources.classList.remove('hidden');
    return;
  }

  home.classList.remove('hidden');
  if (section === 'movie' || section === 'tv') {
    state.recommendType = section;
    state.recommendTag = '热门';
    state.recommendStart = 0;
    renderTags();
    await loadRecommendations();
  } else if (section === 'home') {
    state.recommendType = 'movie';
    state.recommendTag = '热门';
    state.recommendStart = 0;
    renderTags();
    await loadRecommendations();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createPosterCard({ title, pic, badge, sub }) {
  const card = document.createElement('button');
  card.className = 'movie-card text-left border border-[#252525] rounded-xl overflow-hidden bg-[#111]';
  const img = document.createElement('img');
  img.className = 'poster w-full';
  img.loading = 'lazy';
  img.alt = title;
  img.src = imageUrl(pic);
  img.onerror = () => { img.src = PLACEHOLDER; };
  const body = document.createElement('div');
  body.className = 'p-2.5';
  body.innerHTML = `<div class="font-medium text-sm line-clamp-2 min-h-[2.5rem]">${escapeHtml(title)}</div>
    <div class="mt-1.5 flex items-center justify-between gap-2 text-[11px]"><span class="text-gray-500 truncate">${escapeHtml(sub || '')}</span><span class="text-amber-400 shrink-0">${escapeHtml(badge || '')}</span></div>`;
  card.append(img, body);
  return card;
}

function imageUrl(url) {
  if (!url) return PLACEHOLDER;
  return `/webtv/image?url=${encodeURIComponent(url)}`;
}

function streamUrl(url, ua = '') {
  const params = new URLSearchParams({ url });
  if (ua) params.set('ua', ua);
  return `/webtv/stream?${params.toString()}`;
}

function resetHls(kind) {
  const key = kind === 'live' ? 'liveHls' : 'vodHls';
  if (state[key]) {
    state[key].destroy();
    state[key] = null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error(`服务器返回非 JSON：${text.slice(0, 100)}`); }
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setSourceStatus(message, error = false) {
  const el = document.getElementById('sourceStatus');
  el.textContent = message;
  el.className = `mt-4 text-sm ${error ? 'text-red-400' : 'text-gray-400'}`;
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => '<div class="rounded-xl overflow-hidden border border-[#222] bg-[#111] animate-pulse"><div class="poster bg-[#1b1b1b]"></div><div class="p-3"><div class="h-3 bg-[#222] rounded"></div><div class="h-3 bg-[#1b1b1b] rounded mt-2 w-2/3"></div></div></div>').join('');
}

function emptyBox(message) {
  return `<div class="col-span-full panel p-8 text-center text-gray-500">${escapeHtml(message)}</div>`;
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/[\s·・:：,，.。!！?？\-—_()（）\[\]【】]/g, '');
}

function formatTime(value) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return value; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.getElementById('detailModal').classList.contains('hidden')) closeDetail();
});

document.addEventListener('DOMContentLoaded', boot);
