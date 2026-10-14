# Manual checklist — Stage E (0014) and the Preview cleanup

Two independent jobs. Neither touches Production variables or Production deployments.

## A. Stage E: close the old anonymous path (Supabase SQL Editor)

Project **mzpkiuovjppmavqkppem** (Production) → SQL Editor. For each file: **New query**,
paste the **whole** file, **Run**, compare with the "Expected" line at its top. In order,
one at a time; stop at the first difference and send me the result.

Already true (checked 2026-10-05 ~05:50 UTC): the new form is live (`15f94476`,
`dpl_HLAiNGzahHCpqG11DmhQN2LSYmP6`), Version 4 is active, and three synthetic signed
submissions completed end to end. The connector timed out on 0014 with nothing applied,
which is why this is manual.

| # | File | Expected |
|---|---|---|
| 1 | `01_preflight.sql` | `PASS` (Version 4 active, `signed_confirmed_v4` ≥ 3, legacy path still open) |
| 2 | `02_migration_0014_close_legacy_submission_path.sql` (135 lines, SHA-256 `799c0207…583be`) | Success, no rows. If it raises `0014: …`, nothing changed: send me the message |
| 3 | `03_verify_0014.sql` | `PASS` (`legacy_upload_policy` false, `browser_submit_paper` false, confirmation functions still open) |
| 4 | `04_record_0014.sql` | one row: `close_legacy_submission_path` |

Then tell me "Stage E done". I will verify from outside (an anonymous upload and an
anonymous `submit_paper` are refused; a new signed submission still completes) and record
the result.

**Rollback after 0014.** The old code (`f45dc690`) uploads anonymously and calls
`submit_paper` from the browser, so it cannot work once 0014 is applied. Use the levers
that keep the new code: `update extraction_policy set mode = 'manual', changed_at = now();`
(stops automatic reading for new submissions immediately), or unset `GEMINI_DATA_TERMS` and
redeploy (nothing is sent to Gemini). Restoring `f45dc690` is a last resort that also needs
the emergency block at the bottom of 0014 (it reopens the acceptance bypass).

## B. Preview cleanup (Vercel dashboard)

The Preview variable `2PBhcD9zqqab75xA` is already gone (checked). These six Preview
deployments were built while a Gemini key applied to Previews; my tools cannot delete
deployments. Each was checked: Preview (not Production), Ready, and holding no Production
address. For each: open the link, confirm the page says **Preview** and shows the commit
below, then **⋯ → Delete**.

| # | Deployment | Preview of |
|---|---|---|
| 1 | https://vercel.com/samer22/research-platform-5zpu/DiyvuhuGE6vM8R7dgAMqigLXQPr9 | `f45dc690` (production branch) |
| 2 | https://vercel.com/samer22/research-platform-5zpu/AABev6VkAmGkUKrGQtxC1YU5Q27y | `f45dc690` (production branch) |
| 3 | https://vercel.com/samer22/research-platform-5zpu/W5eP6FdVxuM7c6enKfCckJSZcfeW | `claude/phase3-release-prep` @ `9bdaa0e1` |
| 4 | https://vercel.com/samer22/research-platform-5zpu/GjRodmKFdkjfzoFqtHWanPVM8bkF | `claude/phase3-release-prep` @ `cae46ad1` |
| 5 | https://vercel.com/samer22/research-platform-5zpu/EyXkANSw3dSHcDxX7zbzAQwd21ND | `claude/phase3-release-prep` @ `50d7d17f` |
| 6 | https://vercel.com/samer22/research-platform-5zpu/Dc1imVcQxcyJWJHinvcDbTfBNC4n | `claude/phase3-release-prep` @ `98e6b4a8` |

Do **not** delete: `dpl_HLAiNGzahHCpqG11DmhQN2LSYmP6` (the live release),
`dpl_AbLbM1G3PTBSWt6MSBbn4vTEUa3E` (previous production, `f45dc690`), or any other
deployment marked Production.
