# SportsCue (simple Vercel edition)

Your original annotation tool, ready for Vercel, with the passwords gone from the page source.

## What changed from your original file
- The accounts (`ANNOTATOR_ACCOUNTS`) are no longer inside the HTML. They live in a Vercel setting.
- The ID and password are checked on the server. View source shows no passwords and no list of accounts.
- The tool page itself is only sent to people who are signed in. Signed out visitors get the login page and nothing else.
- Everything else works as before: you still load a video from your computer and Save Session / Open Session still use files on your computer.

## Deploy
1. Put this folder in a GitHub repo (or run `vercel` from this folder with the Vercel CLI).
2. Import it in Vercel. Leave the build settings alone. Vercel detects Express by itself.
3. Go to **Settings > Environment Variables** and add:
   - `APP_SECRET` : any long random text (`openssl rand -hex 32`)
   - `ANNOTATOR_ACCOUNTS` : one line of JSON, for example
     `{"annotator1":"their-password","annotator2":"their-password","founder":"your-password"}`
4. Deploy (or redeploy if you added the settings after the first deploy).
5. Open your site. It goes to `/login`.

If a setting is missing you get a plain page saying which one.

## Add your logo
Save your logo as `logo.png` inside the `public` folder, then commit and redeploy. It shows in the tool header, on the login page and as the browser tab icon. A square PNG works best. If the file is missing the logo is simply hidden, nothing breaks.

## Add, remove or change accounts
Edit `ANNOTATOR_ACCOUNTS` in Vercel and redeploy. Changing someone's password signs them out. Removing an account locks them out.

## Optional: store hashes instead of plain passwords
Run `npm install` then `npm run hash -- "the password"` and paste the result (it starts with `scrypt$`) as that person's value:
`{"annotator1":"scrypt$....$...."}`. The person still types the normal password.

## Good to know
- Do not put real passwords in any file you upload to GitHub. Only in Vercel settings.
- The wrong-password lockout (6 tries, 15 minutes) counts per server instance, so on Vercel it is a speed bump and not a hard lock. Use strong passwords.
- Signing out removes the cookie in that browser. A cookie copied elsewhere would work until it expires (12 hours by default), so keep SESSION_HOURS short if that worries you.
- Vercel's free Hobby plan is for personal, non commercial use only. Client work needs a Pro team.
- If you edit anything in `/pages`, run `npm run build:pages` so the change is packed into `lib/pages.js`.

## Run it on your computer
```
npm install
APP_SECRET=anything ANNOTATOR_ACCOUNTS='{"test":"test-password"}' npm start
npm test
```
