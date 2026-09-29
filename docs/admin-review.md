# Admin review workflow (Phase 3 M4)

The protected area where administrators and volunteer reviewers look at
submissions, record what they checked, and make publication decisions.
**Nothing here publishes anything.** There are no public pages yet (M5/M6).
An "approved" record is a recorded decision that M5 will read through one
shared rule (`publication_eligibility`, below).

Feature flag: `ADMIN_REVIEW=enabled`. Anything else (or unset) and every
`/admin` page and `/api/admin/*` route answers 404.

Migration: `supabase/migrations/0015_admin_review.sql`. Requires 0012 and
0013 and Supabase Auth (`auth.users`). It is independent of 0014.
Migration numbers are not application order (see
`supabase/migrations/README.md`).

---

## 1. Who can do what

| | Administrator | Volunteer | Signed in, no role | Not signed in |
|---|---|---|---|---|
| Open the review area | yes | yes, after acknowledging the confidentiality commitment | "No review access" | sign-in form only |
| See the queue | all submissions | only submissions assigned to them | no | no |
| Open a submission and its confirmed metadata | any | only if assigned | no | no |
| Submitter's name, email, WhatsApp | yes | **no** | no | no |
| Open the original / a dissemination file | yes (audited) | assigned only, after acknowledgement (audited) | no | no |
| Private notes, issues, recommendations | read and write | read and write on assigned submissions | no | no |
| Decide: needs changes / reviewed / approve / decline / withdraw / reopen | yes | **no** | no | no |
| Assign or remove volunteers, manage staff and roles | yes | **no** | no | no |
| Institutions, units, eligibility | yes | list only | no | no |
| Set institution, legacy permission, authority verification, embargo | yes | no | no | no |
| Designate / upload reviewed document versions | yes | no | no | no |

A volunteer prepares recommendations. A recommendation changes no status
and notifies nobody.

### Where authority comes from

- The browser signs in with Supabase Auth. The application verifies the
  access token with `auth.getUser(token)` and uses **only the user id** it
  returns. Claims in the token (including `user_metadata` / `app_metadata`,
  which a user can influence) never confer a role; a test proves an account
  labelled `administrator` in its own metadata is refused.
- The role lives in `staff_members`, written only by administrators (or the
  one-time bootstrap below).
- Adding staff by email needs a lookup in the Supabase Auth directory. The
  server does that lookup **only after** confirming the caller is an active
  administrator; anyone else gets the same `forbidden` whatever email or id
  they sent, so the endpoint cannot be used to learn whether an account
  exists. The database checks the role again on the change itself.
- Every review function is `SECURITY DEFINER`, takes the acting user id, and
  **re-checks role, assignment and confidentiality acknowledgement itself**.
  Only `service_role` can execute them; `anon`, `authenticated` and `PUBLIC`
  are revoked, and the tables have RLS on with no browser grants. So a
  browser holding a valid session cannot call any of it directly through
  PostgREST (tested).
- An unassigned paper and a nonexistent paper both answer `forbidden` to a
  volunteer, so a volunteer cannot discover which papers exist.

### Volunteer confidentiality acknowledgement

A volunteer cannot read the queue, any submission, or any file until they
have acknowledged the **currently active** version. The acknowledgement
records the user, the version id, the language read, the SHA-256 of the text
**the server served**, and the time. Changing the wording is a new version
(new row, new hashes), never an edit; the old acknowledgements stay as
evidence and the new version must be acknowledged again.

The texts are `docs/legal/volunteer-confidentiality.en.md` / `.ar.md`.
**They are drafts for the founder to review.** The version row is seeded
inactive; nobody can pass the gate until it is activated (below). The Arabic
is not an official translation.

---

## 2. First administrator (manual, once)

There is no bootstrap from a claimed email, and no callable role-assignment
function. Steps, done by the project owner:

1. Supabase dashboard → Authentication → Settings: **turn off "Allow new
   users to sign up"**. Consider requiring MFA for staff (Authentication →
   Multi-Factor). Email confirmation should stay on.
2. Authentication → Users → **Add user** (or invite) with the administrator's
   email; confirm the email. Copy the user's **id** (a UUID).
