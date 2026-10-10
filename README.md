# Study Partner

A static front-end (`index.html`) plus two small Vercel serverless functions in `api/`.
No build step — deploy as-is.

## 1. Deploy to Vercel

**Dashboard (easiest):** go to https://vercel.com/new, choose "Deploy without Git" /
drag-and-drop, and drop this whole folder in.

**CLI:** `npm i -g vercel`, then from inside this folder run `vercel`, then `vercel --prod`.

**GitHub:** push this folder to a repo and import it at https://vercel.com/new.
Framework preset "Other" — no build command, output directory is `/`.

## 2. Shared accounts, ads and home pictures (Upstash Redis)

Without a database every phone keeps its own private copy of everything. With it connected, accounts,
profile pictures, activities, ads and home-page photos follow every student on every device.

1. Vercel → your project → **Storage** → **Create Database** → **Upstash for Redis** (free plan).
2. Connect it to the project, then **Deployments → ⋯ → Redeploy**.
3. Check: open `https://YOUR-SITE.vercel.app/api?a=health` → it must say `"ready":true`.

What this gives you:
- **Login from any device** brings back the student's name, school/level, profile picture, display
  preference (white/night) and their Activity timetable.
- **Ads and the seven home-page photos** posted by the admin show on every account. Pictures are stored
  once and served from their own cached links, so the home page stays small and fast on mobile data.
- A crowd on one Wi-Fi network is fine: sign-ups/log-ins are limited per account name, not per network,
  so one shared campus IP can't lock out a classroom (150 sign-ups from one IP were tested).

**It keeps working on slow connections.** The app now retries the server with longer waits (a freshly woken
server can take several seconds on mobile data), remembers the last good ads and day photos on each device so
the Home slideshow is instant, and refreshes them every minute and whenever the app is reopened. If a device
really cannot reach the server it says so — it never silently creates a this-phone-only account.

**Check it in one tap.** Sign in as admin → **Status** tab → **Run check**. It confirms the database, loads every
day photo and every live ad, and shows which optional keys are set, with a plain-English fix for anything wrong.

**Home slideshow.** Slide 1 is today's photo, slide 2 is the student's plan for today (sorted by time; if today is
empty it shows the next day that has activities), slide 3 is the live ad. The Activity page now opens on today.

Still saved only on the device that created it: Library courses (files, notes, links), PASCO items,
course progress/certificates and study-timer history.

**Important — change the admin login before launch.** The default (`Yo Lord!` / `#124#`) is visible in
the public code. Sign in as admin → **Admin login** tab → set your own name and password. The dashboard
shows a red warning until you do.

## 3. Search page (Google + YouTube, shown inside the site)

**Search** is in the main menu, and a floating 🔍 button on Library, PASCO and Online Courses opens it too. Students type a question, choose **Google** or **YouTube**, and the answer
appears *below the search bar, inside Study Partner* — videos play in an embedded frame, and recent searches
are kept as chips. There are no new tabs for the search itself.

