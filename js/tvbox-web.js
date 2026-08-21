const state = {
  liveConfig: null,
  recommendType: 'movie',
  recommendTag: '热门',
  recommendStart: 0,
  liveChannels: [],
  liveLoaded: false,
  liveHls: null,
  lastKeyword: '',
  currentSource: null,
  detail: null,
  bound: false
};

const TAGS = {
  movie: ['热门', '最新', '豆瓣高分', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑'],
  tv: ['热门', '国产剧', '美剧', '英剧', '韩剧', '日剧', '港剧', '日本动画', '综艺', '纪录片']
};

const SOURCE_PRIORITY = ['tyyszy', 'bfzy', 'dyttzy', 'ruyi', 'xiaomaomi', 'heimuer', 'jisu', 'iqiyi'];

const PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#171717"/><text x="200" y="285" text-anchor="middle" fill="#666" font-size="36">Taliabu</text><text x="200" y="335" text-anchor="middle" fill="#555" font-size="28">WebTV</text></svg>`)}`;

async function boot() {
  bindEvents();
  renderTags();
  renderVodSources();
  document.getElementById('vodSourceCount').textContent = getVodSources().length;
  document.getElementById('miniSourceStatus').textContent = `${getVodSources().length} 个 LibreTV 点播源`;
  document.getElementById('sourceStatus').textContent = '点播使用 LibreTV 原生 API/代理/播放器；直播继续使用您的 TVBox live.txt。';
  await Promise.allSettled([loadLiveConfig(), loadRecommendations()]);
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
    await Promise.allSettled([loadLiveConfig(), loadRecommendations()]);
    renderVodSources();
    toast('已刷新');
  });

  document.getElementById('brandBtn').addEventListener('click', () => switchSection('home'));
  document.getElementById('nextBatchBtn').addEventListener('click', () => {
    state.recommendStart += 18;
    if (state.recommendStart > 162) state.recommendStart = 0;
    loadRecommendations();
  });

  document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => switchSection(button.dataset.section));
  });

  document.getElementById('closeSearchBtn').addEventListener('click', () => {
    document.getElementById('searchSection').classList.add('hidden');
  });
  document.getElementById('changeSearchSourceBtn').addEventListener('click', () => {
    if (state.lastKeyword) openSourcePicker(state.lastKeyword);
  });

  document.getElementById('closeSourcePickerBtn').addEventListener('click', closeSourcePicker);
  document.getElementById('sourcePickerModal').addEventListener('click', event => {
    if (event.target.id === 'sourcePickerModal') closeSourcePicker();
  });
  document.getElementById('sourceFilterInput').addEventListener('input', renderSourcePicker);

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

  document.getElementById('channelSearch').addEventListener('input', renderChannels);
  document.getElementById('liveSourceSelect').addEventListener('change', event => loadLiveSource(Number(event.target.value || 0)));
}

