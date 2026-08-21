export async function onRequest({ request }) {
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get('url') || '';
  const ua = reqUrl.searchParams.get('ua') || 'Mozilla/5.0 (Taliabu-WebTV/2.0)';
  const referer = reqUrl.searchParams.get('referer') || '';

  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return text('Bad stream URL', 400);
  }
  if (!/^https?:$/.test(target.protocol)) return text('Unsupported protocol', 400);

  const headers = new Headers();
  headers.set('User-Agent', ua);
  headers.set('Accept', '*/*');
  if (referer) headers.set('Referer', referer);
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow'
    });

    if (!upstream.ok && upstream.status !== 206) {
      return text(`Stream upstream HTTP ${upstream.status}`, upstream.status);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(target.pathname + target.search);

    if (request.method === 'HEAD') {
      return new Response(null, { status: upstream.status, headers: copyMediaHeaders(upstream.headers, contentType) });
    }

    if (isPlaylist) {
      const body = await upstream.text();
      const rewritten = rewritePlaylist(body, upstream.url || target.toString(), ua, referer);
      const out = new Headers({
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      return new Response(rewritten, { status: 200, headers: out });
    }

    const out = copyMediaHeaders(upstream.headers, contentType || 'application/octet-stream');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    return text(`Stream proxy error: ${error.message}`, 502);
  }
}

function rewritePlaylist(content, baseUrl, ua, referer) {
  const lines = content.split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP') || trimmed.startsWith('#EXT-X-MEDIA')) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxyUrl(resolve(baseUrl, uri), ua, referer)}"`);
    }
    if (trimmed.startsWith('#')) return line;
    return proxyUrl(resolve(baseUrl, trimmed), ua, referer);
  }).join('\n');
}

function resolve(base, relative) {
  try { return new URL(relative, base).toString(); } catch (_) { return relative; }
}

function proxyUrl(url, ua, referer) {
  const params = new URLSearchParams({ url });
  if (ua && ua !== 'Mozilla/5.0 (Taliabu-WebTV/2.0)') params.set('ua', ua);
  if (referer) params.set('referer', referer);
  return `/webtv/stream?${params.toString()}`;
}

function copyMediaHeaders(source, fallbackType) {
  const headers = new Headers();
  const type = source.get('content-type') || fallbackType;
  if (type) headers.set('Content-Type', type);
  const length = source.get('content-length');
  if (length) headers.set('Content-Length', length);
  const range = source.get('content-range');
  if (range) headers.set('Content-Range', range);
  const acceptRanges = source.get('accept-ranges');
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
  headers.set('Cache-Control', 'no-store');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  return headers;
}

function text(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}
