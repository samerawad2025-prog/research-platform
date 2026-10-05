# Stage A2 — Production checklist (branch `claude/phase3-release-prep` @ `50d7d17f`)

Where: Supabase dashboard → project **mzpkiuovjppmavqkppem** (Production) → SQL Editor.
For every file: **New query**, paste the **whole** file, **Run**, compare with the
"Expected" line at the top of the file. Run them **in number order, one at a time**.
If any result differs from "Expected": **stop**, run nothing else, and send me the result.

Before you start
- [ ] `SHA256SUMS.txt` matches the files (optional: `sha256sum -c SHA256SUMS.txt`).
- [ ] Pick a quiet moment (no submissions expected for ~15 minutes).

| # | File | Expected |
|---|---|---|
| 1 | `01_preflight.sql` | `PASS` |
| 2 | `02_baseline.sql` | one row — **save it** (screenshot/copy) |
| 3 | `03_migration_0018_ai_processing_agreement.sql` (465 lines) | Success, no rows. The editor may warn about `drop … if exists`: confirm |
| 4 | `04_verify_0018.sql` | `PASS` |
| 5 | `05_record_0018.sql` | one row: `ai_processing_agreement` |
| 6 | `06_migration_0019_gemini_free_tier_agreement.sql` (152 lines) | Success, no rows (confirm the same warning if shown) |
| 7 | `07_verify_0019.sql` | `PASS` |
| 8 | `08_record_0019.sql` | one row: `gemini_free_tier_agreement` |
| 9 | `09_migration_0020_free_tier_full_document_agreement.sql` (37 lines) | Success, no rows |
| 10 | `10_verify_0020.sql` | `PASS` |
| 11 | `11_record_0020.sql` | one row: `free_tier_full_document_agreement` |
| 12 | `12_baseline_again.sql` | **identical to step 2**, except `agreements_new` 0 → 6; `agreements_active` still 0 |
| 13 | `13_final_verification.sql` | `PASS` |

After step 13
- [ ] Open the live site's submit page and one existing confirmation link: both load as before.
- [ ] Tell me "Stage A2 done" with the results of 02, 12 and 13. I will verify independently (read-only).

What this does and does not do
- Adds columns, functions and agreement versions 2, 3 and 4 — **all inactive**. Nothing is activated; `extraction_policy` is untouched.
- **No existing paper, researcher, AI-history row, agreement or acceptance changes** — files 02/12 prove it with hashes over every row.
- The live application (`f45dc690`) keeps working: it does not call the new functions, and its confirmation, confirm and legacy submit paths stay open (checked in 04/07/10/13).
- Not part of this stage: merging, deploying, activating version 4, changing any Vercel setting.

Rollback: not expected. If a verify file says STOP, do not continue; send me the output.
