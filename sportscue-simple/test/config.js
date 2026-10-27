// Missing settings must give a clear message, not a crash.
process.env.VERCEL = '1'; delete process.env.APP_SECRET; delete process.env.ANNOTATOR_ACCOUNTS; process.env.PORT = '3103';
const app = require('../server');
(async () => {
  const srv = await new Promise(r => { const s = app.listen(3103, () => r(s)); });
  let r = await fetch('http://localhost:3103/login'), t = await r.text();
  const a = r.status === 503 && t.includes('APP_SECRET');
  process.env.APP_SECRET = 'abcdefghijklmnopqrstuvwxyz';
  r = await fetch('http://localhost:3103/login'); t = await r.text();
  const b = r.status === 503 && t.includes('ANNOTATOR_ACCOUNTS');
  console.log((a ? '  PASS ' : '  FAIL ') + 'missing APP_SECRET gives a clear 503 message');
  console.log((b ? '  PASS ' : '  FAIL ') + 'missing ANNOTATOR_ACCOUNTS gives a clear 503 message');
  srv.close(); process.exit(a && b ? 0 : 1);
})();