3. In the SQL editor (runs as the database owner):
   ```sql
   select bootstrap_first_administrator('<that user id>');
   ```
   It refuses once any active administrator exists, requires a **confirmed**
   Auth user with exactly that id, and is **not executable** by `anon`,
   `authenticated` or `service_role` (so it cannot be reached through the app
   or the API).
4. Set `ADMIN_REVIEW=enabled` in the deployment environment and redeploy.
5. Sign in at `/admin`. From `/admin/settings` the administrator adds other
   staff (create each account in the dashboard first; then enter the email
   or user id there).
6. After the founder approves the confidentiality text, activate it:
   ```sql
   update confidentiality_versions set active = (id = 'volunteer-confidentiality-2026-09-29');
   ```
   (At most one version is active. A future wording is inserted as a new
   row with its hashes and the previous one deactivated.)

Removing the last active administrator through the app is refused.

Changes to staff are audited (`admin_audit_events`), including ones made by
hand in SQL (recorded as `database:<role>`).

---

## 3. Institutions and units

Tables: `institutions`, `institution_aliases`, `academic_units`,
`academic_unit_aliases`. Each has a source kind (and, where relevant, a
source URL and retrieval date), so provenance is visible.

- **Only University of Khartoum is eligible** at first. It is seeded with the
  aliases below. Every other institution is created ineligible.
- Eligibility is a property of the institution and is **separate from a
  record's review**. A record for a non-eligible institution can be marked
  *reviewed* (kept private) but can never be approved. Making an institution
  eligible later approves and publishes nothing by itself; a record must
  still be approved. Eligibility changes are audited (also when done by
  hand in SQL).
- **Matching is conservative.** The submitted text is never changed.
  Institution: an exact, normalized alias match to **exactly one**
  institution, otherwise "unresolved". A reviewer's choice is never
  overwritten by the automatic match. Units are matched automatically only
  once **verified**.
- **UofK units are seeded from the official directory.** Migration 0015
  seeds the **21** units listed at <https://uofk.edu/index.php/faculties>
  (20 faculties and the School of Management Studies), as that page was
  retrieved **during the founder's review of this milestone on
  2026-09-30**. The build environment could not open the page itself; the
  roster is copied exactly from that review, not fetched by the code or
  inferred from a headline count. Each row records the page address, the
  date, `source_kind = official_directory`, and is `verified`.
  English names only: the review recorded no Arabic headings, and no
  official Arabic translation is invented. An Arabic name can be added
  later from the official Arabic page.
- **The seed is repeatable.** A unit is inserted only if University of
  Khartoum has no unit with the same normalized English name. Rerunning the
  migration adds nothing and changes no existing row, including units
  entered by hand. Every seeded unit belongs to University of Khartoum.
- **Mapping stays conservative.** A submitted faculty is mapped to a unit
  only on an exact normalized match with one verified unit (or its alias).
  "Science", "Faculty of Medicine and Pharmacy", and other partial or
  combined text stay unresolved for a reviewer. The submitted text is never
  changed, and a reviewer's mapping is never overwritten. A naming variant
  backed by a source is added as an **alias** of the existing unit, never
  as another unit.

### Adding or correcting a unit later (operator)

1. Open the university's official directory page and note its address and
   today's date.
2. `/admin/settings` → University of Khartoum → *Add a faculty or unit*:
   the name **exactly as the page writes it**, the page address and the
   date read. Arabic only if the page gives it.
3. Verify it against the page. Only verified units are matched
   automatically.
4. Record alternative spellings as aliases, not as new units.

---

## 4. The review record

For each paper a `paper_reviews` row holds the review status:
`pending`, `needs_changes`, `reviewed`, `approved`, `declined`, `withdrawn`.
The screen shows four facts separately so they are never conflated:

1. **Submitted**: the file and details arrived.
2. **Confirmed**: the submitter confirmed the details with their private
   link.
3. **Reviewed**: a reviewer has recorded a decision other than "pending".
4. **Approved for publication**: an approval exists *and still covers the
   current content* (computed, see §6).

### Blocking issues suspend an approval

Anyone who can open a submission (an administrator, or the volunteer
assigned to it) can raise an issue, blocking or not. Only an administrator
resolves one.

- A **blocking** issue refuses every public use **at once**, through the
  shared rule (`publication_eligibility`): record, abstract and full text.