function getVodSources() {
  const entries = Object.entries(window.API_SITES || {})
    .filter(([key, source]) => source && !source.adult && key !== 'testSource' && /^https?:\/\//i.test(source.api || ''))
    .map(([key, source]) => ({ key, name: source.name || key, api: source.api, detail: source.detail || '' }));

  return entries.sort((a, b) => {
    const ai = SOURCE_PRIORITY.indexOf(a.key);
    const bi = SOURCE_PRIORITY.indexOf(b.key);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

async function loadLiveConfig() {
  try {
    const data = await fetchJson('/tvbox/config');
    state.liveConfig = data;
    const lives = data.lives || [];
    document.getElementById('liveSourceCount').textContent = lives.length;
    renderLiveSources(lives);
  } catch (error) {
    state.liveConfig = null;
    document.getElementById('liveSourceCount').textContent = '0';
    console.warn('直播配置读取失败:', error);
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
    card.addEventListener('click', () => openSourcePicker(item.title));
    grid.appendChild(card);
  });
}

function openSourcePicker(keyword) {
  state.lastKeyword = String(keyword || '').trim();
  if (!state.lastKeyword) return;
  document.getElementById('sourcePickerTitle').textContent = `《${state.lastKeyword}》 · 选择播放源`;
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
  const query = document.getElementById('sourceFilterInput').value.trim().toLowerCase();
  const all = getVodSources();
  const sources = all.filter(source => !query || `${source.name} ${source.key}`.toLowerCase().includes(query));
  const grid = document.getElementById('sourcePickerGrid');
  const hint = document.getElementById('sourcePickerHint');
  hint.textContent = `共 ${all.length} 个 LibreTV 点播源；当前显示 ${sources.length} 个。前几个是原 LibreTV 默认常用源。`;
  grid.innerHTML = '';

  if (!sources.length) {
    grid.innerHTML = emptyBox('没有匹配来源');
    return;
  }

  sources.forEach((source, index) => {
    const button = document.createElement('button');
    button.className = 'source-card text-left rounded-xl border border-[#303030] bg-[#141414] p-3';
    const preferred = SOURCE_PRIORITY.includes(source.key);
    button.innerHTML = `<div class="font-medium text-sm">${escapeHtml(source.name)}</div><div class="mt-2 flex items-center justify-between gap-2"><span class="text-[10px] text-gray-500">${escapeHtml(source.key)}</span><span class="text-[10px] ${preferred ? 'text-emerald-400' : 'text-gray-400'}">${preferred ? '常用' : '点击搜索'}</span></div>`;
    button.addEventListener('click', () => searchLibreSource(source, state.lastKeyword));
    grid.appendChild(button);
  });
}

async function searchLibreSource(source, keyword) {
  state.currentSource = source;
  closeSourcePicker();

  const section = document.getElementById('searchSection');
  const grid = document.getElementById('searchGrid');
  section.classList.remove('hidden');
  document.getElementById('searchSourceLabel').textContent = `当前来源：${source.name}`;
  document.getElementById('searchTitle').textContent = `“${keyword}” 的搜索结果`;
  document.getElementById('searchStatus').textContent = `正在使用 ${source.name} 搜索…`;
  grid.innerHTML = skeletonCards(8);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const response = await fetch(`/api/search?wd=${encodeURIComponent(keyword)}&source=${encodeURIComponent(source.key)}&_t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    const list = Array.isArray(data.list) ? data.list : [];
    const filtered = sortSearchResults(list, keyword).slice(0, 80);
    renderSearchResults(filtered, source);
    document.getElementById('searchStatus').textContent = filtered.length
      ? `${source.name} 找到 ${filtered.length} 个结果；如果不是您要的版本，点“换源”。`
      : `${source.name} 没搜到《${keyword}》，点“换源”继续试其他来源。`;
  } catch (error) {
    grid.innerHTML = emptyBox(`${source.name} 搜索失败：${error.message}`);
    document.getElementById('searchStatus').textContent = '这个源当前不可用，点“换源”继续试。';
  }
}

function sortSearchResults(list, keyword) {
  const target = compact(keyword);
  return list.map(item => {
    const name = String(item.vod_name || '');
    const c = compact(name);
    let score = 0;
    if (c === target) score = 100;
    else if (c.startsWith(target) || target.startsWith(c)) score = 80;
    else if (c.includes(target) || target.includes(c)) score = 60;
    return { ...item, _score: score };
  }).sort((a, b) => b._score - a._score || String(b.vod_year || '').localeCompare(String(a.vod_year || '')));
}

function renderSearchResults(items, source) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = emptyBox('这个源没有匹配结果');
    return;
  }

  items.forEach(item => {
    const card = createPosterCard({
      title: item.vod_name || '未命名',
      pic: item.vod_pic || '',
      badge: item.vod_remarks || item.vod_year || '',
      sub: `${source.name}${item.vod_year ? ` · ${item.vod_year}` : ''}`
    });
    card.addEventListener('click', () => openDetail(item, source));
    grid.appendChild(card);
  });
}

async function openDetail(item, source) {
  const modal = document.getElementById('detailModal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const title = String(item.vod_name || state.lastKeyword || '影片');
  document.getElementById('detailTitle').textContent = '正在读取详情…';
  document.getElementById('detailSource').textContent = `播放来源：${source.name}`;
  setPoster(document.getElementById('detailPoster'), item.vod_pic || '');
  document.getElementById('detailMeta').textContent = '';
  document.getElementById('detailPeople').textContent = '';
  document.getElementById('detailContent').textContent = '';
  document.getElementById('episodeList').innerHTML = '<div class="col-span-full text-gray-500 py-5">正在读取剧集…</div>';

  try {
    const response = await fetch(`/api/detail?id=${encodeURIComponent(item.vod_id)}&source=${encodeURIComponent(source.key)}&_t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    const episodes = Array.isArray(data.episodes) ? data.episodes.filter(url => /^https?:\/\//i.test(String(url || ''))) : [];
    const info = data.videoInfo || {};

    state.detail = {
      id: String(item.vod_id || ''),
      name: info.title || title,
      sourceKey: source.key,
      sourceName: source.name,
      episodes,
      pic: info.cover || item.vod_pic || '',
      type: info.type || item.type_name || '',
      year: info.year || item.vod_year || '',
      area: info.area || '',
      director: info.director || '',
      actor: info.actor || '',
      remarks: info.remarks || item.vod_remarks || '',
      desc: info.desc || ''
    };

    renderDetail();
  } catch (error) {
    state.detail = { id: String(item.vod_id || ''), name: title, sourceKey: source.key, sourceName: source.name, episodes: [], pic: item.vod_pic || '' };
    document.getElementById('detailTitle').textContent = title;
    document.getElementById('episodeList').innerHTML = `<div class="col-span-full text-red-400 py-5">${escapeHtml(error.message)}。请点“换源”继续试。</div>`;
  }
}

function renderDetail() {
  const vod = state.detail;
  if (!vod) return;
  setPoster(document.getElementById('detailPoster'), vod.pic);
  document.getElementById('detailSource').textContent = `播放来源：${vod.sourceName}`;
  document.getElementById('detailTitle').textContent = vod.name;
  document.getElementById('detailMeta').textContent = [vod.type, vod.year, vod.area, vod.remarks].filter(Boolean).join(' · ');
  document.getElementById('detailPeople').textContent = [vod.director ? `导演：${vod.director}` : '', vod.actor ? `主演：${vod.actor}` : ''].filter(Boolean).join('  ');
  document.getElementById('detailContent').textContent = stripHtml(vod.desc) || '暂无简介';
  document.getElementById('episodeHint').textContent = `${vod.sourceName} · 共 ${vod.episodes.length} 集/条播放地址 · 点击后进入 LibreTV 原生播放器`;

  const list = document.getElementById('episodeList');
  list.innerHTML = '';
  if (!vod.episodes.length) {
    list.innerHTML = '<div class="col-span-full text-amber-400 py-5">这个源没有返回可播放地址，请点“换源”试其他来源。</div>';
    return;
  }

  vod.episodes.forEach((url, index) => {
    const button = document.createElement('button');
    button.className = 'px-2 py-2 rounded-lg bg-[#171717] border border-[#333] hover:border-violet-500 text-sm truncate';
    button.textContent = vod.episodes.length === 1 ? '播放' : `第${index + 1}集`;
    button.addEventListener('click', () => openLibrePlayer(index));
    list.appendChild(button);
  });
}

function openLibrePlayer(index) {
  const vod = state.detail;
  if (!vod?.episodes?.[index]) return;
  const url = vod.episodes[index];

  try {
    localStorage.setItem('currentVideoTitle', vod.name || '未知视频');
    localStorage.setItem('currentEpisodes', JSON.stringify(vod.episodes));
    localStorage.setItem('currentEpisodeIndex', String(index));
    localStorage.setItem('currentSourceCode', vod.sourceKey || '');
    localStorage.setItem('lastPageUrl', window.location.href);
  } catch (_) {}

  const params = new URLSearchParams({
    id: vod.id || '',
    source: vod.sourceKey || '',
    url,
    index: String(index),
    title: vod.name || '',
    back: window.location.href
  });
  window.location.href = `/watch.html?${params.toString()}`;
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.detail = null;
}

function renderVodSources() {
  const sources = getVodSources();
  const container = document.getElementById('siteList');
  document.getElementById('vodSourceCount').textContent = sources.length;
  container.innerHTML = sources.map(source => {
    const preferred = SOURCE_PRIORITY.includes(source.key);
    return `<div class="border border-[#303030] rounded-xl p-3 bg-[#141414]"><div class="flex items-start justify-between gap-2"><div class="font-medium">${escapeHtml(source.name)}</div>${preferred ? '<span class="text-[10px] px-2 py-1 rounded-full border border-emerald-800 text-emerald-400">常用</span>' : ''}</div><div class="mt-2 text-[11px] text-gray-500 font-mono break-all">${escapeHtml(source.api)}</div></div>`;
  }).join('');
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
  button?.classList.add('active');
  document.getElementById('liveNowPlaying').textContent = `${channel.group || '未分类'} · ${channel.name}`;
  document.getElementById('livePlayerHint').classList.add('hidden');
  playLiveMedia(streamUrl(channel.url), /\.m3u8(?:$|[?#])/i.test(channel.url));
}

function playLiveMedia(url, isHls) {
  const video = document.getElementById('liveVideo');
  resetLiveHls();
  video.pause();
  video.removeAttribute('src');
  video.load();

  if (isHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    state.liveHls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) showLiveHint('该频道播放失败，可能需要特殊 UA/Referer 或源已失效。');
    });
  } else {
    video.src = url;
    video.play().catch(() => {});
    video.onerror = () => showLiveHint('该频道播放失败。');
  }
}

function showLiveHint(message) {
  const hint = document.getElementById('livePlayerHint');
  hint.textContent = message;
  hint.classList.remove('hidden');
}

function resetLiveHls() {
  if (state.liveHls) {
    try { state.liveHls.destroy(); } catch (_) {}
    state.liveHls = null;
  }
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
    state.recommendTag = '热门';
    state.recommendStart = 0;
    renderTags();
    loadRecommendations();
  } else if (section === 'home') {
    state.recommendType = 'movie';
    state.recommendTag = '热门';
    state.recommendStart = 0;
    renderTags();
    loadRecommendations();
  } else if (section === 'live' && !state.liveLoaded && (state.liveConfig?.lives || []).length) {
    loadLiveSource(Number(document.getElementById('liveSourceSelect').value || 0));
  } else if (section === 'sources') {
    renderVodSources();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createPosterCard({ title, pic, badge, sub }) {
  const card = document.createElement('button');
  card.className = 'movie-card text-left rounded-xl overflow-hidden border border-[#262626] bg-[#121212]';
  const img = document.createElement('img');
  img.className = 'poster w-full';
  img.alt = title || '';
  img.loading = 'lazy';
  setPoster(img, pic);
  const body = document.createElement('div');
  body.className = 'p-2.5';
  body.innerHTML = `<div class="font-medium text-sm line-clamp-2 min-h-[40px]">${escapeHtml(title)}</div><div class="mt-1.5 flex justify-between gap-2 text-[11px]"><span class="text-gray-500 truncate">${escapeHtml(sub || '')}</span><span class="text-amber-400 shrink-0">${escapeHtml(badge || '')}</span></div>`;
  card.append(img, body);
  return card;
}

function setPoster(img, url) {
  img.src = imageUrl(url);
  img.onerror = () => { img.src = PLACEHOLDER; };
}

function imageUrl(url) {
  return url && /^https?:\/\//i.test(url) ? `/webtv/image?url=${encodeURIComponent(url)}` : PLACEHOLDER;
}

function streamUrl(url) {
  return `/webtv/stream?url=${encodeURIComponent(url)}`;
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/[\s·・:：,，.。!！?？\-—_()（）\[\]【】《》“”"']/g, '');
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => '<div class="rounded-xl overflow-hidden border border-[#222] bg-[#111] animate-pulse"><div class="aspect-[2/3] bg-[#1d1d1d]"></div><div class="p-3"><div class="h-3 bg-[#222] rounded"></div><div class="h-2 bg-[#1d1d1d] rounded mt-2 w-2/3"></div></div></div>').join('');
}

function emptyBox(message) {
  return `<div class="col-span-full text-center py-10 text-gray-500">${escapeHtml(message)}</div>`;
}

function formatTime(value) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return value; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

let toastTimer = null;
function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 3200);
}

document.addEventListener('DOMContentLoaded', boot);
