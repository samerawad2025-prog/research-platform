# frontend/ — currently empty, on purpose

The actual Next.js frontend code (`app/`, `components/`, `next.config.mjs`, `public/`) still lives at the repository root, not here, even though it appeared under `frontend/` in the planned structure.

**Why it wasn't moved automatically:** Vercel's three linked projects for this repo (see `docs/deployment.md`) currently expect to find `app/` and `package.json` at the repository root. Moving the working code into `frontend/` without also reconfiguring each Vercel project's "Root Directory" setting to `frontend/` would break the next deploy outright — the build would simply fail to find the app. That's a live-site-breaking change, and it wasn't one this specific request asked to be executed, only scaffolded.

**If you do want this migration done for real:**
1. Move `app/`, `components/`, `lib/`, `scripts/`, `public/`, `package.json`, `package-lock.json`, `next.config.mjs`, `jsconfig.json`, `eslint.config.mjs`, `.env.local.example` into `frontend/`.
2. Update all three Vercel projects' Root Directory setting to `frontend/`.
3. Redeploy and verify against real Supabase evidence before trusting it (see `docs/troubleshooting.md`) — this is exactly the kind of change that could silently fail in a way that looks like an unrelated bug.

Not done here because it's a deliberate, tested step in its own right, not something to bundle silently into a documentation restructuring.