- If it is raised while an approval is in force, it records that approval
  (`review_issues.suspends_approval_id`). That approval is then
  **permanently suspended**: resolving the issue does **not** restore it.
  An administrator must approve again, against the then-current content,
  evidence and document version.
- The earlier approval stays in `review_approvals` as evidence (that table
  is append-only). The review status stays `approved` as history; the
  screen shows separately that an approval is on record and whether it is
  **in effect now**, and lists every approval with any suspension.
- A **non-blocking** issue changes nothing about eligibility.
- **Concurrency.** Raising an issue and recording a decision take the same
  row lock on the paper. An issue raised during an approval either waits
  and then suspends the approval it follows, or is seen by the approval,
  which is then refused. Neither can overlook the other (tested with two
  real concurrent transactions, in both orders).

Decisions (administrators only): needs changes, reviewed (keep private),
approve, decline, withdraw, reopen. Needs-changes, decline and withdraw
**require a reason**. **The submitter is not notified** by any decision; the
screen says so. There is no notification system in this version.

`papers.status` is not used by review; review state lives in
`paper_reviews`.

### Minimum metadata rule (stated explicitly)

To approve, a submission needs: confirmed by the submitter; a title in **at
least one** language; at least one author; a year (1900–2100); an abstract in
**at least one** language; not classified "not research". **Arabic and
English are never both required.** Missing supervisor, degree, university,
faculty or document type are shown as advisories, not blockers.

### Permission evidence

- **New path:** the acceptance record (agreement version and hash, setting,
  processing decision, claimed role) is the evidence. The acceptance is the
  submitter's **claim**: accepting the agreement does **not** verify identity
  or authority.
- A submission made as an **authorized depositor** cannot be approved until
  an administrator records **authority verification** (with a note on what
  they checked). The screen says "claimed" until then.
- **Legacy submissions** (before the agreement) have no acceptance and none
  is created or backdated. An administrator determines what the old consent
  supports (record and abstract, or also full text, or **hold**) with a
  required note, capped by what the old checkboxes covered: full text needs
  the `full_paper` scope; any non-empty scope allows record and abstract;
  undetermined, or anything uncertain, stays on hold and cannot be approved.
- The full-text legal condition below is a *global* restriction that applies
  on top of all this.

### Duplicates (advisory only)

Same file hash, or a very similar normalized title with the same year (±1, or
year unknown; token similarity ≥ 0.75). A hint only: nothing is merged,
hidden or rejected because of it, and there is no similarity AI. Volunteers
see duplicates only on submissions also assigned to them, plus a count of
the rest.

### Documents and full text

- The **original** stays at its upload path in private storage; its SHA-256
  is registered (a legacy file's hash is computed by the server from private
  storage).
- For **full text** the reviewer designates a specific **approved document
  version**: either the reviewed original (copied server-side to a separate
  private object after checking its recorded hash) or a **redacted copy**
  the reviewer uploads (browser → server-issued signed upload URL → the
  server checks size and PDF/DOCX signature and hashes it) with a note
  saying what was removed and why. There is no automated redaction.
- Approving a full-text record **stores that version's id and hash** in the
  approval. Approving supersedes an earlier approved copy.
- Opening any file goes through one audited endpoint that takes the path
  from the database (never from the browser) and returns a signed URL valid
  for 60 seconds.

### Embargo and withdrawal

Independent of the decision. A withdrawn or embargoed record is not
eligible for any public use until reopened / the date passes, even if it was
approved.

### Audit

`admin_audit_events` is append-only (update, delete and truncate are blocked
by trigger, including for superusers). Each row has the actor, role, action,
time and structured detail. **Private note text is never copied into it.**
File openings, decisions, assignments, institution and eligibility changes,
staff changes, release-restriction changes and detected content changes are
all recorded. Private notes, recommendations and this history are never in
any public structure.

---

## 5. Full-text legal condition (release restriction)

`release_restrictions` row `fulltext_legal_advice` (seeded **active**). While
it is active, `publication_eligibility` reports `fulltext_public = false`
with the reason `fulltext_legal_condition_pending` for every record,
whatever its approval. **Approving cannot lift it.** A missing row is treated
as restricted.

