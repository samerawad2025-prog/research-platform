# Public research pages (Phase 3 M5)

> **Release order and steps live in [`docs/release-runbook.md`](release-runbook.md)** (authoritative since 2026-09-30). This file explains the reasoning; where the two differ, the runbook wins.

The public side of the repository: a catalogue with search and filters, a
page per work at `/research/[publicId]`, and reading or downloading of the
approved document where full text is permitted.

**It is off by default.** With `PUBLIC_RESEARCH` unset (or anything but
`enabled`), `/research`, the research JSON endpoints and the file route all
answer 404. The sitemap is empty, and the header shows no "Browse research"
link. Nothing is public until the release requirements at the end of this
page are met and the flag is set deliberately.

Migration: `supabase/migrations/0016_public_research.sql` requires 0015.
Citation export and activity counts (M6) are described in §7a.

---

## 1. One rule for every public surface

Every public read calls one database function, and each of those applies
`publication_eligibility()` from M4 again:

| Surface | Function | Returns for anything not public |
|---|---|---|
| `/research/[publicId]`, its page metadata and social preview, `/api/research/[publicId]` | `public_record(public_id)` | `null` → the same neutral 404 |
| `/research` results, totals, filter options and their counts, `/api/research` | `public_catalogue(filters)` | never listed or counted |
| `/sitemap.xml` | `public_sitemap()` | never listed |
| `/research/[publicId]/file` | `public_document(public_id)` | `null` → the same 404 |
| Review screen link | `admin_public_link(actor, paper)` | no link |

No route has its own, weaker check. A record is public only while **all**
of these hold:

- its latest approval is still in force: the content is unchanged since
  approval, the institution mapping is unchanged, the metadata is complete,
  the permission evidence and authority are unchanged, and no blocking
  issue has been raised since;
- no blocking issue is open;
- its institution is eligible;
- it is not withdrawn;
- it is not under an active embargo.

Full text additionally needs:

- the "record, abstract and full text" setting;
- the approved dissemination version;
- the global full-text legal restriction to be lifted.

That restriction **stays active** in this milestone.

**Fail closed.** If eligibility cannot be established (a database error, or
a missing service key), the page shows an error and no record content. The
catalogue shows its error message, and the file route answers 503. None of
these is ever read as "public".

**Allowlist.** Only these fields leave the database:

- title and Arabic title;
- abstract and Arabic abstract;
- year, degree and document type;
- supervisor, for a thesis only;
- institution and faculty or unit names;
- author names, in their confirmed order, with a LinkedIn link only where
  its owner set it public and it is an `https://…linkedin.com/` address;
- the publication setting;
- the full-text format and size, only while full text is public;
- the approval date, used for the sitemap.

These never leave it:

- email, WhatsApp and Facebook;
- the submitter's identity as such;
- acceptance evidence and reviewer notes or reasons;
- internal ids and storage paths;
- confirmation tokens.

## 2. Public identifiers and permanent links

- `public_records.public_id` is 12 random characters from an alphabet with
  no look-alikes (about 59 bits). It is not derived from the paper UUID or
  the confirmation token.
- It is assigned the first time a paper is approved and is kept for good,
  so a re-approval keeps the same address.
- Having an identifier publishes nothing: every read checks eligibility
  again.
- **Permanent links come only from `PUBLIC_SITE_ORIGIN`**, never from the
  request's Host header. This covers canonical URLs, the sitemap, social
  previews and the review-screen link.

While no permanent domain is decided, leave `PUBLIC_SITE_ORIGIN` unset. The
pages then work, but:

- they carry no canonical URL;
- they ask search engines not to index them;
- the sitemap is empty;
- the review screen shows a relative link.

Setting the origin later makes links permanent from then on. The public ids
do not change.

Only `https://` origins are accepted, apart from `http://127.0.0.1` and
`localhost` for local testing.

## 3. Browse and search

- The catalogue is scoped to what is public, which today means University
  of Khartoum. There is deliberately no university selector.
- Search covers titles, abstracts and author names in English and Arabic.
  Every word must appear. Folding is conservative, applied to the query and
  the searched text alike, and never to the text shown:
  - case;
  - the alef forms أ إ آ ٱ;
  - ى, ة and tatweel;
  - harakat;
  - Arabic-Indic and Persian digits;
  - punctuation.
- Filters: faculty or school (the verified unit the approval pinned), year,
  degree and type.
  - A filter appears only when public records give it more than one value.
  - Each count is the number of results you would get by choosing it.
  - Counts include public records only.
