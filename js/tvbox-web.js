const state = {
  config: null,
  runtime: { configured: false, connected: false },
  recommendType: 'movie',
  recommendTag: '热门',
  recommendStart: 0,
  liveChannels: [],
  liveLoaded: false,
  vodHls: null,
  liveHls: null,
  detail: null,
  detailLine: 0,
  detailMode: '',
  currentSource: null,
  lastKeyword: '',
  pendingRecommendation: null,
  bound: false
};

const TAGS = {
  movie: ['热门', '最新', '豆瓣高分', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑'],
  tv: ['热门', '国产剧', '美剧', '英剧', '韩剧', '日剧', '港剧', '日本动画', '综艺', '纪录片']
};

const PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#171717"/><text x="200" y="285" text-anchor="middle" fill="#666" font-size="36">Taliabu</text><text x="200" y="335" text-anchor="middle" fill="#555" font-size="28">WebTV</text></svg>`)}`;

async function boot() {
  bindEvents();
  renderTags();
  await Promise.allSettled([loadConfig(), loadRecommendations(), checkRuntime()]);
}

function bindEvents() {
  if (state.bound) return;
  state.bound = true;

  document.getElementById('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const keyword = document.getElementById('searchInput').value.trim();
    if (keyword) openSourcePicker(keyword);
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    state.recommendStart = 0;
    state.liveLoaded = false;
    await Promise.allSettled([loadConfig(), loadRecommendations(), checkRuntime()]);
    toast('已刷新 TVBox 配置与 Runtime 状态');
  });

  document.getElementById('brandBtn').addEventListener('click', () => switchSection('home'));
  document.getElementById('nextBatchBtn').addEventListener('click', () => {
    state.recommendStart += 18;
    if (state.recommendStart > 162) state.recommendStart = 0;
    loadRecommendations();
  });
  document.getElementById('closeSearchBtn').addEventListener('click', () => document.getElementById('searchSection').classList.add('hidden'));
  document.getElementById('changeSearchSourceBtn').addEventListener('click', () => state.lastKeyword && openSourcePicker(state.lastKeyword));

  document.getElementById('closeSourcePickerBtn').addEventListener('click', closeSourcePicker);
  document.getElementById('sourcePickerModal').addEventListener('click', event => {
    if (event.target.id === 'sourcePickerModal') closeSourcePicker();
  });
  document.getElementById('sourceFilterInput').addEventListener('input', renderSourcePicker);
  document.getElementById('fallbackCmsBtn').addEventListener('click', () => {
    if (!state.lastKeyword) return;
    closeSourcePicker();
    searchCmsFallback(state.lastKeyword);
  });

  document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', event => {
    if (event.target.id === 'detailModal') closeDetail();
  });
  document.getElementById('detailChangeSourceBtn').addEventListener('click', () => {
    const keyword = state.detail?.name || state.lastKeyword;
    if (keyword) {
      closeDetail();
      openSourcePicker(keyword);
    }
  });

  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => switchSection(button.dataset.section)));
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
    setSourceStatus('TVBox 配置读取正常。点播选源直接读取这里的 sites；直播继续读取 lives。');
    renderSourceSites(data.sites || []);
    renderLiveSources(data.lives || []);
    if (!document.getElementById('sourcePickerModal').classList.contains('hidden')) renderSourcePicker();
  } catch (error) {
    document.getElementById('miniSourceStatus').textContent = 'TVBox 源连接失败';
    setSourceStatus(`配置读取失败：${error.message}`, true);
  }
}