Only the founder, after obtaining the legal advice recorded in
`docs/legal/README.md`, lifts it (SQL editor):
```sql
update release_restrictions set active = false, lifted_note = '<who advised, when>'
 where key = 'fulltext_legal_advice';
```
The change is audited even when made by hand.

---

## 6. Approvals are tied to what was reviewed

An approval (`review_approvals`, append-only) records the exact
**content fingerprint** (SHA-256 of the submitter-controlled material:
metadata fields, authors and their order, setting/scope, the file hash), the
institution mapping, the permission evidence and, for full text, the
dissemination version id and hash.

- **Later material changes do not inherit the approval.** Eligibility is
  derived by comparing the approval's fingerprint with the current one. No
  trigger sits on the submitter's write path. The change is logged once,
  when next noticed (`content_changed`).
- **Stale screens.** Every screen carries a `revision` (covering content,
  status, institution, legacy setting, authority, withdrawal, embargo,
  issues and documents). A decision made on an older revision is refused with
  `stale_revision`; the screen reloads. The paper and review rows are locked
  during a decision, so an approval racing a submitter's edit either sees the
  edit (refused) or is recorded against the pre-edit content and immediately
  reports itself as no longer covering the new content. Tested with a real
  concurrent approve-versus-edit. Withdrawal is exempt (it is a restriction,
  and must always succeed).
- Institution eligibility, withdrawal and embargo are separate from the
  decision.

### The shared rule for M5/M6

M5 uses it for every public surface (`docs/public-research.md`). The review screen shows *Open the public page* only when the record is public right now and the public site is switched on.

`publication_eligibility(paper)` returns:
`review_approved`, `record_public`, `abstract_public`, `fulltext_public`,
`reasons`, `fulltext_reasons`, `restrictions`. Every future public page,
file, API response, search result, sitemap, citation export and activity
count must call this one function, and must not compute its own. Hiding a
link is not access control.

---

## 7. API surface

All under `/api/admin/…`, `Authorization: Bearer <access token>`, JSON,
`Cache-Control: no-store`, `X-Robots-Tag: noindex`, GET and POST only.

`me`, `confidentiality` (+ `acknowledge`), `queue`, `reviews/:id`,
`reviews/:id/eligibility`, `…/decision`, `…/notes`, `…/recommendation`,
`…/issues` (+ `:issue/resolve`), `…/assignments` (+ `:volunteer/end`),
`…/institution`, `…/legacy-setting`, `…/authority`, `…/embargo`,
`…/documents` (+ `:version/finalize`, `:version/withdraw`),
`…/files/access`, `staff`, `institutions` (+ `:id/eligibility`, `aliases`,
`units`), `units/:id/verify`, `units/:id/aliases`.

Bodies are strict (unknown fields refused). Errors are codes with a plain
message in the interface's language; database messages are never shown.

---

## 8. Tests

| Tier | Command | Covers |
|---|---|---|
| Handlers, mocked (CI) | `node scripts/test-admin-handlers.js` | routing, validation, status mapping, flag, registry hashes match the files |
| Real Postgres | `supabase/tests/run-0012.sh` (runs `admin-postgres.test.js`) | roles, boundaries, preconditions, eligibility, revision/concurrency, audit, institutions, duplicates, legacy, documents |
| Local Supabase stack | `supabase/tests/local-stack/start.sh`, then `supabase/tests/run-admin-e2e.sh` | real GoTrue tokens, PostgREST direct-call denial, files through real Storage, and the interface in Chromium (EN/AR, keyboard, 360–1440 px) |

## 9. Known limitations and release requirements

- Material changes are logged the next time the record is read, not at the
  instant of the edit (the approval itself stops covering the change
  immediately).
- No notification to submitters. Contact them yourself when needed.
- A pending (never finalized) redacted upload stays visible until it is
  discarded; there is no automatic cleanup.
- Before real use: founder approval of the confidentiality text (and
  activation); disable public sign-up and consider MFA; verify the hosted
  Auth and Storage behaviour (signed-URL lifetime, CORS for the browser
  upload) on the preview project; Arabic unit names from the official
  Arabic page, if wanted; the legal advice for full text (the restriction
  stays until then); hosted gateway/CORS for `/api/admin`.
