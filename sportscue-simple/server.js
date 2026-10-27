'use strict';
/*
  SportsCue (simple edition) for Vercel.
  Your original annotation tool, but:
   - the login is checked on the server, so no passwords exist in any HTML or JavaScript
   - the tool page itself is only sent to people who are signed in
   - accounts live in the ANNOTATOR_ACCOUNTS environment variable in Vercel (never in the code)
*/
const express = require('express');
const crypto = require('crypto');
const PAGES = require('./lib/pages');

const ON_VERCEL = !!process.env.VERCEL;
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '12', 10);
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const cfgError = msg => Object.assign(new Error(msg), { config: true });

/* ───────── settings from environment variables ───────── */
let cfg = null;
function load() {
  if (cfg) return cfg;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    if (ON_VERCEL) throw cfgError('APP_SECRET is not set. Add a long random value in Vercel > Settings > Environment Variables, then redeploy.');
    secret = crypto.randomBytes(32).toString('hex'); // local testing only, logins reset on restart
  }
  let accounts;
  try { accounts = JSON.parse(process.env.ANNOTATOR_ACCOUNTS || ''); } catch { accounts = null; }
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts) || !Object.keys(accounts).length)
    throw cfgError('ANNOTATOR_ACCOUNTS is missing or is not valid JSON. It should look like {"annotator1":"password1","annotator2":"password2"}');
  const map = new Map();
  for (const [id, pw] of Object.entries(accounts)) {
    if (typeof pw !== 'string' || !pw) throw cfgError(`The password for "${id}" in ANNOTATOR_ACCOUNTS must be text.`);
    map.set(id.trim().toLowerCase(), pw);
  }
  cfg = { secret, accounts: map };
  return cfg;
}

/* ───────── password check (plain value or scrypt hash from `npm run hash`) ───────── */
function checkPassword(given, stored) {
  if (stored.startsWith('scrypt$')) {
    const [, s, h] = stored.split('$');
    const want = Buffer.from(h, 'base64'), calc = crypto.scryptSync(given, Buffer.from(s, 'base64'), want.length);
    return crypto.timingSafeEqual(calc, want);
  }
  return crypto.timingSafeEqual(sha(given), sha(stored)); // equal length digests, constant time
}
const DUMMY = sha('no-such-user');

/* ───────── sessions: signed cookie ───────── */
const hmac = s => crypto.createHmac('sha256', cfg.secret).update(s).digest('base64url');
// "pv" ties a session to the current password, so changing a password in Vercel signs that person out
const pv = stored => sha('pv:' + stored).toString('base64url').slice(0, 10);
function makeToken(id, stored) {
  const body = Buffer.from(JSON.stringify({ u: id, p: pv(stored), e: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return body + '.' + hmac(body);
}
function userFrom(req) {
  const m = /(?:^|;\s*)sc_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const tok = decodeURIComponent(m[1]);
  if (!tok.includes('.')) return null;
  const [body, sig] = tok.split('.'), good = hmac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    const stored = cfg.accounts.get(p.u);
    return p.e > Date.now() && stored && p.p === pv(stored) ? p.u : null;
  } catch { return null; }
}
function setCookie(res, token, clear) {
  res.setHeader('Set-Cookie', `sc_session=${clear ? '' : encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; ` +
    (clear ? 'Max-Age=0' : `Max-Age=${SESSION_HOURS * 3600}`) + (ON_VERCEL || process.env.COOKIE_SECURE === '1' ? '; Secure' : ''));
}

/* ───────── login throttle (per server instance, so it is a speed bump rather than a hard lock) ───────── */
const fails = new Map();
const lockedOut = k => { const f = fails.get(k); return f && f.until > Date.now(); };
function noteFail(k) { const f = fails.get(k) || { n: 0, until: 0 }; if (++f.n >= 6) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(k, f); }

/* ───────── app ───────── */
const app = express();
if (ON_VERCEL || process.env.TRUST_PROXY) app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use((req, res, next) => {
  try { load(); next(); }
  catch (e) {
    console.error('Setup problem:', e.message);
    const msg = e.config ? e.message : 'The server could not start. Check the deployment logs.';
    if (req.path.startsWith('/api')) return res.status(503).json({ error: msg });
    res.status(503).type('text').send('SportsCue setup needed:\n\n' + msg);
  }
});
app.use(express.json({ limit: '10kb' }));

app.use(express.static(require('path').join(__dirname, 'public'), { index: false, dotfiles: 'ignore', maxAge: '1h' })); // logo. On Vercel the public folder is served by Vercel itself
const send = (res, name) => res.type('html').send(PAGES[name]);
app.get('/', (req, res) => res.redirect(userFrom(req) ? '/app' : '/login'));
app.get('/login', (req, res) => userFrom(req) ? res.redirect('/app') : send(res, 'login'));
app.get('/app', (req, res) => userFrom(req) ? send(res, 'tool') : res.redirect('/login'));

app.post('/api/login', async (req, res) => {
  if (req.get('X-Requested-With') !== 'sportscue') return res.status(403).json({ error: 'Blocked' });
  const id = String((req.body || {}).username || '').trim().toLowerCase().slice(0, 64);
  const pw = String((req.body || {}).password || '').slice(0, 200);
  const kIp = 'ip:' + req.ip, kUser = 'u:' + id;
  if (lockedOut(kIp) || lockedOut(kUser)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const stored = cfg.accounts.get(id);
  let ok = false;
  try { ok = stored ? checkPassword(pw, stored) : (checkPassword(pw, 'x'), false); } catch { ok = false; }
  if (!ok) {
    noteFail(kIp); noteFail(kUser);
    await new Promise(r => setTimeout(r, 600)); // slows down guessing
    return res.status(401).json({ error: 'Invalid ID or password' });
  }
  fails.delete(kIp); fails.delete(kUser);
  setCookie(res, makeToken(id, stored));
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  if (req.get('X-Requested-With') !== 'sportscue') return res.status(403).json({ error: 'Blocked' });
  setCookie(res, '', true); res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = userFrom(req);
  u ? res.json({ username: u }) : res.status(401).json({ error: 'Not signed in' });
});

app.use((req, res) => (req.path.startsWith('/api') ? res.status(404).json({ error: 'Not found' }) : res.redirect('/')));
app.use((err, req, res, next) => { console.error(err); if (!res.headersSent) res.status(500).json({ error: 'Server error' }); });

if (!ON_VERCEL && require.main === module) {
  try { load(); } catch (e) { console.error('\nSetup problem: ' + e.message + '\n'); process.exit(1); }
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => console.log('SportsCue running on http://localhost:' + port));
}
module.exports = app;
