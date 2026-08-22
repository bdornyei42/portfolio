# Personal website

Bendegúz Dörnyei's portfolio site, deployed as a Cloudflare Worker (`bdornyei42`).

## Layout

```
public/               Fully public. Deployed with no auth.
  index.html             The portfolio site.
  dashboard.html          Showcase "demo" of the budget tool - fake seed data only.
  planner-demo.html       Showcase "demo" of the year planner - sample courses only.

private/              NOT public. Own local git history + own private GitHub repo.
  admin/
    dashboard.html        The real budget tool. Deployed behind Basic Auth at /admin.
    planner.html          The real academic-year planner. Behind Basic Auth at /admin.
  sync.js                Pulls real transactions from SimpleFin Bridge. Run locally, never deployed.
  claim.js                One-time setup per bank connection (SimpleFin). Run locally, never deployed.
  credentials.json        SimpleFin access URLs - as sensitive as a bank password. Gitignored... except
  categorized-transactions.json  ...this folder is deliberately backed up to a PRIVATE GitHub repo,
                                   see save.bat and private/.gitignore.

src/
  worker.js              Cloudflare Worker entry point. Gates /admin/* with HTTP Basic Auth
                          (ADMIN_USER / ADMIN_PASSWORD secrets), serves everything else as-is.

site/                  Build output only (gitignored). deploy.bat assembles this from
                        public/ + private/admin/ right before every deploy.

wrangler.jsonc         Worker config: main = src/worker.js, assets directory = ./site,
                        plus the PLANNER_KV namespace binding (year planner storage).
deploy.bat             Rebuilds site/ and deploys to the bdornyei42 Cloudflare Worker.
save.bat               Commits + pushes public/ (portfolio repo) and private/ (private repo) separately.
```

## Why the split

`index.html` and the demo dashboard are meant to be shown off — no secrets, no
real data, safe to publish anywhere. The real budget tool talks to real
transaction data, so it lives at `/admin`, sits behind server-enforced Basic
Auth (not just a client-side JS check, which anyone can bypass by reading the
page source), and is backed up to a *separate, private* GitHub repo so the
public portfolio repo can never accidentally include it.

## One-time setup

1. **Cloudflare login** (once per machine):
   ```
   npx wrangler login
   ```
2. **Set the /admin password** (once, or whenever you want to rotate it):
   ```
   npx wrangler secret put ADMIN_USER
   npx wrangler secret put ADMIN_PASSWORD
   ```
   `deploy.bat` will refuse to deploy until both are set.
3. **GitHub CLI** (`gh`), logged in as `bdornyei42`, is used by `save.bat` to
   auto-create the private backup repo (`bdornyei42/portfolio-private`) the
   first time it runs. Install from https://cli.github.com/ and run
   `gh auth login` if you haven't already.

## Day to day

```
deploy.bat     # rebuild site/ and push it live to Cloudflare
save.bat       # commit + push both the public and private repos
```

## The year planner

An academic-year planner at `/admin/planner`. Import a syllabus (paste its
text) and it extracts the course, meeting days, class sessions, readings, and
every deadline with its grade weight — you review before anything's added. Views:
a semester grid (courses × days-by-week, your Excel layout), a month calendar, a
deadline tracker, and a course manager.

Unlike the budget tool, the **real** planner stores its data server-side in
**Cloudflare Workers KV**, not just one browser:

- `src/worker.js` exposes `/admin/api/planner` (GET/PUT), behind the same Basic
  Auth gate as the rest of `/admin`. State is a single JSON blob under the key
  `planner:state`.
- The page reads from the API on load and pushes a debounced save on every edit,
  with a sync indicator in the header. `localStorage` is kept only as an offline
  cache, so your plan follows you across devices/browsers.
- The KV namespace binding (`PLANNER_KV`) is in `wrangler.jsonc`. It was created
  once with `npx wrangler kv namespace create PLANNER_KV`; if you ever need to
  recreate it, run that and paste the new `id` into `wrangler.jsonc`.

The **public** demo at `/planner-demo.html` is the same interface with sample
courses and no backend — it's browser-only (`localStorage`), safe to show off.

## The budget tool

The real dashboard at `/admin` is the same interface as the public demo, but
loads/saves real transactions to this browser's `localStorage`. To pull real
transactions from your bank via SimpleFin Bridge instead of entering them by
hand:

1. Install [Node.js](https://nodejs.org/) 18+.
2. In SimpleFin Bridge, link a bank connection and generate a **setup
   token** (one per institution).
3. From this folder:
   ```
   npm run claim -- "<setup token>" chase
   ```
   Repeat per institution. Setup tokens are single-use.
4. Fetch and categorize:
   ```
   npm run sync
   ```
   Writes `private/categorized-transactions.json`. Loading that into the
   `/admin` dashboard automatically isn't wired up yet - for now it's a
   manual-entry tool, with the synced JSON available as a reference/export.

Tune categorization rules in the `RULES` array at the top of `private/sync.js`.

Run `npm run sync` on a schedule if you want it kept current - hourly is more
than enough (SimpleFin asks integrations to stay under ~24 requests/day per
connection). Windows: Task Scheduler. macOS/Linux: cron or a launchd/systemd timer.
