const DEFAULT_SOURCES = [
  { key: 'jisu', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/at/json' },
  { key: 'iqiyi', name: '爱奇艺资源', api: 'https://iqiyizyapi.com/api.php/provide/vod' },
  { key: 'subo', name: '速播资源', api: 'https://subocj.com/api.php/provide/vod/from/subm3u8/at/json' }
];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const sourceKey = (url.searchParams.get('source') || '').trim();
  const id = (url.searchParams.get('id') || '').trim();
  if (!sourceKey || !id) return json({ ok: false, error: '缺少 source 或 id' }, 400);

  const source = getSources(env).find(v => v.key === sourceKey);
  if (!source) return json({ ok: false, error: '未知点播源' }, 404);

  try {
    const target = new URL(source.api);
    target.searchParams.set('ac', 'videolist');
    target.searchParams.set('ids', id);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(target.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Taliabu-WebTV/2.1)',
          'Accept': 'application/json,text/plain,*/*',
          'Referer': new URL(source.api).origin + '/'
        },
        redirect: 'follow'
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return json({ ok: false, error: `详情接口 HTTP ${response.status}` }, 502);

    const text = (await response.text()).replace(/^\uFEFF/, '');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ ok: false, error: '详情接口返回内容不是有效 JSON' }, 502);
    }

    const vod = Array.isArray(data.list) ? data.list[0] : null;
    if (!vod) return json({ ok: false, error: '详情接口没有返回影片数据' }, 404);

    const lines = parsePlayLines(vod.vod_play_from, vod.vod_play_url);
    const result = {
      id: String(vod.vod_id ?? id),
      name: String(vod.vod_name || ''),
      pic: String(vod.vod_pic || ''),
      remarks: String(vod.vod_remarks || ''),
      year: String(vod.vod_year || ''),
      area: String(vod.vod_area || ''),
      actor: String(vod.vod_actor || ''),
      director: String(vod.vod_director || ''),
      content: String(vod.vod_content || '').replace(/<[^>]+>/g, '').trim(),
      typeName: String(vod.type_name || ''),
      sourceKey: source.key,
      sourceName: source.name,
      lines
    };

    return json({ ok: true, vod: result, playable: lines.some(line => line.episodes.length > 0) });
  } catch (error) {
    return json({ ok: false, error: error.message || '详情读取失败' }, 502);
  }
}

function parsePlayLines(fromText, urlText) {
  const names = String(fromText || '线路1').split('$$$');
  const blocks = String(urlText || '').split('$$$');

  return blocks.map((block, lineIndex) => {
    const episodes = block.split('#').map((raw, episodeIndex) => {
      const item = raw.trim();
      if (!item) return null;
      const sep = item.indexOf('$');
      const name = sep >= 0 ? item.slice(0, sep).trim() : `第${episodeIndex + 1}集`;
      const playId = sep >= 0 ? item.slice(sep + 1).trim() : item;
      if (!playId) return null;
      return {
        name: name || `第${episodeIndex + 1}集`,
        url: playId,
        direct: /^https?:\/\//i.test(playId)
      };
    }).filter(Boolean);

    return {
      name: names[lineIndex] || `线路${lineIndex + 1}`,
      episodes
    };
  }).filter(line => line.episodes.length);
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
