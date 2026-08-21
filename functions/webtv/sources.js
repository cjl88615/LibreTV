const DEFAULT_SOURCES = [
  { key: 'jisu', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/at/json' },
  { key: 'iqiyi', name: '爱奇艺资源', api: 'https://iqiyizyapi.com/api.php/provide/vod' },
  { key: 'subo', name: '速播资源', api: 'https://subocj.com/api.php/provide/vod/from/subm3u8/at/json' }
];

export async function onRequest({ env }) {
  const sources = getSources(env);
  const checks = await Promise.allSettled(sources.map(checkSource));
  const items = checks.map((item, index) => {
    if (item.status === 'fulfilled') return item.value;
    return {
      key: sources[index].key,
      name: sources[index].name,
      ok: false,
      error: item.reason?.message || '检查失败'
    };
  });

  return json({
    ok: items.some(v => v.ok),
    healthy: items.filter(v => v.ok).length,
    total: items.length,
    sources: items,
    checkedAt: new Date().toISOString()
  });
}

async function checkSource(source) {
  const target = new URL(source.api);
  target.searchParams.set('ac', 'videolist');
  target.searchParams.set('wd', '哪吒');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    const response = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Taliabu-WebTV/2.1 HealthCheck)',
        'Accept': 'application/json,text/plain,*/*'
      },
      redirect: 'follow'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
    return {
      key: source.key,
      name: source.name,
      ok: Array.isArray(data.list),
      results: Array.isArray(data.list) ? data.list.length : 0,
      latencyMs: Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
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
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
