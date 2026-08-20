const DEFAULT_TVBOX_SOURCE = 'https://tvsource.taliabu.kdns.fr';

export async function onRequest(context) {
  const { request, env } = context;
  const source = (env.TVBOX_SOURCE || DEFAULT_TVBOX_SOURCE).trim();
  const url = new URL(request.url);
  const sourceIndex = Number(url.searchParams.get('source') || 0);

  try {
    const configResponse = await fetch(source, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Taliabu-WebTV/1.0)', 'Accept': 'application/json,text/plain,*/*' },
      redirect: 'follow'
    });
    if (!configResponse.ok) return json({ ok: false, error: `TVBox source HTTP ${configResponse.status}` }, 502);

    const config = JSON.parse((await configResponse.text()).replace(/^\uFEFF/, ''));
    const lives = Array.isArray(config.lives) ? config.lives : [];
    const live = lives[sourceIndex];
    if (!live || !live.url) return json({ ok: false, error: '直播源不存在' }, 404);

    const liveResponse = await fetch(live.url, {
      headers: {
        'User-Agent': live.ua || 'Mozilla/5.0 (Taliabu-WebTV/1.0)',
        'Accept': '*/*'
      },
      redirect: 'follow'
    });
    if (!liveResponse.ok) return json({ ok: false, error: `Live source HTTP ${liveResponse.status}`, liveUrl: live.url }, 502);

    const text = (await liveResponse.text()).replace(/^\uFEFF/, '');
    const channels = parsePlaylist(text, live.url);

    return json({
      ok: true,
      name: live.name || `直播源 ${sourceIndex + 1}`,
      liveUrl: live.url,
      fetchedAt: new Date().toISOString(),
      count: channels.length,
      channels
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Failed to load live source' }, 502);
  }
}

function parsePlaylist(text, baseUrl) {
  const trimmed = text.trim();
  if (trimmed.startsWith('#EXTM3U')) return parseM3u(trimmed, baseUrl);
  return parseTvboxTxt(trimmed, baseUrl);
}

function parseM3u(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  const channels = [];
  let meta = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const name = (line.split(',').pop() || '未命名频道').trim();
      const group = (line.match(/group-title="([^"]*)"/i) || [])[1] || '未分类';
      const logo = (line.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
      meta = { name, group, logo };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (meta) {
      channels.push({ ...meta, url: resolveUrl(line, baseUrl) });
      meta = null;
    }
  }
  return channels;
}

function parseTvboxTxt(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  const channels = [];
  let group = '未分类';

  for (const line of lines) {
    if (line.includes('#genre#')) {
      group = line.split(',')[0].trim() || '未分类';
      continue;
    }
    if (line.startsWith('#')) continue;
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    const name = line.slice(0, comma).trim();
    const rest = line.slice(comma + 1).trim();
    const candidates = rest.split('#').map(v => v.trim()).filter(Boolean);
    for (const candidate of candidates) {
      if (!/^https?:\/\//i.test(candidate)) continue;
      channels.push({ name, group, logo: '', url: resolveUrl(candidate, baseUrl) });
    }
  }
  return channels;
}

function resolveUrl(value, baseUrl) {
  try { return new URL(value, baseUrl).href; } catch { return value; }
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
