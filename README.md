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

## 3. Research — no setup needed, nothing leaves the app

The chat bubble in Library / PASCO / Online Courses is called **Research**. For each
question, it tries up to three free, keyless sources, in order, and shows the answer
directly in the chat — nothing ever opens in a new tab automatically:

1. **DuckDuckGo's Instant Answer API** — a quick factual summary (Wikipedia-style),
   shown with a source link, if the topic is recognized.
2. **DuckDuckGo's related topics** — a short list, if there's no single clean answer.
3. **Wikipedia's search API** — real article titles and snippets shown as results right
   in the chat, for broader topics the first two don't cover.

If none of the three find anything, Research says so plainly rather than sending the
student elsewhere.

There is **no API key, no environment variable, and no server call through your own
backend involved** — it's pure front-end logic calling two free, public, CORS-enabled
endpoints directly from the browser. It can't fail from a bad key, a rate limit, or a
billing issue on your end, and nothing here can break a deploy.

Honest limit: it can answer real topics and definitions well, but it can't write a
custom explanation or generate practice questions the way a true AI would — those need
a real AI provider (Gemini, OpenAI, Anthropic, etc.) with your own key and a small
serverless function. Ask Claude to wire one in any time.
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
