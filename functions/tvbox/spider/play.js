export async function onRequestPost({ request, env }) {
  const base = String(env.SPIDER_RUNTIME_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.SPIDER_RUNTIME_TOKEN || '').trim();
  if (!base || !token) return json({ ok: false, configured: false, error: 'Spider Runtime 未配置' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '无效 JSON' }, 400); }
  try {
    const response = await fetch(`${base}/api/play`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok: false, error: `Runtime HTTP ${response.status}` }));
    if (response.ok && data.ok && data.url) {
      const h = encodeBase64Url(JSON.stringify(data.headers || {}));
      data.mediaUrl = `/tvbox/spider/media?url=${encodeURIComponent(data.url)}${h ? `&h=${encodeURIComponent(h)}` : ''}`;
    }
    return json(data, response.status);
  } catch (error) {
    return json({ ok: false, error: `Spider Runtime 请求失败：${error.message}` }, 502);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'Use POST' }, 405);
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}
