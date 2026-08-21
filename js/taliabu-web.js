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
  sourceMatches: new Map(),
  availableSources: [],
  sourceScanDone: false,
  sourceScanKeyword: '',
  sourceScanId: 0,
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
  const sourceCount = getVodSources().length;
  document.getElementById('vodSourceCount').textContent = `${sourceCount} 个源`;
  document.getElementById('miniSourceStatus').textContent = `${sourceCount} 个点播源`;
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
    clearSourceScan();
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
    renderLiveSources(data.lives || []);
  } catch (error) {
    state.liveConfig = null;
    console.warn(error);
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
  status.textContent = '正在加载…';
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
    status.textContent = `${data.items?.length || 0} 部`;
  } catch (error) {
    grid.innerHTML = emptyBox('推荐加载失败');
    status.textContent = '';
  }
}

function renderRecommendationCards(items) {
  const grid = document.getElementById('recommendGrid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = emptyBox('暂无内容');
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

async function openSourcePicker(keyword) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) return;

  state.lastKeyword = cleanKeyword;
  document.getElementById('sourcePickerTitle').textContent = `《${cleanKeyword}》`;
  document.getElementById('sourceFilterInput').value = '';
  document.getElementById('sourcePickerModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (state.sourceScanKeyword === cleanKeyword && state.sourceScanDone) {
    renderSourcePicker();
    return;
  }

  await scanAvailableSources(cleanKeyword);
}

function closeSourcePicker() {
  document.getElementById('sourcePickerModal').classList.add('hidden');
  if (document.getElementById('detailModal').classList.contains('hidden')) document.body.style.overflow = '';
}

function clearSourceScan() {
  state.sourceMatches = new Map();
  state.availableSources = [];
  state.sourceScanDone = false;
  state.sourceScanKeyword = '';
  state.sourceScanId += 1;
}

async function scanAvailableSources(keyword) {
  const scanId = ++state.sourceScanId;
  const sources = getVodSources();
  state.sourceMatches = new Map();
  state.availableSources = [];
  state.sourceScanDone = false;
  state.sourceScanKeyword = keyword;

  const grid = document.getElementById('sourcePickerGrid');
  const hint = document.getElementById('sourcePickerHint');
  grid.innerHTML = '<div class="col-span-full py-10 flex items-center justify-center"><div class="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div></div>';
  hint.textContent = `正在匹配 0/${sources.length}`;

  let completed = 0;
  const tasks = sources.map(async source => {
    try {
      const items = await searchSource(source, keyword);
      if (scanId !== state.sourceScanId) return;
      if (items.length) {
        state.sourceMatches.set(source.key, items);
        state.availableSources.push(source);
      }
    } catch (_) {
    } finally {
      completed += 1;
      if (scanId === state.sourceScanId) {
        hint.textContent = `正在匹配 ${completed}/${sources.length}`;
        renderSourcePicker(true);
      }
    }
  });

  await Promise.allSettled(tasks);
  if (scanId !== state.sourceScanId) return;

  state.sourceScanDone = true;
  state.availableSources.sort((a, b) => getVodSources().findIndex(v => v.key === a.key) - getVodSources().findIndex(v => v.key === b.key));
  renderSourcePicker();
}

async function searchSource(source, keyword) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 11500));
  const request = fetch(`/api/search?wd=${encodeURIComponent(keyword)}&source=${encodeURIComponent(source.key)}&_t=${Date.now()}`, { cache: 'no-store' })
    .then(response => response.json());
  const data = await Promise.race([request, timeout]);
  const list = Array.isArray(data.list) ? data.list : [];
  return sortSearchResults(list, keyword).filter(item => item._score >= 60).slice(0, 30);
}

function renderSourcePicker(scanning = false) {
  const query = document.getElementById('sourceFilterInput').value.trim().toLowerCase();
  const sources = state.availableSources.filter(source => !query || `${source.name} ${source.key}`.toLowerCase().includes(query));
  const grid = document.getElementById('sourcePickerGrid');
  const hint = document.getElementById('sourcePickerHint');

  grid.innerHTML = '';
  if (!sources.length) {
    if (scanning && !state.sourceScanDone) return;
    grid.innerHTML = emptyBox(state.sourceScanDone ? '暂无可用片源' : '正在匹配…');
  } else {
    sources.forEach(source => {
      const matches = state.sourceMatches.get(source.key) || [];
      const button = document.createElement('button');
      button.className = 'source-card text-left rounded-xl border border-[#303030] bg-[#141414] p-3';
      button.innerHTML = `<div class="font-medium text-sm">${escapeHtml(source.name)}</div><div class="mt-2 text-[11px] text-violet-300">${matches.length} 个结果</div>`;
      button.addEventListener('click', () => showSourceResults(source));
      grid.appendChild(button);
    });
  }

  if (state.sourceScanDone) {
    hint.textContent = `${state.availableSources.length} 个可用片源`;
  }
}