**Answers from Google, inside the page.** On the Google tab a card at the top answers the question using Google
Search and lists the sources it used (like Google's own "AI Overview"), followed by more results. It needs one
free key: get it at **https://aistudio.google.com/apikey**, add it in Vercel → Settings → Environment Variables as
`GEMINI_API_KEY`, and redeploy. Open `https://YOUR-SITE.vercel.app/api?a=answertest` to see in seconds whether the
key works (it never shows the key). Answers are cached for six hours and shared by all students, so the free
allowance goes a long way. If the key is missing or Google is busy, the card simply does not appear and
everything else still works. Some newly issued `AQ.` keys are rejected by a bug on Google's side — if the test
says `bad_key`, create another key.

**Read articles without leaving.** Tapping a Wikipedia result opens the article inside the page (with its picture
and sections, and "Show the full article"). Under every search there is also a **Search on Google ↗** link for
anything the site cannot answer, and **search on YouTube ↗** under video results.

**YouTube — works immediately.** Results are videos that can be played in the page. Out of the box the server
reads YouTube's public results page, which is best-effort (YouTube can change it). For a dependable setup add
a free `YOUTUBE_API_KEY` in Vercel (Google Cloud Console → create a project → enable *YouTube Data API v3* →
Credentials → API key). That gives roughly 100 different searches per day; every result is cached for an hour
and shared by all students, so repeat searches cost nothing. With the key, only videos that allow embedding are
listed. If a particular video still refuses to play in the frame, an "Open on YouTube" link is next to it.

**Google — needs one free setting.** Google does not allow its own results page to be shown inside another
website (that is a Google rule, for every site). The official way is a free *Programmable Search Engine*, which
shows Google's real results in a box inside your page:
1. Go to **https://programmablesearchengine.google.com** → **Add** → choose **Search the entire web** → create it.
2. Copy the **Search engine ID**.
3. In Study Partner: sign in as admin → **Search** tab → paste it → **Save**. (Or set `GOOGLE_CSE_ID` in Vercel.)
   No redeploy is needed; every student gets it within seconds.

Until that is set, the Google tab shows results from Wikipedia and DuckDuckGo, also inside the page. The
free engine shows a few Google ads. Links inside Google's results open the *other website* in a new tab, because
most websites refuse to be displayed inside someone else's page.

## 4. Slides and documents

Everything opens inside Study Partner; nothing has to be downloaded to be read.

| File | What students see |
|---|---|
| **PDF** | Every page, in-app |
| **PowerPoint .pptx** | **Converted to pictures in the background right after upload** (the card shows "Preparing slides… 3/24", then "✓ Slides ready"), then opened like PDF pages — instant, and identical every time. Slides are drawn by a **built-in renderer** (theme colours and fonts, backgrounds, titles and bullets, numbering, pictures — including photos dropped into layout placeholders, pictures inside PowerPoint's compatibility wrappers, and picture backgrounds from the theme — with crop, charts (column, bar, line, area, pie), SmartArt, tables, shapes, lines, groups) that needs no download from the internet. A 60-slide lecture converts in about 7 seconds. Files uploaded before this update are converted the first time they are opened |
| **Old .ppt (1997–2003)** | Best-effort in-app viewer from a third party (shows a small "Flyfish Viewer" mark). If it can't load, clear instructions. **Best practice: Save As .pptx before uploading** |
| **Word .docx** | The document text, in-app |
| **Old .doc** | Downloads. Save As .docx for in-app viewing |
| **Links** | Google Drive / Slides / Docs and YouTube links embed in-app and work for any file type, including old .ppt (Drive: set sharing to "Anyone with the link") |

**Picture conversion, in detail.** It runs on the student's own phone or computer while they keep using the app;
nothing is sent to any server. The pictures are saved beside the file and are removed when the course is
deleted. Before saving, the app checks that each picture really contains the slide — if a browser can't
make pictures (or draws a blank one), nothing is saved and the slides are simply drawn live instead.
Because the pictures live on that device, a student who opens the same course on another phone gets them
built again on first open.

How the .pptx viewer decides: saved pictures → live built-in renderer → a second viewer → a text view of every
slide. The **Switch viewer** button cycles through them if a slide ever looks wrong.
**Not drawn:** animations, video/audio, old EMF/WMF clip-art pictures and some special effects. Those show as a
labelled box. For slides that rely on them, upload a PDF export, which opens exactly as designed.

Files up to **40 MB** are accepted. They are stored in the browser (IndexedDB) of the device that uploaded
them and survive reloads.

## 5. PASCO fixes

Uploading a file *and* pasting questions at the same time used to silently drop the
pasted questions — both are now saved as separate items. The question parser is also
far more forgiving now: the "Q:" prefix is optional, and "Answer:", "Ans:", or
"Correct:" are all recognized (previously only an exact "Answer:" line worked).

## 6. Admin login

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

## 7. Ads: timing, and running your own

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

## Notes
- The Paystack **public** key is embedded in the front-end for the ad checkout — that's
  expected and safe. Never put a Paystack *secret* key in this file or any front-end code.
- `AUTH_SECRET` (optional env var): a random string used to sign login sessions. If you
  don't set one, a stable one is derived automatically from your database token, which is
  fine for most cases — set your own if you want to be able to invalidate all sessions by
  rotating it.
