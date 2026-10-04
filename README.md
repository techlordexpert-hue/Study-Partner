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

## 3. Research — no setup needed

The chat bubble in Library / PASCO / Online Courses is called **Research**. For each
question, it:

1. Combines what the student typed with whatever course/lesson/PASCO question they
   currently have open, for a sharper query.
2. Tries DuckDuckGo's free, keyless Instant Answer API for a quick factual answer
   (Wikipedia-style summaries, definitions) — shown directly in the chat with a source
   link, if one is found.
3. If there's no quick answer, it opens that same query as a real Google search in a
   new tab instead, so the student is never left with nothing.

There is **no API key, no environment variable, and no server call through your own
backend involved** — it's pure front-end logic calling a public, free endpoint directly
from the browser. It can't fail from a bad key, a rate limit, or a billing issue on your
end, and nothing here can break a deploy.

Honest limit: step 2 only works for topics DuckDuckGo recognises (general concepts,
definitions, known entities) — it can't write custom explanations, generate practice
questions, or hold a real conversation the way an AI model can. For that, you'd need a
true AI provider (Gemini, OpenAI, Anthropic, etc.) with your own key and a small
serverless function — ask Claude to wire one in any time.

## 5. Ads: timing, and running your own

Every paid ad expires automatically based on the plan the business picked — 24 hours,
48 hours, 3 days, 1 week, or 1 month — counted from the moment **you approve it**, not
from when they paid. Once that time is up, it comes off the Home slideshow by itself;
nothing needs to be done manually.

In the admin dashboard's **Ads** tab you can also:
- **Create an ad yourself** — runs immediately, no payment or approval step. Good for
  your own promos or a business that paid you outside the app.
- **End ad now** — stop a live ad early, before its time is up.
- **Delete** — permanently remove an ad record (works on live or past ads).

Ads are grouped into Pending approval / Live now (with time remaining shown) / History
(ended or rejected), so you can always see what's running and what's finished.

## 4. Admin login

There's no visible "Admin" link anywhere in the app — sign in on the normal sign-up form
using the special name/password (defaults: `Yo Lord!` / `#124#`).

You can change the admin name/password two ways:
- **From inside the app** (once shared accounts/database are connected — see step 2):
  sign in as admin → **Admin login** tab in the dashboard → enter a new name and/or
  password plus your current password to confirm → Save. This is the easiest way and
  doesn't need Vercel at all.
- **Via Vercel**, by setting `ADMIN_USER` and `ADMIN_PASS` as environment variables —
  this only sets the *starting* login before you've changed it from inside the app once;
  after your first in-app change, the in-app one takes over.

## Notes
- The Paystack **public** key is embedded in the front-end for the ad checkout — that's
  expected and safe. Never put a Paystack *secret* key in this file or any front-end code.
- `AUTH_SECRET` (optional env var): a random string used to sign login sessions. If you
  don't set one, a stable one is derived automatically from your database token, which is
  fine for most cases — set your own if you want to be able to invalidate all sessions by
  rotating it.
