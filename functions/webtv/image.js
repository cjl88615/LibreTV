export async function onRequest({ request }) {
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get('url') || '';
  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return new Response('Bad image URL', { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) return new Response('Unsupported protocol', { status: 400 });

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Referer': `${target.protocol}//${target.host}/`,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      redirect: 'follow'
    });
    if (!response.ok) return new Response('Image upstream failed', { status: response.status });

    const type = response.headers.get('content-type') || 'image/jpeg';
    if (!type.toLowerCase().startsWith('image/')) return new Response('Upstream is not an image', { status: 415 });

    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    return new Response(`Image proxy error: ${error.message}`, { status: 502 });
  }
}
