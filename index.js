// Study Partner backend — one Vercel serverless function, no dependencies.
// Storage: Upstash Redis (add it free from Vercel → Storage / Marketplace).
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_USER = process.env.ADMIN_USER || 'Yo Lord!';
const ADMIN_PASS = process.env.ADMIN_PASS || '#124#';
const SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update('sp-secret|' + (KV_TOKEN || 'dev')).digest('hex');
const REDIS = !!(KV_URL && KV_TOKEN);
const READY = REDIS || process.env.SP_ALLOW_MEMORY === '1'; // memory mode is for local testing only

/* ---------- storage ---------- */
const mem = new Map();
async function kv(cmd) {
  if (REDIS) {
    const r = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }
  const [op, key, a, b] = cmd;
  switch (String(op).toUpperCase()) {
    case 'GET': return mem.has(key) ? mem.get(key) : null;
    case 'SET': mem.set(key, a); return 'OK';
    case 'HGET': { const m = mem.get(key); return m && m.has(a) ? m.get(a) : null; }
    case 'HSET': { let m = mem.get(key); if (!m) { m = new Map(); mem.set(key, m); } m.set(a, b); return 1; }
    case 'HDEL': { const m = mem.get(key); return m && m.delete(a) ? 1 : 0; }
    case 'HGETALL': { const m = mem.get(key), out = []; if (m) for (const [k, v] of m) out.push(k, v); return out; }
    case 'INCR': { const n = (+mem.get(key) || 0) + 1; mem.set(key, String(n)); return n; }
    case 'EXPIRE': return 1;
    case 'DEL': return mem.delete(key) ? 1 : 0;
    default: throw new Error('unsupported');
  }
}
const jget = async (key, f) => { const v = f === undefined ? await kv(['GET', key]) : await kv(['HGET', key, f]); return v ? JSON.parse(v) : null; };
async function hall(key) {
  const flat = (await kv(['HGETALL', key])) || [], out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(JSON.parse(flat[i + 1]));
  return out;
}

