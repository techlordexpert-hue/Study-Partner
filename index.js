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
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
const nameKey = (n) => n.toLowerCase();
const pubUser = (u) => ({ name: u.name, createdAt: u.createdAt, lastLogin: u.lastLogin || null, active: u.active !== false, timetable: u.timetable || {}, profile: u.profile || {} });
const listUser = (u) => ({ name: u.name, createdAt: u.createdAt, lastLogin: u.lastLogin || null, active: u.active !== false });
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (code, msg) => { throw new HttpError(code, msg); };
const MAX = 950000;

async function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const k = 'rl:' + ip;
  const n = await kv(['INCR', k]);
  if (n === 1) await kv(['EXPIRE', k, 600]);
  return n > 100;
}
function needAdmin(t) { const p = verify(t); if (!p || p.role !== 'admin') bad(401, 'Admin sign-in required.'); }
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

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const a = req.method === 'GET' ? q.a : body.a;

    if (a === 'health') return send(res, 200, { ok: true, ready: READY });
    if (!READY) return send(res, 503, { error: 'Online storage is not connected yet.' });

    if (a === 'content') {
      const ads = (await hall('ads')).filter((x) => x.status === 'live').map((x) => ({ id: x.id, biz: x.biz, kind: x.kind || 'video', link: x.link || '', img: x.img || '', wa: x.wa, status: 'live' }));
      return send(res, 200, { online: (await jget('content:online')) || [], dayImages: (await jget('content:dayImages')) || {}, ads });
    }

    const t = body.t;
    switch (a) {
      case 'signup': case 'login': {
        if (await limited(req)) bad(429, 'Too many attempts. Please wait a few minutes and try again.');
        const name = cleanName(body.name), pass = String(body.pass || '');
        if (await checkAdminLogin(name, pass)) {
          return send(res, 200, { token: adminToken(), user: { name: 'Admin', isAdmin: true } });
        }
        if (a === 'signup') {
          const { key, u } = await createUser(name, pass);
          return send(res, 200, { token: userToken(key), user: pubUser(u) });
        }
        const key = nameKey(name), u = await jget('users', key);
        if (!u) bad(404, 'No account found with that name. Check the spelling, or tap “Sign up” to create one.');
        if (u.active === false) bad(403, 'This account has been deactivated. Please contact the admin.');
        if (!safeEq(hashPw(pass, u.salt), u.hash)) bad(401, 'Wrong password. Try again — or ask the admin to reset it.');
        u.lastLogin = Date.now(); await saveUser(key, u);
        return send(res, 200, { token: userToken(key), user: pubUser(u) });
      }
      case 'me': {
        const p = verify(t);
        if (p && p.role === 'admin') return send(res, 200, { user: { name: 'Admin', isAdmin: true } });
        const { u } = await needUser(t);
        return send(res, 200, { user: pubUser(u) });
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
          const av = typeof p.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.avatar) && p.avatar.length <= 90000 ? p.avatar : '';
          u.profile = { school: s(p.school, 80), prog: s(p.prog, 80), level: s(p.level, 30), phone: s(p.phone, 30), theme: ['auto', 'light', 'dark'].includes(p.theme) ? p.theme : 'auto', avatar: av };
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
        if (key !== oldKey) await kv(['HDEL', 'users', oldKey]);
        return send(res, 200, { user: pubUser(u), token: userToken(key) });
      }
      case 'adSubmit': {
        const ad = body.ad || {};
        const s = (v, n) => String(v || '').slice(0, n);
        const kind = ad.kind === 'flyer' ? 'flyer' : 'video';
        const img = kind === 'flyer' && typeof ad.img === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(ad.img) && ad.img.length <= 450000 ? ad.img : '';
        const rec = { id: 'a' + Date.now() + crypto.randomBytes(3).toString('hex'), biz: s(ad.biz, 80), kind, link: kind === 'video' ? s(ad.link, 500) : '', img, wa: s(ad.wa, 200), plan: s(ad.plan, 40), price: Number(ad.price) || 0, ref: s(ad.ref, 80), status: 'pending', createdAt: Date.now() };
        if (!rec.biz || (kind === 'video' && !rec.link) || (kind === 'flyer' && !rec.img)) bad(400, 'Please add the business name and either a video link or a flyer image.');
        await kv(['HSET', 'ads', rec.id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true });
      }
      /* ---- admin only ---- */
      case 'users': { needAdmin(t); return send(res, 200, { users: (await hall('users')).map(listUser) }); }
      case 'userSet': {
        needAdmin(t); const key = nameKey(cleanName(body.name)), u = await jget('users', key);
        if (!u) bad(404, 'Account not found.'); u.active = !!body.active; await saveUser(key, u); return send(res, 200, { ok: true });
      }
      case 'userDel': { needAdmin(t); await kv(['HDEL', 'users', nameKey(cleanName(body.name))]); return send(res, 200, { ok: true }); }
      case 'userPass': {
        needAdmin(t); const key = nameKey(cleanName(body.name)), u = await jget('users', key);
        if (!u) bad(404, 'Account not found.');
        if (String(body.pass || '').length < 4) bad(400, 'Password must be at least 4 characters.');
        u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(String(body.pass), u.salt); await saveUser(key, u);
        return send(res, 200, { ok: true });
      }
      case 'userCreate': { needAdmin(t); const { u } = await createUser(body.name, body.pass); return send(res, 200, { user: listUser(u) }); }
      case 'setContent': {
        needAdmin(t);
        const k = body.key, v = body.value;
        if (k === 'online' ? !Array.isArray(v) : k === 'dayImages' ? (typeof v !== 'object' || Array.isArray(v) || !v) : true) bad(400, 'Invalid content.');
        const s = JSON.stringify(v);
        if (s.length > MAX) bad(413, 'That is too large to save online — use smaller images or links instead of uploaded files.');
        await kv(['SET', 'content:' + k, s]);
        return send(res, 200, { ok: true });
      }
      case 'adList': { needAdmin(t); return send(res, 200, { ads: (await hall('ads')).sort((x, y) => y.createdAt - x.createdAt) }); }
      case 'adSet': {
        needAdmin(t); const ad = await jget('ads', body.id);
        if (!ad || !['live', 'rejected', 'pending', 'ended'].includes(body.status)) bad(400, 'Invalid request.');
        ad.status = body.status; await kv(['HSET', 'ads', ad.id, JSON.stringify(ad)]); return send(res, 200, { ok: true });
      }
      default: bad(400, 'Unknown request.');
    }
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
};
