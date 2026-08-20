import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 35066);
const HOST = process.env.HOST || '0.0.0.0';
const RUNTIME_TOKEN = process.env.RUNTIME_TOKEN || '';
const TOPIC_TIMEOUT_MS = Number(process.env.TOPIC_TIMEOUT_MS || 25000);

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let androidClient = null;
let androidInfo = null;
const pending = new Map();

function cleanRemoteIp(value = '') {
  return String(value).replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

function auth(req, res, next) {
  if (!RUNTIME_TOKEN) {
    return res.status(503).json({ ok: false, error: 'RUNTIME_TOKEN is not configured' });
  }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = bearer || String(req.headers['x-runtime-token'] || '');
  if (!token || token !== RUNTIME_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function clientReady() {
  return androidClient && androidClient.readyState === WebSocket.OPEN;
}

function sendTopic(code, data, timeoutMs = TOPIC_TIMEOUT_MS) {
  if (!clientReady()) {
    return Promise.reject(new Error('影视-K 未连接 Spider Runtime'));
  }
  const topicId = crypto.randomUUID();
  const message = { code, data, topicFlag: true, topicId };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(topicId);
      reject(new Error(`Spider 请求超时 (${code})`));
    }, timeoutMs);
    pending.set(topicId, { resolve, reject, timer, code });
    try {
      androidClient.send(JSON.stringify(message));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(topicId);
      reject(error);
    }
  });
}

function rejectAllPending(message) {
  for (const [topicId, item] of pending) {
    clearTimeout(item.timer);
    item.reject(new Error(message));
    pending.delete(topicId);
  }
}

wss.on('connection', (ws, req) => {
  const remoteIp = cleanRemoteIp(req.socket.remoteAddress || '');
  let registered = false;

  ws.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (Number(message.code) === 100) {
      if (androidClient && androidClient !== ws && androidClient.readyState === WebSocket.OPEN) {
        try { androidClient.close(1012, 'replaced by new TV-K client'); } catch {}
      }
      androidClient = ws;
      registered = true;
      androidInfo = {
        ...(message.data && typeof message.data === 'object' ? message.data : {}),
        ip: remoteIp,
        connectedAt: new Date().toISOString()
      };
      console.log(`[TV-K] registered from ${remoteIp}:`, androidInfo);
      return;
    }

    const topicId = message.topicId;
    if (topicId && pending.has(topicId)) {
      const item = pending.get(topicId);
      clearTimeout(item.timer);
      pending.delete(topicId);
      item.resolve(message.data);
    }
  });

  ws.on('close', () => {
    if (registered && androidClient === ws) {
      console.log(`[TV-K] disconnected: ${remoteIp}`);
      androidClient = null;
      androidInfo = null;
      rejectAllPending('影视-K 已断开连接');
    }
  });

  ws.on('error', error => {
    console.warn('[TV-K] websocket error:', error.message);
  });
});

app.get('/health', auth, (_req, res) => {
  res.json({
    ok: true,
    runtime: 'Taliabu Spider Gateway',
    connected: clientReady(),
    client: androidInfo ? {
      name: androidInfo.name || androidInfo.clientName || androidInfo.clientId || '影视-K',
      clientId: androidInfo.clientId || '',
      ip: androidInfo.ip,
      kType: androidInfo.kType ?? null,
      protocolVersionCode: androidInfo.protocolVersionCode ?? null,
      connectedAt: androidInfo.connectedAt
    } : null,
    pending: pending.size,
    now: new Date().toISOString()
  });
});

app.get('/api/sources', auth, async (_req, res) => {
  try {
    const data = await sendTopic(201, null);
    res.json({ ok: true, sources: Array.isArray(data) ? data : data || [] });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.post('/api/search', auth, async (req, res) => {
  const sourceKey = String(req.body?.sourceKey || '').trim();
  const keyword = String(req.body?.keyword || '').trim().slice(0, 100);
  if (!sourceKey || !keyword) return res.status(400).json({ ok: false, error: '缺少 sourceKey 或 keyword' });
  try {
    const raw = normalizeJson(await sendTopic(213, { sourceKey, keyword }));
    const list = Array.isArray(raw?.list) ? raw.list : [];
    res.json({
      ok: true,
      sourceKey,
      keyword,
      message: raw?.msg || '',
      items: list.map(vod => normalizeVod(vod, sourceKey))
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message, sourceKey });
  }
});

app.post('/api/detail', auth, async (req, res) => {
  const sourceKey = String(req.body?.sourceKey || '').trim();
  const vodId = String(req.body?.vodId || '').trim();
  if (!sourceKey || !vodId) return res.status(400).json({ ok: false, error: '缺少 sourceKey 或 vodId' });
  try {
    const raw = normalizeJson(await sendTopic(207, { sourceKey, vodId }));
    const vod = Array.isArray(raw?.list) ? raw.list[0] : null;
    if (!vod) return res.status(404).json({ ok: false, error: '该源没有返回影片详情' });
    res.json({ ok: true, vod: normalizeVodDetail(vod, sourceKey) });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message, sourceKey });
  }
});

app.post('/api/play', auth, async (req, res) => {
  const sourceKey = String(req.body?.sourceKey || '').trim();
  const playFlag = String(req.body?.playFlag || '').trim();
  const vodId = String(req.body?.vodId || '').trim();
  if (!sourceKey || !vodId) return res.status(400).json({ ok: false, error: '缺少 sourceKey 或 vodId' });
  try {
    const raw = normalizeJson(await sendTopic(209, {
      sourceKey,
      playFlag,
      vodId,
      vipParseFlags: []
    }, 30000));
    const play = normalizePlayResult(raw);
    if (!play.url) {
      return res.status(502).json({ ok: false, error: 'Spider playerContent 没有返回最终播放地址', raw });
    }
    res.json({ ok: true, ...play });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message, sourceKey });
  }
});

