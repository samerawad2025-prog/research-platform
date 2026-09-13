# backend/ — currently empty, on purpose

This project doesn't have a separate backend codebase to put here. The "backend" today is exactly two things, both already elsewhere:

1. **`app/api/extract/route.js`** — the one server-side API route, part of the Next.js app itself (see `frontend/README.md` for why that hasn't moved either).
2. **Supabase** — the database, storage, and the three RPC functions that make up the actual public write/read API (see `supabase/` and `docs/database.md`).

There is currently no standalone backend service (no separate Express/Node process, no dedicated API server) — the architecture is intentionally a Next.js app plus a managed Postgres backend, not a traditional three-tier split. See `docs/architecture.md` for why: one founder, near-zero budget, and every layer added is a layer that has to be run and paid for by that one person.

If a genuine standalone backend service is ever introduced, this is where it would go. Until then, treat this folder as reserved, not incomplete.