- State lives in the URL (`?q=&unit=&year=&degree=&type=&page=`). The form
  is a plain GET form, so it works by keyboard and without scripts.
- Results come 20 to a page, and at most 50 on request. Order is fixed:
  newest year first, then title, then id.
- Implementation: one SQL function over the public set. That is ample for
  the launch collection. Past several thousand public records, add a
  stored, folded search column with a trigram index. No external search
  service is needed.

## 4. Approved files, caching and the withdrawal window

- The bucket stays **private**. `/research/[publicId]/file?mode=read|download`:
  1. applies a request limit: 60 per client per 10 minutes, keyed by a
     keyed hash of the address, which is never stored as such;
  2. asks `public_document()`, which answers only while full text is public
     and returns the path of the **approved dissemination version** recorded
     in the approval. It never returns the submitted original, and never a
     path the visitor supplies;
  3. redirects (303) to a signed link to that object, valid for **60
     seconds**.
- Range requests go to the signed link, which covers only that object and
  lasts only 60 seconds. The route checks eligibility on every request,
  with or without a `Range` header.
- A PDF offers *Read online* (the browser's own viewer) and *Download*. A
  Word file offers *Download* only, with a note that it cannot be previewed.
- Nothing claims or attempts to prevent copying or printing.
- **Caching.**
  - Every public page, the JSON endpoints, the sitemap and the file route
    are rendered per request, with `Cache-Control: no-store` for pages,
    JSON and the file route. There is no page cache or CDN cache between a
    change in the database and the next request.
  - The only exposure window is a signed file link issued **before** a
    withdrawal: it keeps working for up to 60 seconds after it was issued.
    What the local tests establish, against the local Storage API only:
    - the link's token is issued with a lifetime of at most 60 seconds;
    - the link still works immediately after a withdrawal;
    - once its expiry time has passed (plus a 3-second clock tolerance), a
      **fresh** request with the same link is refused and returns no
      document bytes.

    Expiry ends *authorization* only. It does not reach a file already
    downloaded, a copy a browser or proxy has cached, or a document still
    open in a reader's viewer. Hosted Storage (and any CDN in front of it)
    must be checked separately before release.
  - Copies people already downloaded cannot be recalled. The agreement says
    so (`docs/legal/submission-terms.en.md` §5, §8).
  - If a CDN or proxy is added in front later, it must honour `no-store`,
    or this window grows.

## 5. Withdrawal and other changes

Withdrawal, a new blocking issue, an institution losing eligibility, an
embargo, and a material change by the submitter after approval each remove
the record from every surface on the next request.

- Resolving a blocking issue does **not** restore visibility. An
  administrator must approve again (M4).
- Every non-public record, for whatever reason, gets the same neutral "not
  available" page with a 404 status. No reason is given, and a withdrawal
  reason is never shown.
- A restored backup must have its withdrawals and restrictions reapplied
  before the site is switched back on.

The review screen shows *Open the public page* only when the record is
public right now **and** the public site is on. While the site is off, it
says that nothing has been published.

## 6. Configuration

| Variable | Default | Effect |
|---|---|---|
| `PUBLIC_RESEARCH` | unset (off) | `enabled` serves `/research`, `/api/research`, the file route and a non-empty sitemap |
| `PUBLIC_SITE_ORIGIN` | unset | The permanent origin, for example `https://research.example.org`. Unset means no canonical, no indexing, empty sitemap |

`robots.txt` always disallows `/confirm/`, `/admin` and `/api/`. It
advertises the sitemap only when both variables are set.

## 7. Tests

| Tier | Command | Covers |
|---|---|---|
| Mocked (CI) | `node scripts/test-public.js` | file route refusals, limits, 60 s links, DOCX download-only, origin handling, URL filters, the admin link gate |
| Real Postgres | `supabase/tests/run-0012.sh` (`public-postgres.test.js`) | every state (see below) on every read function, the field allowlist and leak search, Arabic/English search, combined filters, facet counts, pagination, grants |
| Local Supabase stack | `start.sh`, then `supabase/tests/run-public-e2e.sh` | real Storage and signed links, private bucket, HTML/JSON/sitemap/robots leakage, withdrawal window, keyboard search, pagination, filters, EN/AR at 320–1440 px |

The states tested:

- eligible metadata-only;
- eligible full text, in a synthetic database with the restriction lifted
  for the test only;
- private, pending and declined;
- withdrawn;
- suspended, including after the issue is resolved;
- ineligible institution, and institution eligibility withdrawn;
- active embargo;
- changed after approval;
- withdrawn and superseded dissemination versions;
- active full-text restriction.

## 7a. Citations and activity counts (Phase 3 M6)

### Citation export

Each public research page has a **Cite this research** panel, closed by
default and placed after the research itself. It offers:

- **Citation text**, which can be copied;
- **RIS** (`/research/[publicId]/cite?format=ris`) for Zotero, Mendeley and
  EndNote;
- **BibTeX** (`?format=bibtex`) for LaTeX tools.

All three are generated from the record's confirmed public fields
(`lib/public/citation.js`):

- **Authors** appear exactly as confirmed and in their order. A full name is
  never split into family and given names: BibTeX gets each name in braces,
  so it is read as one literal name.
- **Title**: the English title, with the Arabic one as the translated title
  (RIS `TT`, a BibTeX note, or in brackets in the text). An Arabic-only
  record uses its Arabic title. UTF-8 is kept.
- **Type:**
  - a thesis whose degree reads as a doctorate becomes `@phdthesis` / RIS
    `THES`;
  - a master's degree becomes `@mastersthesis`;
  - any other thesis becomes `@misc` with its degree as written;
  - an article becomes `@misc` / RIS `GEN`, because no journal is recorded
    and none is invented.
- **Nothing missing is invented.** A missing year is omitted (shown as
  "n.d." in the text only), and so are missing publishers, journals and
  degrees.
- **No DOI:** the schema records none, so none is exported. DOI
  registration and Crossref/OpenAlex lookups are out of scope.
- **Escaping:** BibTeX escapes `\ { } % & $ # _ ~ ^`. Line breaks and control
  characters are collapsed, so a value can never start a new RIS tag or
  break an entry.
- **URL:** from `PUBLIC_SITE_ORIGIN` only. Without it the exports have no
  URL, and the panel says the site has no permanent address yet. The
  request host is never used.
- **Same rule as the page:** a record that stops being public after its page
  was shown gets a 404 from the export route.

Validation:

- `scripts/test-citations-activity.js` (CI) checks structure, types,
  escaping, brace balance and the absence of invented fields.
- `scripts/validate-citations.py` (local; needs `bibtexparser` 1.4,
  `rispy` and `pylatexenc`) parses the exports with independent parsers and
  checks what a reference manager reads back. It covers English, Arabic,
  mixed-language and title-only records.

### Activity counts: what each one means

Four separate counts per record, shown under **Activity on this platform**.
Each is at most one per visitor, per kind, per record, per UTC day:

| Shown as | Counted when | Not counted |
|---|---|---|
| Page views | the page stayed **visible for 2 seconds** in a browser, which then sent a beacon | server rendering, metadata generation, prefetch/prerender, a hidden tab, `navigator.webdriver` browsers, reloads the same day |
| Requests to read the document online | the server issued a link to read the approved document (`mode=read`) | HEAD requests, which issue no link; refusals |
| Download requests | the server issued a download link | as above |
| Citation exports | an RIS or BibTeX file was served (GET), **or** the citation text was copied successfully | opening the panel, a failed copy, HEAD requests |

Issuing a document link does not prove the file was opened or fully
downloaded, so the labels say "requests". The page states that these are
platform activity counts, **not citations and not unique readers**.

### What is filtered out, and how

- **Automated traffic:**
  - declared bots, link-preview fetchers (WhatsApp, Slack, Facebook and
    others), headless and scripted clients, and requests without a browser
    string;
  - `Purpose` / `Sec-Purpose: prefetch`.

  This removes the obvious cases. It is not perfect bot detection.
- **Staff.** When a verified staff member opens the review area, the
  server sets an HttpOnly cookie that **it signed**, valid for 12 hours.
  - The cookie is a marker, `v1.<expiry>.<signature>`. It contains no user
    id or role.
  - It grants nothing: the review API authorizes by bearer token only and
    never reads cookies.
  - Its only effect is that this browser's activity is not counted.
  - A forged, altered or expired marker is ignored. No browser-supplied
    role or count is trusted.
- **Repeats.** Each visitor is represented by a **per-UTC-day** client key:
  an HMAC, made with a server secret, of the date, the address and the
  browser string.
  - It changes every UTC day, so no stored key links a client across
    days.
  - It approximates repeat clients and cannot identify people. People
    sharing a connection and browser can count as one visitor, and a
    changing address or browser can count as several.
- **Rate limit.** 300 events per client key per 10 minutes, across all
  records. The document route has its own limit, 60 per 10 minutes.
  - The 10-minute windows are aligned to the epoch, so a UTC day always
    begins a new window. The daily key never splits a window, and so never
    loosens the limit.
- **What the browser can send.** The event endpoint accepts only `{event}`,
  as `page_view` or `citation_copy`. Anything else, including a count or a
  role, is refused, and cross-site posts are refused too.

### Time budget

Metrics are optional; publication checks are not.

- Every metrics call, whether recording an event or reading the counts,
  has a **400 ms** budget (`METRICS_BUDGET_MS` in
  `lib/public/activity.js`). When the budget runs out:
  - the caller stops waiting;
  - the database request is aborted (supabase-js `abortSignal`);
  - the result is reported as not recorded or unavailable, never as a
    count.
- The page shows *Activity counts are not available right now*. The
  citation file is served, and the document redirect is sent.
- The document link is signed before the event is recorded, so a stall
  costs the reader at most the budget out of the link's 60 seconds.
- No background promise is left running: the request is awaited up to the
  budget and then aborted.
- **One honest imprecision.** A write that already reached the database
  before the abort can still complete afterwards. For example, the
  database may finish it once a lock is released. So a timed-out event can
  occasionally be counted, but it is never reported as counted.
- The publication rule (`public_record`, `public_document`) and the
  document route's request limit are **not** budgeted and never skipped. A
  slow check delays the answer; it does not let anything through.

### Temporary data, retention and privacy

| Where | What | Why |
|---|---|---|
| `activity_counts` | record, kind of event, total, when the total last changed | the counts shown |
| `activity_dedup` | a one-way key (the daily client key hashed again with the record and event) and when it was created | to count a client once a day per record and event |
| `submission_rate_limits` | rows keyed `activity:<first 32 hex of the daily client key>` or `public_file:<…>`, with a count per 10-minute window and the window's start time | the request limits |

- These rows **do contain timestamps**: the dedup row's creation time and
  the limiter window's start.
- There is no reading history. No row records a reader, an address, a
  browser string, a page sequence or an individual event.
- No cookie is set on readers, and there are no third-party analytics.
  Raw addresses and browser strings are neither stored nor logged.

**Cleanup, as it actually works:**

- Dedup and limiter rows become **eligible for deletion after 2 days**.
- They are deleted **during later requests**, in bounded batches: up to
  200 dedup rows per recorded event, and up to 50 limiter rows per limiter
  call.
- With little or no traffic, nothing runs, and rows stay until traffic
  resumes. **Two days is therefore not a guaranteed maximum.**

Manual maintenance, for quiet periods or before an export or review of the
database. Run it by hand in the Supabase SQL editor; there is no schedule:

```sql
select activity_purge_expired();
-- → {"activity_dedup_deleted": N, "rate_limit_rows_deleted": M}
```

It deletes every dedup row older than 2 days, and every `activity:` or
`public_file:` limiter row whose window started more than 2 days ago. It
touches no other limiter and no count. It is executable only by the
database owner: not by the application's service role and not by any
browser role.

### Publication boundaries

- Events are accepted only while the record is public.
- Document events are accepted only while its full text is public, which
  includes the legal restriction.
- Counts are shown only while the record is public. Document counts are
  shown only while full text is public, so a metadata-only record never
  appears to offer a document.
- When a record becomes unavailable, its counts are kept privately and
  shown again, unchanged, only after a fresh approval.

### Failure handling

- If counting fails or times out, the page, the citation and the document
  still work, and the event endpoint answers `{"recorded": false}`.
- If the counts cannot be read in time, the page says so instead of
  showing zeros.
- No alerts or activity emails are sent.

## 8. Before switching it on

1. The M4 release requirements (`docs/admin-review.md` §9), and migrations
   0015 and 0016 applied to the hosted project.
2. Real records reviewed and approved by an administrator.
3. A decision on the permanent domain, then `PUBLIC_SITE_ORIGIN`. It can
   stay unset for a soft launch without indexing.
4. `PUBLIC_RESEARCH=enabled`, then a redeploy.
5. Check on the hosted project: one public record, one withdrawn record,
   `robots.txt`, `sitemap.xml`, and that the storage bucket is still
   private.
6. Full text stays unavailable until the founder lifts the legal release
   restriction after advice (`docs/legal/README.md`).
