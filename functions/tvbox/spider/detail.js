export async function onRequestPost({ request, env }) {
  return forwardJson(request, env, '/api/detail');
}

export async function onRequest() {
  return json({ ok: false, error: 'Use POST' }, 405);
}

async function forwardJson(request, env, path) {
  const base = String(env.SPIDER_RUNTIME_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.SPIDER_RUNTIME_TOKEN || '').trim();
  if (!base || !token) return json({ ok: false, configured: false, error: 'Spider Runtime 未配置' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '无效 JSON' }, 400); }
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  } catch (error) {
    return json({ ok: false, error: `Spider Runtime 请求失败：${error.message}` }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}
