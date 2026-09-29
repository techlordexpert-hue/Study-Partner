# Study Partner

A static front-end (`index.html`) plus two small Vercel serverless functions in `api/`.
No build step — deploy as-is.

## 1. Deploy to Vercel

**Dashboard (easiest):** go to https://vercel.com/new, choose "Deploy without Git" /
drag-and-drop, and drop this whole folder in.

**CLI:** `npm i -g vercel`, then from inside this folder run `vercel`, then `vercel --prod`.

**GitHub:** push this folder to a repo and import it at https://vercel.com/new.
Framework preset "Other" — no build command, output directory is `/`.

## 2. Turn on shared accounts (recommended)

Without this step the app still works, but each visitor's accounts, courses, ads and
photos are saved only in *their own* browser — nobody sees anyone else's data, and you
(admin) won't see students who signed up on other devices.

1. In your Vercel project → **Storage** → **Create Database** → **Upstash → Redis** (there's a free tier).
2. Connect it to this project — Vercel automatically adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `..._TOKEN`) as environment variables.
3. Redeploy. The app auto-detects the database — nothing else to configure.

Once connected: every student's account, timetable, courses, ads and the day-photos you
upload as admin are stored centrally and visible from any device, including yours.

## 3. Turn on the AI Study Assistant (optional)

The chat bubble in Library / PASCO / Online Courses answers using **Google Search** via
the Gemini API, so it can look things up for real.

1. Get a free key at https://aistudio.google.com/apikey
2. In Vercel → your project → **Settings → Environment Variables**, add:
   `GEMINI_API_KEY` = your key
3. Redeploy.

Without this key, the assistant still opens but tells the student it isn't connected yet.

## 4. Admin login

There's no visible "Admin" link anywhere in the app — sign in on the normal sign-up form
using the special name/password you set (defaults: `Yo Lord!` / `#124#`).
You can change these by setting `ADMIN_USER` and `ADMIN_PASS` as environment variables.

## Notes
- The Paystack **public** key is embedded in the front-end for the ad checkout — that's
  expected and safe. Never put a Paystack *secret* key in this file or any front-end code.
- `AUTH_SECRET` (optional env var): a random string used to sign login sessions. If you
  don't set one, a stable one is derived automatically from your database token, which is
  fine for most cases — set your own if you want to be able to invalidate all sessions by
  rotating it.
