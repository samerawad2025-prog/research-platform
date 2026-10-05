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

Copy `.env.local.example` to a git-ignored `.env.local` and fill it in; `docs/deployment.md` explains every variable. `EXTRACTION_MODE` defaults to `manual` (no document is sent to any AI provider), and in `automatic` mode `AI_PROVIDER` defaults to `mock`, so no AI key is needed for local work.

Only one Supabase project exists, so local and preview builds that point at it write to the production database. See `CURRENT_STATUS.md`.