async function checkRuntime() {
  const badge = document.getElementById('runtimeStatusBadge');
  const text = document.getElementById('runtimeStatusText');
  const picker = document.getElementById('sourcePickerRuntime');
  try {
    const response = await fetch('/tvbox/spider/health', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    state.runtime = data;
    if (data.configured && data.connected) {
      badge.textContent = '● Runtime 已连接';
      badge.className = 'px-3 py-1.5 rounded-full text-xs border border-emerald-800 bg-emerald-950/40 text-emerald-300';
      text.textContent = `影视-K 已连接${data.client?.name ? `：${data.client.name}` : ''}${data.client?.ip ? ` · ${data.client.ip}` : ''}。饭太硬 JAR Spider 可直接调用。`;
      picker.textContent = '● Spider Runtime 已连接';
      picker.className = 'text-xs px-3 py-2 rounded-xl border border-emerald-800 bg-emerald-950/40 text-emerald-300';
    } else if (data.configured) {
      badge.textContent = '○ 等待影视-K';
      badge.className = 'px-3 py-1.5 rounded-full text-xs border border-amber-800 bg-amber-950/30 text-amber-300';
      text.textContent = data.error || 'Runtime 已配置，但影视-K Android 尚未连接。';
      picker.textContent = '○ Runtime 等待影视-K';
      picker.className = 'text-xs px-3 py-2 rounded-xl border border-amber-800 bg-amber-950/30 text-amber-300';
    } else {
      badge.textContent = '× Runtime 未配置';
      badge.className = 'px-3 py-1.5 rounded-full text-xs border border-red-900 bg-red-950/30 text-red-300';
      text.textContent = data.error || 'Cloudflare Pages 尚未配置 Spider Runtime。';
      picker.textContent = '× Spider Runtime 未配置';
      picker.className = 'text-xs px-3 py-2 rounded-xl border border-red-900 bg-red-950/30 text-red-300';
    }
  } catch (error) {
    state.runtime = { configured: false, connected: false, error: error.message };
    badge.textContent = '× Runtime 检查失败';
    text.textContent = error.message;
    picker.textContent = '× Runtime 检查失败';
  }
  if (!document.getElementById('sourcePickerModal').classList.contains('hidden')) renderSourcePicker();
  return state.runtime;
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
    const params = new URLSearchParams({ type: state.recommendType, tag: state.recommendTag, start: String(state.recommendStart), limit: '18' });
    const data = await fetchJson(`/webtv/recommend?${params}`);
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
  if (!items.length) return void (grid.innerHTML = emptyBox('当前标签没有推荐内容'));
  items.forEach(item => {
    const card = createPosterCard({ title: item.title, pic: item.cover, badge: item.rate ? `★ ${item.rate}` : (item.isNew ? '新' : ''), sub: state.recommendType === 'movie' ? '电影' : '电视剧' });
    card.addEventListener('click', () => openSourcePicker(item.title, item));
    grid.appendChild(card);
  });
}

async function openSourcePicker(keyword, recommendation = null) {
  state.lastKeyword = String(keyword || '').trim();
  state.pendingRecommendation = recommendation;
  if (!state.lastKeyword) return;
  if (!state.config) await loadConfig();
  await checkRuntime();
  document.getElementById('sourcePickerTitle').textContent = `《${state.lastKeyword}》 · 选择来源`;
  document.getElementById('sourceFilterInput').value = '';
  document.getElementById('sourcePickerModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderSourcePicker();
}

function closeSourcePicker() {
  document.getElementById('sourcePickerModal').classList.add('hidden');
  if (document.getElementById('detailModal').classList.contains('hidden')) document.body.style.overflow = '';
}

function renderSourcePicker() {
  const grid = document.getElementById('sourcePickerGrid');
  const hint = document.getElementById('sourcePickerHint');
  const query = document.getElementById('sourceFilterInput').value.trim().toLowerCase();
  const sites = (state.config?.sites || []).filter(site => site.searchable !== false && site.key && (!query || `${site.name} ${site.key} ${site.api}`.toLowerCase().includes(query)));
  grid.innerHTML = '';
  hint.textContent = `${sites.length} 个可搜索来源${state.runtime?.connected ? ' · Runtime 已连接，可逐个试源' : ' · 来源已全部列出，但 JAR 源需先连接 Spider Runtime'}`;
  if (!sites.length) return void (grid.innerHTML = emptyBox('没有匹配来源'));
  sites.forEach(site => {
    const button = document.createElement('button');
    const jarReady = site.runtime !== 'jar' || state.runtime?.connected;
    button.className = `source-card text-left rounded-xl border border-[#303030] bg-[#141414] p-3 ${jarReady ? '' : 'disabled'}`;
    const badge = site.runtime === 'jar' ? 'JAR' : site.runtime === 'js' ? 'JS' : site.runtime === 'web' ? 'WEB' : '?';
    button.innerHTML = `<div class="font-medium text-sm line-clamp-2">${escapeHtml(site.name)}</div><div class="mt-2 flex items-center justify-between gap-2"><span class="text-[10px] px-2 py-0.5 rounded-full border border-[#444] text-gray-400">${badge}</span><span class="text-[10px] ${jarReady ? 'text-emerald-400' : 'text-amber-400'}">${jarReady ? '点击搜索' : '需 Runtime'}</span></div>`;
    button.addEventListener('click', () => searchSpiderSource(site, state.lastKeyword));
    grid.appendChild(button);
  });
}

async function searchSpiderSource(site, keyword) {
  state.currentSource = site;
  if (site.runtime === 'jar' && !state.runtime?.connected) {
    toast('这个来源需要 Spider Runtime。请先部署 Gateway，并让影视-K连接后再试。');
    switchSection('sources');
    closeSourcePicker();
    return;
  }

  closeSourcePicker();
  const section = document.getElementById('searchSection');
  const grid = document.getElementById('searchGrid');
  section.classList.remove('hidden');
  document.getElementById('searchSourceLabel').textContent = `饭太硬来源：${site.name}`;
  document.getElementById('searchTitle').textContent = `“${keyword}” 的搜索结果`;
  document.getElementById('searchStatus').textContent = `正在调用 ${site.name} 的 Spider searchContent…`;
  grid.innerHTML = skeletonCards(8);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const data = await postJson('/tvbox/spider/search', { sourceKey: site.key, keyword });
    const items = (data.items || []).map(item => ({ ...item, mode: 'spider', sourceName: site.name, sourceKey: site.key }));
    renderSearchResults(items);
    document.getElementById('searchStatus').textContent = items.length ? `${site.name} 找到 ${items.length} 个结果` : `${site.name} 没有搜到该标题；请点“换源”试另一个。`;
  } catch (error) {
    grid.innerHTML = emptyBox(`${site.name} 搜索失败：${error.message}`);
    document.getElementById('searchStatus').textContent = '该来源本次不可用，点“换源”继续试。';
  }
}

async function searchCmsFallback(keyword) {
  state.currentSource = { key: 'cms-fallback', name: '备用网页源', runtime: 'web' };
  const section = document.getElementById('searchSection');
  const grid = document.getElementById('searchGrid');
  section.classList.remove('hidden');
  document.getElementById('searchSourceLabel').textContent = '备用网页源（非饭太硬 Spider）';
  document.getElementById('searchTitle').textContent = `“${keyword}” 的搜索结果`;
  document.getElementById('searchStatus').textContent = '正在搜索备用 CMS…';
  grid.innerHTML = skeletonCards(8);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const data = await fetchJson(`/webtv/search?wd=${encodeURIComponent(keyword)}`);
    const items = (data.results || []).map(item => ({ ...item, mode: 'cms' }));
    renderSearchResults(items);
    document.getElementById('searchStatus').textContent = items.length ? `备用网页源找到 ${items.length} 个结果` : '备用网页源也没有匹配结果';
  } catch (error) {
    grid.innerHTML = emptyBox(`备用网页源搜索失败：${error.message}`);
  }
}

