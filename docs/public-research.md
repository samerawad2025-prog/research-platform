# Public research pages (Phase 3 M5)

The public side of the repository: a catalogue with search and filters, a
page per work at `/research/[publicId]`, and reading or downloading of the
approved document where full text is permitted.

**It is off by default.** With `PUBLIC_RESEARCH` unset (or anything but
`enabled`), `/research`, the research JSON endpoints and the file route all
answer 404. The sitemap is empty, and the header shows no "Browse research"
link. Nothing is public until the release requirements at the end of this
page are met and the flag is set deliberately.

Migration: `supabase/migrations/0016_public_research.sql` requires 0015.
Citation export and activity metrics are M6, not here.

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
    This is tested.
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