/* ---------- crypto ---------- */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function sign(p) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(t) {
  if (typeof t !== 'string') return null;
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEq(sig, good)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const DAY = 86400000;
const userToken = (key) => sign({ u: key, role: 'student', exp: Date.now() + 30 * DAY });
const adminToken = () => sign({ u: '@admin', role: 'admin', exp: Date.now() + DAY / 2 });

/* ---------- helpers ---------- */
const send = (res, code, obj, cache) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', cache || 'no-store'); res.end(JSON.stringify(obj)); };
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
const nameKey = (n) => n.toLowerCase();
const pubUser = (u) => ({ name: u.name, createdAt: u.createdAt, lastLogin: u.lastLogin || null, active: u.active !== false, timetable: u.timetable || {}, profile: u.profile || {} });
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
async function fullUser(key, u) {
  const o = pubUser(u);
  if (!o.profile.avatar) { const av = await kv(['HGET', 'avatars', key]); if (av) o.profile = { ...o.profile, avatar: av }; }
  return o;
}
async function migrateAvatar(key, u) { // older accounts kept the picture inside the user record
  if (u.profile && u.profile.avatar) { await kv(['HSET', 'avatars', key, u.profile.avatar]); u.profile = { ...u.profile, avatar: '' }; }
}
const listUser = (u) => ({ name: u.name, createdAt: u.createdAt, lastLogin: u.lastLogin || null, active: u.active !== false });
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (code, msg) => { throw new HttpError(code, msg); };
const MAX = 950000;

const clientIp = (req) => String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'x';
async function rateCheck(key, limit, ttl) {
  const n = await kv(['INCR', key]);
  if (n === 1) await kv(['EXPIRE', key, ttl || 600]);
  return n > limit;
}
const bump = (key) => rateCheck(key, 1e12, 600);
const adImgUrl = (x) => (x.hasImg || x.img) ? '/api?a=img&id=ad_' + x.id + '&v=' + (x.createdAt || 0) : '';
async function putImg(id, dataUrl) { await kv(['HSET', 'imgs', id, JSON.stringify({ d: dataUrl, v: Date.now() })]); }
const DAYKEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
async function dayImageUrls() {
  const meta = (await jget('content:dayImages')) || {}; let changed = false;
  for (const d of Object.keys(meta)) { // older versions saved the pictures inline — move them out once
    if (typeof meta[d] === 'string') { if (DAYKEYS.includes(d) && IMG_RE.test(meta[d])) { await putImg('day_' + d, meta[d]); meta[d] = { v: Date.now() }; } else delete meta[d]; changed = true; }
  }
  if (changed) await kv(['SET', 'content:dayImages', JSON.stringify(meta)]);
  const out = {};
  for (const d of DAYKEYS) if (meta[d]) out[d] = '/api?a=img&id=day_' + d + '&v=' + meta[d].v;
  return out;
}
function needAdmin(t) { const p = verify(t); if (!p || p.role !== 'admin') bad(401, 'Admin sign-in required.'); }
const PLAN_MS = { '24 hours': 86400000, '48 hours': 172800000, '3 days': 259200000, '1 week': 604800000, '1 month': 2592000000 };
function planMs(plan) { return PLAN_MS[plan] || 86400000; }
async function sweepAds(list) {
  const now = Date.now(), out = [];
  for (const ad of list) {
    if (ad.status === 'live' && ad.expiresAt && ad.expiresAt <= now) {
      ad.status = 'ended'; ad.endedAt = now; ad.endedBy = 'expired';
      await kv(['HSET', 'ads', ad.id, JSON.stringify(ad)]);
    }
    out.push(ad);
  }
  return out;
}
async function adminCreds() {
  const o = await jget('admin:creds');
  return o && o.name && o.salt && o.hash ? o : { name: ADMIN_USER, salt: null, hash: null };
}
async function adminName() { return (await adminCreds()).name; }
async function checkAdminLogin(name, pass) {
  const c = await adminCreds();
  if (c.salt) return safeEq(nameKey(name), nameKey(c.name)) && safeEq(hashPw(String(pass), c.salt), c.hash);
  return safeEq(nameKey(name), nameKey(ADMIN_USER)) && safeEq(name, ADMIN_USER) && safeEq(pass, ADMIN_PASS);
}
async function needUser(t) {
  const p = verify(t);
  if (!p || p.role !== 'student') bad(401, 'Please log in again.');
  const u = await jget('users', p.u);
  if (!u) bad(401, 'Please log in again.');
  if (u.active === false) bad(403, 'This account has been deactivated. Please contact the admin.');
  return { key: p.u, u };
}
const saveUser = (key, u) => kv(['HSET', 'users', key, JSON.stringify(u)]);

async function createUser(name, pass) {
  name = cleanName(name);
  if (name.length < 2 || name.length > 40) bad(400, 'Name must be 2–40 characters.');
  if (String(pass || '').length < 4 || String(pass).length > 100) bad(400, 'Password must be at least 4 characters.');
  const key = nameKey(name);
  if (key === nameKey(await adminName()) || (await kv(['HGET', 'users', key]))) bad(409, 'That name is already taken. Tap “Log in” if it’s yours, or add your surname to make it unique.');
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { name, salt, hash: hashPw(String(pass), salt), createdAt: Date.now(), lastLogin: Date.now(), active: true, timetable: {} };
  await saveUser(key, u);
  return { key, u };
}



class ApiError extends Error { constructor(code, msg) { super(msg); this.apiCode = code; } }

async function timedFetch(url, opts, ms) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), Math.max(1500, ms));
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  catch (e) { throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'network', 'The AI service did not respond.'); }
  finally { clearTimeout(timer); }
}






