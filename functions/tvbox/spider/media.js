export async function onRequest({ request, env }) {
  const runtime = String(env.SPIDER_RUNTIME_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.SPIDER_RUNTIME_TOKEN || '').trim();
  if (!runtime || !token) return text('Spider Runtime 未配置', 503);

  const incoming = new URL(request.url);
  const target = String(incoming.searchParams.get('url') || '').trim();
  const encodedHeaders = String(incoming.searchParams.get('h') || '').trim();
  if (!/^https?:\/\//i.test(target)) return text('Invalid media URL', 400);

  const gateway = new URL(`${runtime}/media`);
  gateway.searchParams.set('url', target);
  if (encodedHeaders) gateway.searchParams.set('h', encodedHeaders);

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  try {
    const upstream = await fetch(gateway.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow'
    });

    const contentType = upstream.headers.get('Content-Type') || '';
    const looksHls = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(target);

    if (request.method !== 'HEAD' && looksHls) {
      const playlist = await upstream.text();
      const rewritten = rewriteM3u8(playlist, target, encodedHeaders);
      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const out = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    out.set('Access-Control-Allow-Origin', '*');
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    return text(`Media bridge error: ${error.message}`, 502);
  }
}

function rewriteM3u8(content, baseUrl, encodedHeaders) {
  if (!/^\s*#EXTM3U/i.test(content)) return content;
  const wrap = value => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;
    let absolute;
    try { absolute = new URL(trimmed, baseUrl).toString(); } catch { return trimmed; }
    return `/tvbox/spider/media?url=${encodeURIComponent(absolute)}${encodedHeaders ? `&h=${encodeURIComponent(encodedHeaders)}` : ''}`;
  };

  return content.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return wrap(trimmed);
    return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
  }).join('\n');
}

function text(body, status) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}
