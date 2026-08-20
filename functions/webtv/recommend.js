export async function onRequest({ request }) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const tag = (url.searchParams.get('tag') || '热门').slice(0, 20);
  const start = clampInt(url.searchParams.get('start'), 0, 500, 0);
  const limit = clampInt(url.searchParams.get('limit'), 6, 30, 18);

  const target = new URL('https://movie.douban.com/j/search_subjects');
  target.searchParams.set('type', type);
  target.searchParams.set('tag', tag);
  target.searchParams.set('sort', 'recommend');
  target.searchParams.set('page_limit', String(limit));
  target.searchParams.set('page_start', String(start));

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Referer': 'https://movie.douban.com/',
        'Accept': 'application/json,text/plain,*/*'
      },
      redirect: 'follow'
    });

    if (!response.ok) return json({ ok: false, error: `热门推荐 HTTP ${response.status}` }, 502);

    const data = await response.json();
    const items = (Array.isArray(data.subjects) ? data.subjects : []).map(item => ({
      id: String(item.id || ''),
      title: item.title || '',
      cover: item.cover || '',
      rate: item.rate || '',
      url: item.url || '',
      isNew: !!item.is_new,
      playable: item.playable !== false,
      type
    })).filter(item => item.title);

    return json({ ok: true, type, tag, start, limit, items, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return json({ ok: false, error: error.message || '热门推荐读取失败' }, 502);
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