function renderSearchResults(results) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  if (!results.length) return void (grid.innerHTML = emptyBox('这个来源没有匹配资源，请换源'));
  results.forEach(item => {
    const title = item.name || item.vod_name || '';
    const card = createPosterCard({ title, pic: item.pic || item.vod_pic || '', badge: item.remarks || item.year || '', sub: item.sourceName || state.currentSource?.name || '' });
    card.addEventListener('click', () => item.mode === 'cms' ? openCmsDetail(item) : openSpiderDetail(item));
    grid.appendChild(card);
  });
}

async function openSpiderDetail(item) {
  openDetailShell(item.name, item.pic, item.sourceName);
  try {
    const data = await postJson('/tvbox/spider/detail', { sourceKey: item.sourceKey, vodId: item.id });
    state.detail = { ...data.vod, sourceName: item.sourceName || state.currentSource?.name || item.sourceKey };
    state.detailMode = 'spider';
    state.detailLine = 0;
    renderDetail();
  } catch (error) {
    detailError(item.name, error.message);
  }
}

async function openCmsDetail(item) {
  openDetailShell(item.name, item.pic, item.sourceName);
  try {
    const data = await fetchJson(`/webtv/detail?source=${encodeURIComponent(item.sourceKey)}&id=${encodeURIComponent(item.id)}`);
    state.detail = data.vod;
    state.detailMode = 'cms';
    state.detailLine = 0;
    renderDetail();
  } catch (error) {
    detailError(item.name, error.message);
  }
}

