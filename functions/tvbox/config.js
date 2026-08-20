const DEFAULT_TVBOX_SOURCE = 'https://tvsource.taliabu.kdns.fr';

export async function onRequest(context) {
  const { env } = context;
  const source = (env.TVBOX_SOURCE || DEFAULT_TVBOX_SOURCE).trim();

  try {
    const response = await fetch(source, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Taliabu-WebTV/1.0)',
        'Accept': 'application/json,text/plain,*/*'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return json({ ok: false, error: `TVBox source HTTP ${response.status}`, source }, 502);
    }

    const text = (await response.text()).replace(/^\uFEFF/, '');
    let config;
    try {
      config = JSON.parse(text);
    } catch (error) {
      return json({ ok: false, error: `TVBox JSON parse failed: ${error.message}`, source }, 502);
    }

    const sites = Array.isArray(config.sites) ? config.sites.map(normalizeSite) : [];
    const lives = Array.isArray(config.lives) ? config.lives.map((item, index) => ({
      index,
      name: item?.name || `直播源 ${index + 1}`,
      type: item?.type ?? 0,
      url: item?.url || '',
      playerType: item?.playerType ?? null,
      ua: item?.ua || ''
    })) : [];

    return json({
      ok: true,
      source,
      fetchedAt: new Date().toISOString(),
      spider: config.spider || '',
      wallpaper: config.wallpaper || '',
      stats: {
        sites: sites.length,
        liveSources: lives.length,
        jarSites: sites.filter(s => s.runtime === 'jar').length,
        jsSites: sites.filter(s => s.runtime === 'js').length,
        webSites: sites.filter(s => s.runtime === 'web').length
      },
      sites,
      lives
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Failed to load TVBox source', source }, 502);
  }
}

function normalizeSite(site = {}) {
  const api = String(site.api || '');
  let runtime = 'unknown';
  let runtimeLabel = '未知';

  if (/^csp_/i.test(api)) {
    runtime = 'jar';
    runtimeLabel = 'JAR Spider';
  } else if (/\.js(?:$|\?)/i.test(api) || /drpy/i.test(api)) {
    runtime = 'js';
    runtimeLabel = 'JS Spider';
  } else if (/^https?:\/\//i.test(api) || site.type === 0 || site.type === 1) {
    runtime = 'web';
    runtimeLabel = 'Web/CMS';
  }

  return {
    key: site.key || '',
    name: site.name || site.key || '未命名源',
    type: site.type ?? null,
    api,
    runtime,
    runtimeLabel,
    searchable: site.searchable !== 0,
    quickSearch: site.quickSearch !== 0,
    changeable: site.changeable !== 0,
    playerType: site.playerType ?? null,
    ext: site.ext ?? null
  };
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
