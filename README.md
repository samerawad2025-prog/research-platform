# Sudanese Academic Research Platform

A low-budget platform for Sudanese research. A researcher submits a thesis or paper (PDF or DOCX). An AI extracts structured metadata, and the researcher reviews, corrects and confirms it. The interface is bilingual, English and Arabic.

Built with Next.js, Supabase and Vercel.

## Where to start

| Need | Read |
|---|---|
| What is running and verified today | `CURRENT_STATUS.md` |
| What is planned next (Phase 3) | `PHASE_3_PLAN.md` |
| Rules for working in this repository | `CLAUDE.md` |
| Environment variables and deploy process | `docs/deployment.md` |
| Architecture, database, extraction | `docs/architecture.md`, `docs/database.md`, `docs/extraction-pipeline.md` |
| Submission agreement text (not yet active) | `docs/legal/` |

## Local development

```
npm install
npm run dev        # http://localhost:3000
npm run lint
npm test           # the runnable scripts/test-*.js suites
```

There is no `.env.local.example`. Create a git-ignored `.env.local` with the variables listed in `docs/deployment.md`. At minimum you need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. `AI_PROVIDER` defaults to `mock`, so no AI key is needed for local work.

Only one Supabase project exists, so local and preview builds that point at it write to the production database. See `CURRENT_STATUS.md`.