function openDetailShell(title, pic, sourceName) {
  const modal = document.getElementById('detailModal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('detailTitle').textContent = '正在读取详情…';
  document.getElementById('detailSource').textContent = sourceName || '';
  document.getElementById('detailPoster').src = imageUrl(pic);
  document.getElementById('detailPoster').onerror = event => { event.currentTarget.src = PLACEHOLDER; };
  document.getElementById('detailMeta').textContent = '';
  document.getElementById('detailPeople').textContent = '';
  document.getElementById('detailContent').textContent = '';
  document.getElementById('lineTabs').innerHTML = '';
  document.getElementById('episodeList').innerHTML = '<div class="col-span-full text-gray-500 py-5">正在读取播放线路…</div>';
  document.getElementById('detailChangeSourceBtn').classList.remove('hidden');
  resetVodPlayer();
}

function detailError(title, message) {
  document.getElementById('detailTitle').textContent = title || '详情读取失败';
  document.getElementById('episodeList').innerHTML = `<div class="col-span-full text-red-400 py-5">${escapeHtml(message)}<div class="text-gray-500 mt-2">可以点击上方“换源”继续试其他饭太硬来源。</div></div>`;
}

function renderDetail() {
  const vod = state.detail;
  if (!vod) return;
  const poster = document.getElementById('detailPoster');
  poster.src = imageUrl(vod.pic);
  poster.onerror = event => { event.currentTarget.src = PLACEHOLDER; };
  document.getElementById('detailSource').textContent = `播放来源：${vod.sourceName || state.currentSource?.name || vod.sourceKey || ''}`;
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
    button.addEventListener('click', () => { state.detailLine = index; renderDetail(); });
    tabs.appendChild(button);
  });

  const episodes = document.getElementById('episodeList');
  episodes.innerHTML = '';
  const line = vod.lines?.[state.detailLine];
  if (!line?.episodes?.length) return void (episodes.innerHTML = '<div class="col-span-full text-gray-500 py-5">该源没有返回剧集；点击“换源”试其他来源。</div>');
  line.episodes.forEach(ep => {
    const button = document.createElement('button');
    button.className = 'px-2 py-2 rounded-lg bg-[#171717] border border-[#333] hover:border-violet-500 text-sm truncate';
    button.textContent = ep.name;
    button.title = ep.name;
    button.addEventListener('click', () => state.detailMode === 'spider' ? playSpiderEpisode(ep, line) : playCmsEpisode(ep, line));
    episodes.appendChild(button);
  });
}

async function playSpiderEpisode(ep, line) {
  prepareVodPlayer(`${state.detail?.name || ''} · ${line.name} · ${ep.name}`);
  showVodHint('正在调用该来源的 playerContent() 解析最终播放地址…');
  try {
    const data = await postJson('/tvbox/spider/play', {
      sourceKey: state.detail?.sourceKey || state.currentSource?.key,
      playFlag: line.flag || line.name,
      vodId: ep.id
    });
    const mediaUrl = data.mediaUrl || '';
    if (!mediaUrl) throw new Error('playerContent 没有返回可播放地址');
    hideVodHint();
    playMedia(mediaUrl, !!data.isHls, 'vod', `该来源播放失败。可点击“换源”继续试其他饭太硬来源。`);
  } catch (error) {
    showVodHint(`${error.message}。请点击“换源”试其他来源。`);
  }
}