function showSourceResults(source) {
  state.currentSource = source;
  closeSourcePicker();

  const items = state.sourceMatches.get(source.key) || [];
  const section = document.getElementById('searchSection');
  section.classList.remove('hidden');
  document.getElementById('searchSourceLabel').textContent = source.name;
  document.getElementById('searchTitle').textContent = `“${state.lastKeyword}”`;
  document.getElementById('searchStatus').textContent = `${items.length} 个结果`;
  renderSearchResults(items, source);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sortSearchResults(list, keyword) {
  const target = compact(keyword);
  return list.map(item => {
    const name = String(item.vod_name || '');
    const c = compact(name);
    let score = 0;
    if (c === target) score = 100;
    else if (c.startsWith(target) || target.startsWith(c)) score = 85;
    else if (c.includes(target) || target.includes(c)) score = 70;
    return { ...item, _score: score };
  }).sort((a, b) => b._score - a._score || String(b.vod_year || '').localeCompare(String(a.vod_year || '')));
}

function renderSearchResults(items, source) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = emptyBox('暂无结果');
    return;
  }

  items.forEach(item => {
    const card = createPosterCard({
      title: item.vod_name || '未命名',
      pic: item.vod_pic || '',
      badge: item.vod_remarks || item.vod_year || '',
      sub: item.vod_year || source.name
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
  document.getElementById('detailTitle').textContent = '正在加载…';
  document.getElementById('detailSource').textContent = source.name;
  setPoster(document.getElementById('detailPoster'), item.vod_pic || '');
  document.getElementById('detailMeta').textContent = '';
  document.getElementById('detailPeople').textContent = '';
  document.getElementById('detailContent').textContent = '';
  document.getElementById('episodeHint').textContent = '';
  document.getElementById('episodeList').innerHTML = '<div class="col-span-full text-gray-500 py-5">正在加载…</div>';

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
    document.getElementById('episodeList').innerHTML = '<div class="col-span-full text-red-400 py-5">加载失败</div>';
  }
}

function renderDetail() {
  const vod = state.detail;
  if (!vod) return;

  setPoster(document.getElementById('detailPoster'), vod.pic);
  document.getElementById('detailSource').textContent = vod.sourceName;
  document.getElementById('detailTitle').textContent = vod.name;
  document.getElementById('detailMeta').textContent = [vod.type, vod.year, vod.area, vod.remarks].filter(Boolean).join(' · ');
  document.getElementById('detailPeople').textContent = [vod.director ? `导演：${vod.director}` : '', vod.actor ? `主演：${vod.actor}` : ''].filter(Boolean).join('  ');
  document.getElementById('detailContent').textContent = stripHtml(vod.desc) || '';
  document.getElementById('episodeHint').textContent = vod.episodes.length ? `共 ${vod.episodes.length} 集` : '暂无播放地址';

  const list = document.getElementById('episodeList');
  list.innerHTML = '';
  if (!vod.episodes.length) {
    list.innerHTML = '<div class="col-span-full text-gray-500 py-5">暂无播放地址</div>';
    return;
  }

  vod.episodes.forEach((url, index) => {
    const button = document.createElement('button');
    button.className = 'px-2 py-2 rounded-lg bg-[#171717] border border-[#333] hover:border-violet-500 text-sm truncate';
    button.textContent = vod.episodes.length === 1 ? '播放' : `第 ${index + 1} 集`;
    button.addEventListener('click', () => playEpisode(index));
    list.appendChild(button);
  });
}

function playEpisode(index) {
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
    sourceName: vod.sourceName || '',
    url,
    index: String(index),
    title: vod.name || ''
  });
  window.location.href = `/webtv/player.html?${params.toString()}`;
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.detail = null;
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
  list.innerHTML = '<div class="text-center text-gray-500 py-10">正在加载…</div>';
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
    list.innerHTML = '<div class="text-center text-red-400 py-10">加载失败</div>';
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
  document.getElementById('liveNowPlaying').textContent = channel.name;
  document.getElementById('livePlayerHint').classList.add('hidden');
  playLiveMedia(streamUrl(channel.url));
}

function playLiveMedia(url) {
  const video = document.getElementById('liveVideo');
  resetLiveHls();
  video.pause();
  video.removeAttribute('src');
  video.load();

  if (window.Hls && Hls.isSupported()) {
    state.liveHls = new Hls({ enableWorker: true, lowLatencyMode: true });
    state.liveHls.loadSource(url);
    state.liveHls.attachMedia(video);
    state.liveHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    state.liveHls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) document.getElementById('livePlayerHint').classList.remove('hidden');
    });
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

function renderVodSources() {
  const sources = getVodSources();
  const container = document.getElementById('siteList');
  document.getElementById('vodSourceCount').textContent = `${sources.length} 个源`;
  container.innerHTML = sources.map(source => `<div class="border border-[#303030] rounded-xl p-3 bg-[#141414]"><div class="font-medium text-sm">${escapeHtml(source.name)}</div></div>`).join('');
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
  }

  if (section === 'home') {
    state.recommendType = 'movie';
    state.recommendTag = '热门';
    state.recommendStart = 0;
    renderTags();
    loadRecommendations();
  }

  if (section === 'live' && !state.liveLoaded && (state.liveConfig?.lives || []).length) {
    loadLiveSource(Number(document.getElementById('liveSourceSelect').value || 0));
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
  img.src = imageUrl(pic);
  img.onerror = () => { img.src = PLACEHOLDER; };

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

function resetLiveHls() {
  if (state.liveHls) {
    try { state.liveHls.destroy(); } catch (_) {}
    state.liveHls = null;
  }
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => '<div class="rounded-xl overflow-hidden border border-[#222] bg-[#111] animate-pulse"><div class="aspect-[2/3] bg-[#1d1d1d]"></div><div class="p-3"><div class="h-3 bg-[#222] rounded"></div><div class="h-2 bg-[#1d1d1d] rounded mt-2 w-2/3"></div></div></div>').join('');
}

function emptyBox(message) {
  return `<div class="col-span-full text-center py-10 text-gray-500">${escapeHtml(message)}</div>`;
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/[\s·・:：,，.。!！?？\-—_()（）\[\]【】《》“”"']/g, '');
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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
  toastTimer = setTimeout(() => box.classList.add('hidden'), 2600);
}

document.addEventListener('DOMContentLoaded', boot);
