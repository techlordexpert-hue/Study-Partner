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

## 3. Research — in-app answers, your own PowerPoint preview, zero setup

The chat bubble in Library / PASCO / Online Courses is called **Research**. Nothing it
does ever opens a new tab or sends students elsewhere — every answer is shown directly
in the chat panel.

**How it answers, in order:**
1. **Built-in, zero-network replies** for common app questions (how do I create a
   course, how do I get a certificate, greetings, thanks) — these are plain code in
   `index.html`, not a network call of any kind. This is the one piece that is
   genuinely, fully "ours" with no outside service involved at all.
2. **DuckDuckGo's Instant Answer API** — a quick factual summary for recognized topics.
3. **DuckDuckGo's related topics** — a short list when there's no single clean answer.
4. **Wikipedia's search API** — real article titles and snippets shown as results in
   the chat for broader topics.

Research prioritizes exactly what the student typed over whatever course/lesson they
have open — course context is only blended in as a second attempt if the plain question
finds nothing, so a oddly-named test course can no longer pollute real searches.

**On being honest about "build your own AI":** DuckDuckGo and Wikipedia aren't AI chatbot
vendors — they're free public reference lookups, the same category as a dictionary, with
no account, no key, and nothing that can break a deploy or rack up a bill. A true
conversational AI that can answer *any* phrasing or write custom explanations needs an
actual language model, which only exists via a paid provider (Gemini, OpenAI,
Anthropic) or an impractically large download running in the browser. There's no way
around that technical reality — but nothing here needs one, and nothing here can fail
the way the Gemini integration did.

## 4. PowerPoint slides preview in-app

Uploaded `.pptx` files (Library materials and Online Course lesson slides) now open
inside Study Partner instead of forcing a download — each slide's text is pulled out
and shown as its own card, in order. Images, charts and exact visual layout aren't
shown (that would need real file hosting plus Microsoft/Google's slide-rendering
service, which this architecture doesn't have) — text only, but it opens right in the
app.

Older binary `.ppt` files (pre-2007 format) and `.doc`/`.docx` still download, since
there is no free client-side reader for those formats — the app tells the student that
clearly instead of staying silent about it.
## 5. Admin login

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