function playCmsEpisode(ep, line) {
  const raw = String(ep.url || ep.id || '').trim();
  prepareVodPlayer(`${state.detail?.name || ''} · ${line.name} · ${ep.name}`);
  if (!/^https?:\/\//i.test(raw)) return showVodHint('备用 CMS 返回的不是直链，无法直接播放。请换源。');
  hideVodHint();
  playMedia(streamUrl(raw), /\.m3u8(?:$|[?#])/i.test(raw), 'vod', '备用线路播放失败，请换源。');
}

function prepareVodPlayer(name) {
  const box = document.getElementById('vodPlayerBox');
  const video = document.getElementById('vodVideo');
  box.classList.remove('hidden');
  document.getElementById('vodPlayingName').textContent = name;
  resetHls('vod');
  video.pause(); video.removeAttribute('src'); video.load();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function playMedia(url, isHls, kind, failureMessage) {
  const video = document.getElementById(kind === 'live' ? 'liveVideo' : 'vodVideo');
  resetHls(kind);
  video.pause(); video.removeAttribute('src'); video.load();
  if (isHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: kind === 'live' });
    if (kind === 'live') state.liveHls = hls; else state.vodHls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) kind === 'live' ? showLiveHint(failureMessage) : showVodHint(failureMessage); });
  } else {
    video.src = url;
    video.play().catch(() => {});
    video.onerror = () => kind === 'live' ? showLiveHint(failureMessage) : showVodHint(failureMessage);
  }
}

function showVodHint(message) {
  const hint = document.getElementById('vodPlayerHint');
  hint.textContent = message; hint.classList.remove('hidden'); hint.classList.add('flex');
}
function hideVodHint() { const hint = document.getElementById('vodPlayerHint'); hint.classList.add('hidden'); hint.classList.remove('flex'); }
function showLiveHint(message) { const hint = document.getElementById('livePlayerHint'); hint.textContent = message; hint.classList.remove('hidden'); }

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.detail = null; state.detailMode = ''; resetVodPlayer();
}
function resetVodPlayer() {
  resetHls('vod');
  const video = document.getElementById('vodVideo');
  video.pause(); video.removeAttribute('src'); video.load();
  document.getElementById('vodPlayerBox').classList.add('hidden');
  hideVodHint();
}

