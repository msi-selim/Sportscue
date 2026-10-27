// Starts the app with test accounts and checks login, page protection and that no secrets reach the browser.
const crypto = require('crypto');
const salt = crypto.randomBytes(16);
const hashed = 'scrypt$' + salt.toString('base64') + '$' + crypto.scryptSync('HashedPass#77', salt, 64).toString('base64');
process.env.APP_SECRET = 'test-secret-value-1234567890';
process.env.ANNOTATOR_ACCOUNTS = JSON.stringify({ annotator1: 'PlainPass#11', Founder: 'FounderPass#22', hashuser: hashed });
process.env.PORT = '3102';
const app = require('../server');
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + n); };
const B = 'http://localhost:3102', jars = {};

async function call(who, method, url, body, hdr = {}) {
  const h = { 'X-Requested-With': 'sportscue', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jars[who] ? { Cookie: jars[who] } : {}), ...hdr };
  const r = await fetch(B + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && sc.includes('sc_session=')) { if (sc.includes('sc_session=;')) delete jars[who]; else jars[who] = sc.split(';')[0]; } // browsers drop a cookie the server clears
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const SECRETS = /PlainPass#11|FounderPass#22|HashedPass#77|ANNOTATOR_ACCOUNTS\s*=|const ANNOTATOR_ACCOUNTS/;

(async () => {
  const srv = await new Promise(r => { const s = app.listen(3102, () => r(s)); });
  let r = await call('a', 'GET', '/app'); ok(r.status === 302 && r.headers.get('location') === '/login', 'signed out: /app redirects to /login (tool page is NOT sent)');
  ok(!r.text.includes('SportsCue Sports Annotation'), 'signed out: no tool HTML in the response');
  r = await call('a', 'GET', '/login'); ok(r.status === 200 && !SECRETS.test(r.text), 'login page loads and has no passwords in it');
  r = await call('a', 'GET', '/index.html'); ok(r.status === 302, 'guessing /index.html finds nothing');
  r = await call('a', 'GET', '/api/me'); ok(r.status === 401, 'signed out: /api/me says 401');
  r = await call('a', 'POST', '/api/login', { username: 'annotator1', password: 'wrong' }); ok(r.status === 401, 'wrong password rejected');
  r = await call('a', 'POST', '/api/login', { username: 'annotator1', password: 'PlainPass#11' }, { 'X-Requested-With': '' }); ok(r.status === 403, 'login without the CSRF header is blocked');
  r = await call('a', 'POST', '/api/login', { username: 'annotator1', password: 'PlainPass#11' }); ok(r.status === 200, 'correct ID and password signs in');
  const cookie = r.headers.get('set-cookie'); ok(/HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), 'session cookie is HttpOnly and SameSite=Strict');
  r = await call('a', 'GET', '/api/me'); ok(JSON.parse(r.text).username === 'annotator1', '/api/me returns the signed in ID');
  r = await call('a', 'GET', '/app'); ok(r.status === 200 && r.text.includes('SportsCue'), 'signed in: tool page is served');
  ok(!SECRETS.test(r.text), 'VIEW SOURCE CHECK: no passwords or account list anywhere in the tool page');
  r = await call('a', 'POST', '/api/logout', {}); r = await call('a', 'GET', '/app'); ok(r.status === 302, 'after sign out the tool is locked again');
  r = await call('f', 'POST', '/api/login', { username: ' FOUNDER ', password: 'FounderPass#22' }); ok(r.status === 200, 'IDs are not case or space sensitive');
  r = await call('h', 'POST', '/api/login', { username: 'hashuser', password: 'HashedPass#77' }); ok(r.status === 200, 'account stored as a scrypt hash works');
  r = await call('h', 'POST', '/api/login', { username: 'hashuser', password: 'PlainPass#11' }); ok(r.status === 401, 'hashed account rejects a wrong password');
  // forged cookie
  jars.x = 'sc_session=' + encodeURIComponent(Buffer.from(JSON.stringify({ u: 'founder', p: 'x', e: Date.now() + 99999 })).toString('base64url') + '.AAAA');
  r = await call('x', 'GET', '/app'); ok(r.status === 302, 'forged cookie is refused');
  // lockout
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await call('l', 'POST', '/api/login', { username: 'annotator1', password: 'bad' })).status);
  ok(codes.includes(429), 'repeated wrong passwords get locked out (' + codes.join(',') + ')');
  srv.close();
  // config problems
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
