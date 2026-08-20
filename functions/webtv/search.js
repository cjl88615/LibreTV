const DEFAULT_SOURCES = [
  { key: 'qiqi', name: '七七资源', api: 'https://www.qiqidys.com/api.php/provide/vod' }
];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const keyword = (url.searchParams.get('wd') || '').trim().slice(0, 80);
  const year = (url.searchParams.get('year') || '').trim().slice(0, 8);
  if (!keyword) return json({ ok: false, error: '缺少搜索关键词' }, 400);

  const sources = getSources(env);
  const tasks = sources.map(source => searchSource(source, keyword, year));
  const settled = await Promise.allSettled(tasks);
  const results = [];
  const errors = [];

  settled.forEach((item, index) => {
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push({ source: sources[index]?.name || sources[index]?.key || 'unknown', error: item.reason?.message || '请求失败' });
  });

  results.sort((a, b) => b.matchScore - a.matchScore || String(b.year || '').localeCompare(String(a.year || '')));
  const dedup = [];
  const seen = new Set();
  for (const item of results) {
    const key = `${item.sourceKey}|${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
    if (dedup.length >= 60) break;
  }

  return json({ ok: true, keyword, year, results: dedup, sourceCount: sources.length, errors });
}

async function searchSource(source, keyword, year) {
  const target = new URL(source.api);
  target.searchParams.set('ac', 'videolist');
  target.searchParams.set('wd', keyword);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Taliabu-WebTV/2.0)',
        'Accept': 'application/json,text/plain,*/*'
      },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
    const list = Array.isArray(data.list) ? data.list : [];
    return list.map(v => normalizeVod(v, source, keyword, year)).filter(Boolean);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVod(v, source, keyword, wantedYear) {
  const id = v?.vod_id ?? v?.id;
  const name = String(v?.vod_name || v?.name || '').trim();
  if (id === undefined || id === null || !name) return null;
  const year = String(v?.vod_year || '').trim();
  return {
    id: String(id),
    name,
    pic: String(v?.vod_pic || '').trim(),
    remarks: String(v?.vod_remarks || '').trim(),
    year,
    typeName: String(v?.type_name || '').trim(),
    sourceKey: source.key,
    sourceName: source.name,
    matchScore: scoreMatch(name, keyword, year, wantedYear)
  };
}

function scoreMatch(name, keyword, year, wantedYear) {
  const a = compact(name);
  const b = compact(keyword);
  let score = 0;
  if (a === b) score += 100;
  else if (a.startsWith(b) || b.startsWith(a)) score += 80;
  else if (a.includes(b) || b.includes(a)) score += 60;
  else score += 10;
  if (wantedYear && year && wantedYear === year) score += 20;
  return score;
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/[\s·・:：,，.。!！?？\-—_()（）\[\]【】]/g, '');
}

function getSources(env) {
  if (env.WEBTV_CMS_SOURCES) {
    try {
      const parsed = JSON.parse(env.WEBTV_CMS_SOURCES);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(v => v && v.key && v.name && /^https?:\/\//i.test(v.api || ''));
        if (valid.length) return valid.slice(0, 8);
      }
    } catch (_) {}
  }
  return DEFAULT_SOURCES;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
