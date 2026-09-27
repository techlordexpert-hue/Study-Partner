# Study Partner

A single-page static app (`index.html`) — no build step needed.

## Deploy to Vercel

**Option A — Vercel dashboard (easiest)**
1. Go to https://vercel.com/new
2. Choose "Deploy without Git" / drag-and-drop, and drop this whole folder in.
3. Vercel will detect it as a static site and deploy it. Done.

**Option B — Vercel CLI**
1. Install the CLI: `npm i -g vercel`
2. From inside this folder, run: `vercel`
3. Follow the prompts (link/create a project), then `vercel --prod` to go live.

**Option C — GitHub**
1. Push this folder to a new GitHub repo.
2. Import the repo at https://vercel.com/new.
3. Framework preset: "Other" — no build command needed, output directory is `/`.

## Notes
- Everything runs client-side; data (accounts, courses, timetable, ads, uploaded day-photos)
  is stored in each visitor's own browser (localStorage), not on a server.
- The Paystack **public** key is embedded for the ad checkout — that's expected and safe.
  Never add a Paystack *secret* key to this file or any front-end code.
- Admin login: use the "Admin login" link in the footer.
