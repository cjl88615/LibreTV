export async function onRequest({ env }) {
  const runtime = runtimeConfig(env);
  if (!runtime.ok) return json(runtime, 503);
  try {
    const response = await fetch(`${runtime.base}/health`, {
      headers: { Authorization: `Bearer ${runtime.token}`, Accept: 'application/json' },
      cf: { cacheTtl: 0 }
    });
    const data = await safeJson(response);
    return json({ ok: response.ok && data.ok !== false, ...data, configured: true }, response.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, configured: true, connected: false, error: error.message }, 502);
  }
}

function runtimeConfig(env) {
  const base = String(env.SPIDER_RUNTIME_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.SPIDER_RUNTIME_TOKEN || '').trim();
  if (!base || !token) return { ok: false, configured: false, connected: false, error: 'Cloudflare Pages 尚未配置 SPIDER_RUNTIME_URL / SPIDER_RUNTIME_TOKEN' };
  return { ok: true, base, token };
}

async function safeJson(response) {
  try { return await response.json(); } catch { return { error: `Runtime HTTP ${response.status}` }; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}