/* ---------- YouTube search for the in-app Search page ----------
   Optional: YOUTUBE_API_KEY (free, Google Cloud -> YouTube Data API v3). Without it, a best-effort
   fallback reads YouTube's public results page. Results are cached so a crowd shares quota. */
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const ytHits = new Map();
const decodeEnt = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const ytFmtDur = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); if (!m) return ''; const h = +m[1] || 0, mi = +m[2] || 0, se = +m[3] || 0; return (h ? h + ':' + String(mi).padStart(2, '0') : String(mi)) + ':' + String(se).padStart(2, '0'); };
const ytFmtViews = (n) => { n = +n; if (!n) return ''; return (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(n)) + ' views'; };
async function ytApi(q, ms) {
  const r = await timedFetch('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&videoEmbeddable=true&safeSearch=moderate&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(YT_KEY), {}, ms);
  if (!r.ok) throw new ApiError(r.status === 403 || r.status === 429 ? 'quota' : 'yt_error', 'YouTube API error');
  const items = ((await r.json()).items || []).filter((i) => i.id && i.id.videoId).map((i) => ({ id: i.id.videoId, title: decodeEnt(i.snippet.title), channel: decodeEnt(i.snippet.channelTitle), thumb: (i.snippet.thumbnails && (i.snippet.thumbnails.high || i.snippet.thumbnails.medium || i.snippet.thumbnails.default) || {}).url || 'https://i.ytimg.com/vi/' + i.id.videoId + '/hqdefault.jpg', duration: '', views: '', published: String(i.snippet.publishedAt || '').slice(0, 10) }));
  if (!items.length) return items;
  try { // durations + view counts cost 1 extra quota unit; nice to have, never required
    const d = await timedFetch('https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=' + items.map((i) => i.id).join(',') + '&key=' + encodeURIComponent(YT_KEY), {}, 3000);
    if (d.ok) for (const v of ((await d.json()).items || [])) { const it = items.find((x) => x.id === v.id); if (it) { it.duration = ytFmtDur(v.contentDetails && v.contentDetails.duration); it.views = ytFmtViews(v.statistics && v.statistics.viewCount); } }
  } catch (e) { /* optional */ }
  return items;
}
function ytCollect(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 40 || out.length >= 40) return;
  if (node.videoRenderer && node.videoRenderer.videoId) { out.push(node.videoRenderer); return; }
  for (const k of Object.keys(node)) ytCollect(node[k], out, depth + 1);
}
function ytMap(v) {
  const txt = (x) => (x && (x.simpleText || (x.runs && x.runs.map((r) => r.text).join('')))) || '';
  return { id: v.videoId, title: txt(v.title), channel: txt(v.ownerText) || txt(v.longBylineText), thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg', duration: txt(v.lengthText), views: txt(v.shortViewCountText) || txt(v.viewCountText), published: txt(v.publishedTimeText) };
}
async function ytScrape(q, ms) {
  const r = await timedFetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' } }, ms);
  if (!r.ok) throw new ApiError('yt_error', 'YouTube page error');
  const m = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(await r.text());
  if (!m) throw new ApiError('yt_blocked', 'YouTube page unreadable');
  let data; try { data = JSON.parse(m[1]); } catch { throw new ApiError('yt_blocked', 'YouTube data unreadable'); }
  const found = []; ytCollect(data, found, 0); const seen = new Set();
  const items = found.map(ytMap).filter((x) => x.id && x.title && !seen.has(x.id) && seen.add(x.id));
  if (!items.length) throw new ApiError('yt_blocked', 'no videos found');
  return items.slice(0, 12);
}
async function ytSearch(q) {
  const key = 'yt:' + q.toLowerCase();
  if (READY) { try { const c = await kv(['GET', key]); if (c) return { ...JSON.parse(c), cached: true }; } catch (e) { /* cache is optional */ } }
  let items = null, source = '', last = null; const deadline = Date.now() + 8500;
  if (YT_KEY) { try { items = await ytApi(q, Math.min(5000, deadline - Date.now())); source = 'api'; } catch (e) { last = e; } }
  if (!items) { try { items = await ytScrape(q, Math.max(2500, deadline - Date.now())); source = 'web'; } catch (e) { last = e; } }
  if (!items) throw last || new ApiError('yt_error', 'unavailable');
  const out = { items, source };
  if (READY && items.length) { try { await kv(['SET', key, JSON.stringify(out)]); await kv(['EXPIRE', key, 3600]); } catch (e) { /* ignore */ } }
  return out;
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const a = req.method === 'GET' ? q.a : body.a;

    if (a === 'health') return send(res, 200, { ok: true, ready: READY });
    if (a === 'yt') {
      const ip = clientIp(req), now = Date.now(), hh = (ytHits.get(ip) || []).filter((t) => now - t < 600000);
      if (hh.length >= 40) return send(res, 429, { error: 'You are searching very fast — please wait a few minutes.', code: 'rate_limited' });
      hh.push(now); ytHits.set(ip, hh); if (ytHits.size > 5000) ytHits.clear();
      const qq = String(q.q || '').trim().slice(0, 100);
      if (qq.length < 2) return send(res, 400, { error: 'Type something to search for.' });
      try { const out = await ytSearch(qq); return send(res, 200, out, 'public, s-maxage=300, stale-while-revalidate=600'); }
      catch (e) { return send(res, 502, { error: 'YouTube search is not available right now.', code: (e && e.apiCode) || 'yt_error' }); }
    }
    if (!READY) return send(res, 503, { error: 'Online storage is not connected yet.' });

    if (a === 'img') {
      const id = String(q.id || '');
      let data = null;
      if (/^[\w-]{1,70}$/.test(id)) {
        const rec = await jget('imgs', id); data = rec && rec.d;
        if (!data && id.startsWith('ad_')) { const ad = await jget('ads', id.slice(3)); data = ad && ad.img; } // older ads kept the flyer inline
      }
      const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
      if (!m) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.setHeader('Cache-Control', 'no-store'); return res.end('Not found'); }
      const buf = Buffer.from(m[2], 'base64');
      res.statusCode = 200; res.setHeader('Content-Type', m[1]); res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // URL changes whenever the picture changes
      return res.end(buf);
    }
    if (a === 'content') {
      const settings = (await jget('content:settings')) || {};
      const ads = (await sweepAds(await hall('ads'))).filter((x) => x.status === 'live').map((x) => ({ id: x.id, biz: x.biz, kind: x.kind || 'video', link: x.link || '', img: adImgUrl(x), wa: x.wa, status: 'live' }));
      const dayImages = await dayImageUrls();
      // Short shared cache: a launch-day crowd opening the app reads from the edge, not from the database.
      return send(res, 200, { online: (await jget('content:online')) || [], dayImages, ads, googleCx: settings.googleCx || process.env.GOOGLE_CSE_ID || '' }, 'public, s-maxage=10, stale-while-revalidate=30');
    }

    const t = body.t;
    switch (a) {
      case 'signup': case 'login': {
        // Network-wide limits are generous on purpose: a whole class often shares ONE public IP.
        // The strict limit is per (network + account name), so one student's typos never lock out the room.
        const ip = clientIp(req);
        if (await rateCheck('rl:ip:' + a + ':' + ip, a === 'signup' ? 800 : 3000)) bad(429, 'A lot of people are signing in from this network right now. Please wait a minute and try again.');
        const name = cleanName(body.name), pass = String(body.pass || '');
        const nkey = nameKey(name), failKey = 'rl:fail:' + ip + ':' + nkey, isAdminName = nkey === nameKey(await adminName());
        if ((+(await kv(['GET', failKey])) || 0) >= (isAdminName ? 8 : 15)) bad(429, 'Too many wrong passwords for this name. Please wait about 10 minutes, or ask the admin to reset it.');
        if (await checkAdminLogin(name, pass)) {
          await kv(['DEL', failKey]);
          return send(res, 200, { token: adminToken(), user: { name: 'Admin', isAdmin: true }, usingDefault: !(await adminCreds()).salt });
        }
        if (isAdminName) await bump(failKey);
        if (a === 'signup') {
          const { key, u } = await createUser(name, pass);
          return send(res, 200, { token: userToken(key), user: await fullUser(key, u) });
        }
        const key = nkey, u = await jget('users', key);
        if (!u) bad(404, 'No account found with that name. Check the spelling, or tap “Sign up” to create one.');
        if (u.active === false) bad(403, 'This account has been deactivated. Please contact the admin.');
        if (!safeEq(hashPw(pass, u.salt), u.hash)) { await bump(failKey); bad(401, 'Wrong password. Try again — or ask the admin to reset it.'); }
        await kv(['DEL', failKey]);
        u.lastLogin = Date.now(); await migrateAvatar(key, u); await saveUser(key, u);
        return send(res, 200, { token: userToken(key), user: await fullUser(key, u) });
      }
      case 'me': {
        const p = verify(t);
        if (p && p.role === 'admin') return send(res, 200, { user: { name: 'Admin', isAdmin: true }, usingDefault: !(await adminCreds()).salt });
        const { key, u } = await needUser(t);
        return send(res, 200, { user: await fullUser(key, u) });
      }
      case 'adminCreds': {
        needAdmin(t);
        const curName = (await adminCreds()).name;
        const newName = body.newName !== undefined ? cleanName(body.newName) : curName;
        const newPass = body.newPass !== undefined ? String(body.newPass) : '';
        const curPass = String(body.curPass || '');
        if (newName.length < 2 || newName.length > 40) bad(400, 'Admin name must be 2–40 characters.');
        if (!(await checkAdminLogin(curName, curPass))) bad(401, 'Current admin password is wrong.');
        if (newPass && newPass.length < 4) bad(400, 'New password must be at least 4 characters.');
        if (nameKey(newName) !== nameKey(curName) && (await kv(['HGET', 'users', nameKey(newName)]))) bad(409, 'A student account already uses that name.');
        const c = await adminCreds();
        const salt = crypto.randomBytes(16).toString('hex');
        const pass = newPass || curPass; // keep current password if a new one wasn't given, but re-hash under the (possibly new) salt/name
        await kv(['SET', 'admin:creds', JSON.stringify({ name: newName, salt, hash: hashPw(pass, salt) })]);
        return send(res, 200, { ok: true, name: newName, token: adminToken() });
      }
      case 'profile': {
        let { key, u } = await needUser(t);
        if (body.timetable !== undefined) {
          if (typeof body.timetable !== 'object' || JSON.stringify(body.timetable).length > 60000) bad(400, 'Timetable is too large.');
          u.timetable = body.timetable;
        }
        if (body.profile !== undefined) {
          const p = body.profile || {}, s = (v, n) => String(v || '').slice(0, n);
          const av = typeof p.avatar === 'string' && IMG_RE.test(p.avatar) && p.avatar.length <= 120000 ? p.avatar : '';
          u.profile = { school: s(p.school, 80), prog: s(p.prog, 80), level: s(p.level, 30), phone: s(p.phone, 30), theme: ['auto', 'light', 'dark'].includes(p.theme) ? p.theme : 'auto', avatar: '' };
          if (av) await kv(['HSET', 'avatars', key, av]); else await kv(['HDEL', 'avatars', key]);
        }
        if (body.newPass) {
          if (!safeEq(hashPw(String(body.curPass || ''), u.salt), u.hash)) bad(401, 'Your current password is wrong.');
          if (String(body.newPass).length < 4) bad(400, 'Password must be at least 4 characters.');
          u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(String(body.newPass), u.salt);
        }
        let oldKey = key;
        if (body.newName) {
          const nn = cleanName(body.newName), nk = nameKey(nn);
          if (nn.length < 2 || nn.length > 40) bad(400, 'Name must be 2–40 characters.');
          if (nk !== key && (nk === nameKey(await adminName()) || (await kv(['HGET', 'users', nk])))) bad(409, 'That name is already taken.');
          u.name = nn; key = nk;
        }
        await saveUser(key, u);
        if (key !== oldKey) { await kv(['HDEL', 'users', oldKey]); const av0 = await kv(['HGET', 'avatars', oldKey]); if (av0) { await kv(['HSET', 'avatars', key, av0]); await kv(['HDEL', 'avatars', oldKey]); } }
        return send(res, 200, { user: await fullUser(key, u), token: userToken(key) });
      }
      case 'adSubmit': {
        const ad = body.ad || {};
        const s = (v, n) => String(v || '').slice(0, n);
        const kind = ad.kind === 'flyer' ? 'flyer' : 'video';
        const img = kind === 'flyer' && typeof ad.img === 'string' && IMG_RE.test(ad.img) && ad.img.length <= 700000 ? ad.img : '';
        const rec = { id: 'a' + Date.now() + crypto.randomBytes(3).toString('hex'), biz: s(ad.biz, 80), kind, link: kind === 'video' ? s(ad.link, 500) : '', img: '', hasImg: !!img, wa: s(ad.wa, 200), plan: s(ad.plan, 40), durationMs: planMs(ad.plan), price: Number(ad.price) || 0, ref: s(ad.ref, 80), status: 'pending', createdAt: Date.now() };
        if (!rec.biz || (kind === 'video' && !rec.link) || (kind === 'flyer' && !img)) bad(400, 'Please add the business name and either a video link or a flyer image.');
        if (img) await putImg('ad_' + rec.id, img);
        await kv(['HSET', 'ads', rec.id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true });
      }
      /* ---- admin only ---- */
      case 'users': { needAdmin(t); return send(res, 200, { users: (await hall('users')).map(listUser) }); }
      case 'userSet': {
        needAdmin(t); const key = nameKey(cleanName(body.name)), u = await jget('users', key);
        if (!u) bad(404, 'Account not found.'); u.active = !!body.active; await saveUser(key, u); return send(res, 200, { ok: true });
      }
      case 'userDel': { needAdmin(t); const dk = nameKey(cleanName(body.name)); await kv(['HDEL', 'users', dk]); await kv(['HDEL', 'avatars', dk]); return send(res, 200, { ok: true }); }
      case 'userPass': {
        needAdmin(t); const key = nameKey(cleanName(body.name)), u = await jget('users', key);
        if (!u) bad(404, 'Account not found.');
        if (String(body.pass || '').length < 4) bad(400, 'Password must be at least 4 characters.');
        u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(String(body.pass), u.salt); await saveUser(key, u);
        return send(res, 200, { ok: true });
      }
      case 'userCreate': { needAdmin(t); const { u } = await createUser(body.name, body.pass); return send(res, 200, { user: listUser(u) }); }
      case 'settingsSet': {
        needAdmin(t);
        const cx = String(body.googleCx == null ? '' : body.googleCx).trim();
        if (cx && !/^[\w:.-]{6,100}$/.test(cx)) bad(400, 'That does not look like a Search engine ID (it is a short code like 0123abc456def:xyz).');
        const settings = (await jget('content:settings')) || {}; settings.googleCx = cx;
        await kv(['SET', 'content:settings', JSON.stringify(settings)]);
        return send(res, 200, { ok: true, googleCx: cx });
      }
      case 'dayImageSet': {
        needAdmin(t);
        const d = String(body.day || ''), img = body.dataUrl;
        if (!DAYKEYS.includes(d)) bad(400, 'Unknown day.');
        if (typeof img !== 'string' || !IMG_RE.test(img)) bad(400, 'That does not look like a picture (use a JPG or PNG).');
        if (img.length > 900000) bad(413, 'That picture is too big — please choose a smaller one.');
        await putImg('day_' + d, img);
        const meta = (await jget('content:dayImages')) || {}; meta[d] = { v: Date.now() };
        await kv(['SET', 'content:dayImages', JSON.stringify(meta)]);
        return send(res, 200, { ok: true, dayImages: await dayImageUrls() });
      }
      case 'dayImageDel': {
        needAdmin(t);
        const d = String(body.day || ''); if (!DAYKEYS.includes(d)) bad(400, 'Unknown day.');
        const meta = (await jget('content:dayImages')) || {}; delete meta[d];
        await kv(['SET', 'content:dayImages', JSON.stringify(meta)]); await kv(['HDEL', 'imgs', 'day_' + d]);
        return send(res, 200, { ok: true, dayImages: await dayImageUrls() });
      }
      case 'setContent': {
        needAdmin(t);
        const k = body.key, v = body.value;
        if (k !== 'online' || !Array.isArray(v)) bad(400, 'Invalid content.');
        const s = JSON.stringify(v);
        if (s.length > MAX) bad(413, 'That is too large to save online — use smaller images or links instead of uploaded files.');
        await kv(['SET', 'content:' + k, s]);
        return send(res, 200, { ok: true });
      }
      case 'adList': { needAdmin(t); const ads = (await sweepAds(await hall('ads'))).map((x) => ({ ...x, img: adImgUrl(x) })); return send(res, 200, { ads: ads.sort((x, y) => y.createdAt - x.createdAt) }); }
      case 'adSet': {
        needAdmin(t); const ad = await jget('ads', body.id);
        if (!ad || !['live', 'rejected', 'pending', 'ended'].includes(body.status)) bad(400, 'Invalid request.');
        ad.status = body.status;
        if (body.status === 'live') { ad.liveAt = Date.now(); ad.expiresAt = ad.liveAt + (ad.durationMs || planMs(ad.plan)); delete ad.endedAt; delete ad.endedBy; }
        if (body.status === 'ended') { ad.endedAt = Date.now(); ad.endedBy = 'admin'; }
        await kv(['HSET', 'ads', ad.id, JSON.stringify(ad)]); return send(res, 200, { ok: true });
      }
      case 'adCreate': {
        needAdmin(t);
        const ad = body.ad || {}, s = (v, n) => String(v || '').slice(0, n);
        const kind = ad.kind === 'flyer' ? 'flyer' : 'video';
        const img = kind === 'flyer' && typeof ad.img === 'string' && IMG_RE.test(ad.img) && ad.img.length <= 700000 ? ad.img : '';
        if (!s(ad.biz, 80) || (kind === 'video' && !s(ad.link, 500)) || (kind === 'flyer' && !img)) bad(400, 'Add a business name and either a video link or a flyer image.');
        const now = Date.now(), durationMs = planMs(ad.plan);
        const rec = { id: 'a' + now + crypto.randomBytes(3).toString('hex'), biz: s(ad.biz, 80), kind, link: kind === 'video' ? s(ad.link, 500) : '', img: '', hasImg: !!img, wa: s(ad.wa, 200), plan: s(ad.plan, 40) || '24 hours', durationMs, price: 0, ref: 'admin', status: 'live', createdAt: now, liveAt: now, expiresAt: now + durationMs };
        if (img) await putImg('ad_' + rec.id, img);
        await kv(['HSET', 'ads', rec.id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true, id: rec.id });
      }
      case 'adDelete': { needAdmin(t); await kv(['HDEL', 'ads', body.id]); await kv(['HDEL', 'imgs', 'ad_' + body.id]); return send(res, 200, { ok: true }); }
      default: bad(400, 'Unknown request.');
    }
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
};