app.get('/media', auth, async (req, res) => {
  const target = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(target)) return res.status(400).send('Invalid media URL');

  let extraHeaders = {};
  if (req.query.h) {
    try {
      extraHeaders = JSON.parse(Buffer.from(String(req.query.h), 'base64url').toString('utf8')) || {};
    } catch {}
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value != null && typeof value !== 'object') headers.set(key, String(value));
  }
  if (req.headers.range) headers.set('Range', req.headers.range);
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'Mozilla/5.0 (Taliabu-Spider-Gateway/1.0)');

  try {
    const upstream = await fetch(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'follow' });
    res.status(upstream.status);
    const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'];
    for (const key of pass) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    res.status(502).send(`Media proxy error: ${error.message}`);
  }
});

function normalizeJson(value) {
  if (typeof value !== 'string') return value || {};
  const text = value.trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { value: text }; }
}

function normalizeVod(vod = {}, sourceKey = '') {
  return {
    id: String(vod.vod_id ?? vod.vodId ?? vod.id ?? ''),
    name: String(vod.vod_name ?? vod.vodName ?? vod.name ?? ''),
    pic: String(vod.vod_pic ?? vod.vodPic ?? vod.pic ?? ''),
    remarks: String(vod.vod_remarks ?? vod.vodRemarks ?? vod.note ?? ''),
    year: String(vod.vod_year ?? vod.vodYear ?? vod.year ?? ''),
    area: String(vod.vod_area ?? vod.vodArea ?? vod.area ?? ''),
    actor: String(vod.vod_actor ?? vod.vodActor ?? vod.actor ?? ''),
    director: String(vod.vod_director ?? vod.vodDirector ?? vod.director ?? ''),
    content: stripHtml(String(vod.vod_content ?? vod.vodContent ?? vod.content ?? vod.des ?? '')),
    typeName: String(vod.type_name ?? vod.typeName ?? vod.type ?? ''),
    sourceKey
  };
}

function normalizeVodDetail(vod, sourceKey) {
  return {
    ...normalizeVod(vod, sourceKey),
    lines: parsePlayLines(vod.vod_play_from ?? vod.vodPlayFrom, vod.vod_play_url ?? vod.vodPlayUrl)
  };
}

function parsePlayLines(fromText, urlText) {
  const flags = String(fromText || '线路1').split('$$$');
  const blocks = String(urlText || '').split('$$$');
  return blocks.map((block, index) => {
    const flag = flags[index] || `线路${index + 1}`;
    const episodes = String(block || '').split('#').map((raw, epIndex) => {
      const item = raw.trim();
      if (!item) return null;
      const pos = item.indexOf('$');
      return {
        name: pos >= 0 ? (item.slice(0, pos).trim() || `第${epIndex + 1}集`) : `第${epIndex + 1}集`,
        id: pos >= 0 ? item.slice(pos + 1).trim() : item
      };
    }).filter(Boolean);
    return { name: flag, flag, episodes };
  }).filter(line => line.episodes.length > 0);
}

function normalizePlayResult(raw = {}) {
  let url = extractPlayUrl(raw);
  if (url && androidInfo?.ip) url = rewriteLoopback(url, androidInfo.ip);
  const headers = normalizeHeaders(raw.header ?? raw.headers ?? raw?.nameValuePairs?.header);
  return {
    url: String(url || ''),
    headers,
    parse: Number(raw.parse || 0),
    jx: Number(raw.jx || 0),
    format: String(raw.format || ''),
    danmaku: String(raw.danmaku || ''),
    isHls: /mpegurl|m3u8/i.test(String(raw.format || '')) || /\.m3u8(?:$|[?#])/i.test(String(url || ''))
  };
}

function extractPlayUrl(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw?.nameValuePairs?.url === 'string') return raw.nameValuePairs.url;
  const value = raw.url;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[1] === 'string') return value[1];
    const firstString = value.find(v => typeof v === 'string' && /^https?:\/\//i.test(v));
    return firstString || '';
  }
  if (value && typeof value === 'object') {
    if (typeof value.v === 'string') return value.v;
    if (typeof value.url === 'string') return value.url;
    if (Array.isArray(value.values)) {
      const pos = Number.isFinite(Number(value.position)) ? Number(value.position) : 0;
      const selected = value.values[pos] ?? value.values[0];
      if (typeof selected === 'string') return selected;
      if (selected && typeof selected.v === 'string') return selected.v;
      if (selected && typeof selected.url === 'string') return selected.url;
    }
  }
  return '';
}

function normalizeHeaders(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val != null && typeof val !== 'object') out[key] = String(val);
  }
  return out;
}

function rewriteLoopback(url, ip) {
  try {
    const parsed = new URL(url);
    if (['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(parsed.hostname)) {
      parsed.hostname = ip;
      return parsed.toString();
    }
  } catch {}
  return String(url)
    .replace(/127\.0\.0\.1/g, ip)
    .replace(/localhost/gi, ip)
    .replace(/0\.0\.0\.0/g, ip);
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

server.listen(PORT, HOST, () => {
  console.log(`Taliabu Spider Gateway listening on http://${HOST}:${PORT}`);
  console.log(`影视-K 请连接 ws://<本机局域网IP>:${PORT}`);
});
