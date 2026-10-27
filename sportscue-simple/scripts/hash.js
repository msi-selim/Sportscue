// Usage: npm run hash -- "the password"
// Prints a scrypt hash you can paste into ANNOTATOR_ACCOUNTS instead of the plain password.
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw) { console.error('Usage: npm run hash -- "the password"'); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log('scrypt$' + salt.toString('base64') + '$' + crypto.scryptSync(pw, salt, 64).toString('base64'));