function renderLiveSources(lives) {
  const select = document.getElementById('liveSourceSelect');
  select.innerHTML = '';
  lives.forEach((live, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = live.name || `直播源 ${index + 1}`; select.appendChild(option);
  });
}
async function loadLiveSource(index) {
  const list = document.getElementById('channelList');
  list.innerHTML = '<div class="text-center text-gray-500 py-10">正在读取直播频道…</div>';
  document.getElementById('liveInfo').textContent = '正在加载…';
  try {
    const data = await fetchJson(`/tvbox/live?source=${encodeURIComponent(index)}`);
    state.liveChannels = data.channels || [];
    state.liveLoaded = true;
    document.getElementById('liveInfo').textContent = `${data.name || '直播'} · ${state.liveChannels.length} 个频道`;
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
  if (!filtered.length) return void (list.innerHTML = '<div class="text-center text-gray-500 py-10">没有匹配频道</div>');
  const groups = new Map();
  filtered.forEach(channel => { const group = channel.group || '未分类'; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(channel); });
  list.innerHTML = '';
  groups.forEach((channels, group) => {
    const title = document.createElement('div'); title.className = 'px-2 pt-3 pb-1 text-xs text-gray-500 sticky top-0 bg-[#111]'; title.textContent = `${group} (${channels.length})`; list.appendChild(title);
    channels.forEach(channel => {
      const button = document.createElement('button'); button.className = 'channel w-full text-left border border-transparent rounded-lg px-3 py-2.5 mb-1';
      button.innerHTML = `<div class="font-medium text-sm truncate">${escapeHtml(channel.name)}</div>`;
      button.addEventListener('click', () => playLiveChannel(channel, button)); list.appendChild(button);
    });
  });
}
function playLiveChannel(channel, button) {
  document.querySelectorAll('.channel.active').forEach(el => el.classList.remove('active')); button?.classList.add('active');
  document.getElementById('liveNowPlaying').textContent = `${channel.group || '未分类'} · ${channel.name}`;
  document.getElementById('livePlayerHint').classList.add('hidden');
  const raw = channel.url;
  playMedia(streamUrl(raw), /\.m3u8(?:$|[?#])/i.test(raw), 'live', '该频道播放失败，可能需要特殊 UA/Referer 或源已失效。');
}

function renderSourceSites(sites) {
  const container = document.getElementById('siteList');
  if (!sites.length) return void (container.innerHTML = emptyBox('没有站点'));
  container.innerHTML = sites.map(site => {
    const ready = site.runtime !== 'jar' || state.runtime?.connected;
    const runtime = site.runtime === 'jar' ? 'JAR Spider' : site.runtime === 'js' ? 'JS Spider' : site.runtime === 'web' ? 'Web/CMS' : '未知';
    return `<div class="border border-[#303030] rounded-xl p-3 bg-[#141414]"><div class="flex items-start justify-between gap-2"><div class="font-medium">${escapeHtml(site.name)}</div><span class="text-[10px] px-2 py-1 rounded-full border border-[#444]">${runtime}</span></div><div class="mt-2 text-xs text-gray-500 font-mono break-all">${escapeHtml(site.api || '')}</div><div class="mt-3 text-xs ${ready ? 'text-emerald-400' : 'text-amber-400'}">${site.searchable === false ? '不参与搜索' : ready ? '可在选源器中使用' : '等待 Spider Runtime'}</div></div>`;
  }).join('');
}

function switchSection(section) {
  const home = document.getElementById('homeSection');
  const live = document.getElementById('liveSection');
  const sources = document.getElementById('sourcesSection');
  home.classList.toggle('hidden', section === 'live' || section === 'sources');
  live.classList.toggle('hidden', section !== 'live');
  sources.classList.toggle('hidden', section !== 'sources');
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.section === section));
  if (section === 'movie' || section === 'tv') {
    state.recommendType = section;
    state.recommendTag = '热门'; state.recommendStart = 0; renderTags(); loadRecommendations();
  }
  if (section === 'home') {
    state.recommendType = 'movie'; state.recommendTag = '热门'; state.recommendStart = 0; renderTags(); loadRecommendations();
  }
  if (section === 'live' && !state.liveLoaded && (state.config?.lives || []).length) loadLiveSource(Number(document.getElementById('liveSourceSelect').value || 0));
  if (section === 'sources') checkRuntime().then(() => renderSourceSites(state.config?.sites || []));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createPosterCard({ title, pic, badge, sub }) {
  const card = document.createElement('button');
  card.className = 'movie-card text-left rounded-xl overflow-hidden border border-[#262626] bg-[#121212]';
  const img = document.createElement('img'); img.className = 'poster w-full'; img.alt = title || ''; img.loading = 'lazy'; img.src = imageUrl(pic); img.onerror = () => { img.src = PLACEHOLDER; };
  const body = document.createElement('div'); body.className = 'p-2.5';
  body.innerHTML = `<div class="font-medium text-sm line-clamp-2 min-h-[40px]">${escapeHtml(title)}</div><div class="mt-1.5 flex justify-between gap-2 text-[11px]"><span class="text-gray-500 truncate">${escapeHtml(sub || '')}</span><span class="text-amber-400 shrink-0">${escapeHtml(badge || '')}</span></div>`;
  card.append(img, body); return card;
}
function imageUrl(url) { return url && /^https?:\/\//i.test(url) ? `/webtv/image?url=${encodeURIComponent(url)}` : PLACEHOLDER; }
function streamUrl(url) { return `/webtv/stream?url=${encodeURIComponent(url)}`; }
function resetHls(kind) { const key = kind === 'live' ? 'liveHls' : 'vodHls'; if (state[key]) { try { state[key].destroy(); } catch {} state[key] = null; } }
function setSourceStatus(message, isError = false) { const box = document.getElementById('sourceStatus'); box.textContent = message; box.className = `mt-4 text-sm ${isError ? 'text-red-400' : 'text-gray-400'}`; }
function skeletonCards(count) { return Array.from({ length: count }, () => '<div class="rounded-xl overflow-hidden border border-[#222] bg-[#111] animate-pulse"><div class="aspect-[2/3] bg-[#1d1d1d]"></div><div class="p-3"><div class="h-3 bg-[#222] rounded"></div><div class="h-2 bg-[#1d1d1d] rounded mt-2 w-2/3"></div></div></div>').join(''); }
function emptyBox(message) { return `<div class="col-span-full text-center py-10 text-gray-500">${escapeHtml(message)}</div>`; }
function formatTime(value) { if (!value) return '-'; try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; } }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
async function fetchJson(url) { const response = await fetch(url, { cache: 'no-store' }); const data = await response.json().catch(() => ({})); if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`); return data; }
async function postJson(url, body) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }); const data = await response.json().catch(() => ({})); if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`); return data; }
let toastTimer = null;
function toast(message) { const box = document.getElementById('toast'); box.textContent = message; box.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.add('hidden'), 3200); }

document.addEventListener('DOMContentLoaded', boot);
