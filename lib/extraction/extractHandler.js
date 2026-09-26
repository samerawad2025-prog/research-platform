// lib/extraction/extractHandler.js
//
// The whole of POST /api/extract, minus the HTTP wrapper. It lives here,
// as plain CommonJS with its collaborators passed in, so the rules it
// enforces can be exercised by a test against a fake database and a
// fake provider rather than only read (scripts/test-extraction-mode.js).
// app/api/extract/route.js is now a thin shell around it.
//
// Called with the confirmation token (never the paper's raw id as an
// auth mechanism). This is the one place in the whole app that holds
// the Gemini key and the Supabase service role key.

const crypto = require('node:crypto')
const { decideApplication } = require('./applyResult')
const { extractionAllowed, resolveExtractionMode } = require('../env')

// How long after CLAIMING a paper we treat its extraction as abandoned
// and allow another request to take it over.
//
// Must be strictly greater than maxDuration (app/api/extract/route.js).
// At 300s the platform has already killed the original invocation, so
// reclaiming after 360s cannot produce two live extractions of the same
// paper - which would double the provider calls and break the two-call
// ceiling this project enforces everywhere else. The margin is
// deliberately generous rather than tuned: the cost of reclaiming too
// early is a duplicate paid extraction, the cost of reclaiming too late
// is a minute of waiting.
const STALE_CLAIM_MS = 360_000

// Failure codes that describe a problem on OUR side or the provider's,
// not in the submitted document. A paper that failed this way is worth
// re-running: the document was never the problem. Observed in
// production 2026-09-20, when Google returned 503 "This model is
// currently experiencing high demand" and two perfectly good papers
// were left permanently failed (BUG_HISTORY.md #36).
//
// Deliberately excludes not_research, unsupported_file_type and
// encrypted_document: re-running those would produce the identical
// answer and spend a provider call to do it.
const TRANSIENT_FAILURE_CODES = ['api_error', 'timeout', 'empty_response', 'malformed_json', 'internal']

// A floor between retries of a failed paper, so the button cannot be
// used to hammer the provider. Short enough to be unnoticeable to
// someone genuinely retrying, long enough that a held-down click or a
// stuck reload loop cannot spend the budget.
const FAILED_RETRY_COOLDOWN_MS = 30_000

// Selected on every lookup. If migration 0011 has not been applied, this
// select fails outright, and the route refuses to run rather than
// guessing: without these columns it cannot know whether a manual
// decision exists, and a wrong guess could send a document out.
const PAPER_COLUMNS =
  'id, file_path, metadata_confirmed_at, extraction_status, extraction_started_at, created_at, failure_code, manual_entry_at, manual_entry_source'

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// A rejected status write used to be swallowed entirely: the row stayed
// on whatever status it already had, the route carried on and still
// returned 200, and the paper was stranded in 'processing' with nothing
// anywhere to diagnose it from. That is how a single bad `year` value
// cost a real submission (BUG_HISTORY.md #19). Every papers write now
// goes through here so a failure becomes a real, typed, recorded
// failure instead of silence.
function assertPapersWrite(error, stage) {
  if (!error) return
  const e = new Error(`Failed to update papers (${stage}): ${error.message}`)
  e.code = 'internal'
  e.diagnostics = { stage, pgCode: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null }
  throw e
}

function detectFileType(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  return 'unsupported'
}

const reply = (status, body) => ({ status, body })

// The database could not be read, or is behind the code (most likely
// migration 0011 missing). Distinct from "no such paper": a 404 here
// would tell the researcher their link is wrong when it is not.
function databaseNotReady(log, stage, error, mode) {
  log.error(JSON.stringify({ stage, pgCode: error?.code ?? null, message: String(error?.message || '').slice(0, 300) }))
  return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready', mode })
}

// Records the manual-entry decision, once, atomically. Only a paper with
// no decision yet and no confirmation matches, so two requests cannot
// both record, and a confirmation always wins. extraction_status is not
// touched: whatever happened to extraction before stays on the record.
async function recordManualEntry(supabase, paperId, source) {
  return supabase
    .from('papers')
    .update({ manual_entry_at: new Date().toISOString(), manual_entry_source: source })
    .eq('id', paperId)
    .is('manual_entry_at', null)
    .is('metadata_confirmed_at', null)
    .select('id')
}

async function lookupPaper(supabase, token) {
  return supabase
    .from('papers')
    .select(PAPER_COLUMNS)
    .eq('confirmation_token_hash', hashToken(token))
    .maybeSingle()
}

// Manual mode. Runs before the preview guard and before anything that
// could read the document: no storage download, no provider, no fetch.
// The only write records the manual decision on the paper, so a later
// switch back to automatic never quietly sends a document whose
// submitter was told they would describe it by hand.
//
// Every "not recorded" outcome says so (recorded: false, HTTP 503). The
// provider stays out of reach either way: this function has no path to it.
async function handleManual({ token, getSupabaseAdmin, log }) {
  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    // Previews carry no service-role key (bug P). Nothing can be
    // recorded, and the response says so.
    log.warn(JSON.stringify({ stage: 'manual_entry_not_recorded', reason: 'server_config' }))
    return reply(503, { error: 'Server configuration error.', reason: 'server_config', mode: 'manual', recorded: false })
  }

  const { data: paper, error: lookupError } = await lookupPaper(supabase, token)
  if (lookupError) return databaseNotReady(log, 'manual_lookup_failed', lookupError, 'manual')

  // The mode rides along on not-found too: it is not a secret, and it
  // lets an operator verify a deployment's mode with a request that
  // cannot touch any real paper (docs/deployment.md, "Rollout").
  if (!paper) {
    return reply(404, { error: 'Invalid confirmation link.', mode: 'manual' })
  }

  const base = { status: paper.extraction_status, mode: 'manual' }

  if (paper.manual_entry_at) {
    return reply(200, { ...base, recorded: true, manualEntry: paper.manual_entry_source })
  }
  if (paper.metadata_confirmed_at) {
    // Already the researcher's own record; nothing left to decide.
    return reply(200, { ...base, recorded: false, confirmed: true })
  }

  // A provider request already in flight for a 'processing' paper cannot
  // be recalled. Recording the decision here means its result, when it
  // lands, is appended to ai_generations and not applied to the paper.
  const { data: moved, error: recordError } = await recordManualEntry(supabase, paper.id, 'mode')
  if (recordError) {
    log.error(JSON.stringify({ stage: 'manual_entry_not_recorded', paperId: paper.id, pgCode: recordError.code ?? null }))
    return reply(503, { ...base, error: 'Could not record manual entry.', reason: 'manual_not_recorded', recorded: false })
  }
  if (!moved || moved.length === 0) {
    // Lost a race: recorded or confirmed by another request meanwhile.
    const { data: again } = await lookupPaper(supabase, token)
    return reply(200, {
      ...base,
      recorded: Boolean(again?.manual_entry_at),
      manualEntry: again?.manual_entry_source ?? null,
      confirmed: Boolean(again?.metadata_confirmed_at),
    })
  }
  log.log(JSON.stringify({ stage: 'manual_entry_recorded', paperId: paper.id, source: 'mode' }))
  return reply(200, { ...base, recorded: true, manualEntry: 'mode' })
}

// POST /api/manual-entry: the researcher chose to enter the details
// themselves. Authorized by the confirmation token exactly like the
// extraction route; the anonymous database role gains nothing. Works in
// either mode. Answers honestly: recorded is true only once the decision
// is actually stored.
async function handleManualChoice({ token, getSupabaseAdmin, log = console }) {
  if (!token) return reply(400, { error: 'Missing confirmation token.' })

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    log.warn(JSON.stringify({ stage: 'manual_choice_not_recorded', reason: 'server_config' }))
    return reply(503, { error: 'Server configuration error.', reason: 'server_config', recorded: false })
  }

  const { data: paper, error: lookupError } = await lookupPaper(supabase, token)
  if (lookupError) {
    const res = databaseNotReady(log, 'manual_choice_lookup_failed', lookupError)
    return reply(res.status, { ...res.body, recorded: false })
  }
  if (!paper) return reply(404, { error: 'Invalid confirmation link.' })

  if (paper.manual_entry_at) return reply(200, { recorded: true, manualEntry: paper.manual_entry_source })
  if (paper.metadata_confirmed_at) return reply(200, { recorded: false, confirmed: true })

  const { data: moved, error: recordError } = await recordManualEntry(supabase, paper.id, 'researcher')
  if (recordError) {
    log.error(JSON.stringify({ stage: 'manual_choice_not_recorded', paperId: paper.id, pgCode: recordError.code ?? null }))
    return reply(503, { error: 'Could not record manual entry.', reason: 'manual_not_recorded', recorded: false })
  }
  if (!moved || moved.length === 0) {
    const { data: again } = await lookupPaper(supabase, token)
    return reply(200, {
      recorded: Boolean(again?.manual_entry_at),
      manualEntry: again?.manual_entry_source ?? null,
      confirmed: Boolean(again?.metadata_confirmed_at),
    })
  }
  log.log(JSON.stringify({ stage: 'manual_entry_recorded', paperId: paper.id, source: 'researcher' }))
  return reply(200, { recorded: true, manualEntry: 'researcher' })
}

async function handleExtract({
  token,
  env = process.env,
  getSupabaseAdmin,
  getProvider,
  runExtraction,
  log = console,
}) {
  if (!token) {
    return reply(400, { error: 'Missing confirmation token.' })
  }

  // First, before the preview guard, the database or the provider. A
  // request cannot opt out of this: the mode comes only from the
  // server's own environment, never from anything the caller sends.
  const modeCheck = resolveExtractionMode(env)
  if (modeCheck.reason !== 'configured') {
    log.warn(JSON.stringify({ stage: 'extraction_mode_defaulted', mode: modeCheck.mode, reason: modeCheck.reason }))
  }
  if (modeCheck.mode === 'manual') {
    return handleManual({ token, getSupabaseAdmin, log })
  }

  // Checked before anything else touches the database or the AI
  // provider. Every env var on this project is scoped to preview as
  // well as production, including the service-role key, so without
  // this a branch preview writes to the real papers table and spends
  // the real Gemini quota (BUG_HISTORY.md #30).
  const envCheck = extractionAllowed(env)
  if (!envCheck.allowed) {
    log.warn(JSON.stringify({ stage: 'extraction_blocked', reason: envCheck.reason }))
    return reply(503, { error: envCheck.detail, reason: envCheck.reason })
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    log.error('Extraction route misconfigured:', err.message)
    return reply(500, { error: 'Server configuration error.', reason: 'server_config' })
  }

  const { data: paper, error: lookupError } = await lookupPaper(supabase, token)
  if (lookupError) return databaseNotReady(log, 'extraction_lookup_failed', lookupError, 'automatic')

  if (!paper) {
    return reply(404, { error: 'Invalid confirmation link.', mode: 'automatic' })
  }

  // A recorded manual decision is final for automatic extraction: no
  // provider call starts for this paper again, whatever the mode is now.
  if (paper.manual_entry_at) {
    return reply(200, { status: paper.extraction_status, alreadyHandled: true, manualEntry: paper.manual_entry_source })
  }

  // A human-confirmed record never starts a new provider call. There is
  // nothing to apply it to (confirmed values are never overwritten), so
  // the call could only send the document out for no purpose. Before
  // M1 no confirmed paper could be claimable here - confirming was
  // impossible until extraction finished - but manual entry makes
  // "confirmed while pending or failed" a real state.
  if (paper.metadata_confirmed_at) {
    return reply(200, { status: paper.extraction_status, alreadyHandled: true, confirmed: true })
  }

  // Concurrency guard, with one deliberate exception: a paper sitting
  // in 'processing' for longer than the platform will let any function
  // live is not being worked on by anybody. Before this, such a paper
  // was stuck permanently - the route refused to claim anything not
  // 'pending', so even the confirmation page's own "Try again" could
  // not rescue it, and it needed manual database surgery
  // (BUG_HISTORY.md #27, closing the open bug J).
  //
  // extraction_started_at is null on rows claimed before that column
  // existed. Such a row can only have been claimed by code that is no
  // longer deployed, so its own created_at is a safe fallback basis.
  function isAbandoned(row) {
    const basis = row.extraction_started_at || row.created_at
    if (!basis) return false
    return Date.now() - new Date(basis).getTime() > STALE_CLAIM_MS
  }

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const reclaiming = paper.extraction_status === 'processing' && isAbandoned(paper)

  // A transient failure is retryable, after a short cooldown. Without
  // this the "Try again" button on the failure screen calls this route
  // and is refused, so a paper that failed because the provider was
  // busy stays failed forever even though nothing is wrong with it.
  const cooledDown =
    !paper.extraction_started_at ||
    Date.now() - new Date(paper.extraction_started_at).getTime() > FAILED_RETRY_COOLDOWN_MS

  const retryingFailed =
    paper.extraction_status === 'failed' &&
    TRANSIENT_FAILURE_CODES.includes(paper.failure_code) &&
    cooledDown

  if (paper.extraction_status !== 'pending' && !reclaiming && !retryingFailed) {
    return reply(200, {
      status: paper.extraction_status,
      alreadyHandled: true,
      // So the client can tell "refused because too soon" apart from
      // "refused because this is genuinely final".
      retryable: paper.extraction_status === 'failed' && TRANSIENT_FAILURE_CODES.includes(paper.failure_code),
    })
  }

  // Built as an exact compare-and-swap in both cases: the update only
  // matches if the row still looks the way it did when it was read, so
  // two requests racing to reclaim the same abandoned paper cannot both
  // win. Deliberately two explicit branches rather than one composed
  // `.or()` filter - that would mean interpolating a timestamp into a
  // PostgREST filter string, which is both harder to reason about and
  // easy to get subtly wrong.
  // failure_code is cleared on every claim. For a fresh paper it is
  // already null; for a retried one, carrying the previous code forward
  // would leave a paper that then SUCCEEDS still looking like it failed.
  //
  // Every branch also requires metadata_confirmed_at and manual_entry_at
  // to still be null, so a confirmation or a manual decision that lands
  // between the read above and this write cannot be followed by a
  // provider call.
  let claimQuery = supabase
    .from('papers')
    .update({ extraction_status: 'processing', extraction_started_at: new Date().toISOString(), failure_code: null })
    .eq('id', paper.id)
    .is('metadata_confirmed_at', null)
    .is('manual_entry_at', null)

  if (retryingFailed) {
    // Same compare-and-swap shape: only the request that still sees
    // 'failed' wins, so two clicks cannot both start an extraction.
    claimQuery = claimQuery.eq('extraction_status', 'failed')
  } else if (reclaiming) {
    claimQuery = claimQuery.eq('extraction_status', 'processing')
    // Matching on "still stale" rather than on the exact timestamp
    // read. Both are correct compare-and-swaps - once one request wins,
    // the row's timestamp becomes now(), which is neither equal to the
    // old value nor less than staleBefore, so a second request matches
    // zero rows either way.
    //
    // This form is preferred because it does not depend on a timestamptz
    // round-tripping through PostgREST's text encoding byte-for-byte.
    // Postgres stores microseconds; a JS ISO string carries
    // milliseconds; an equality match across that boundary is a subtle
    // way to silently never match.
    claimQuery = paper.extraction_started_at
      ? claimQuery.lt('extraction_started_at', staleBefore)
      : claimQuery.is('extraction_started_at', null)
  } else {
    claimQuery = claimQuery.eq('extraction_status', 'pending')
  }

  const { data: claimed, error: claimError } = await claimQuery.select('id')

  // A failed claim is not the same as losing the race. Treating an
  // error as "someone else has it" would leave the paper pending with
  // nobody working on it and no sign anything went wrong.
  if (claimError) {
    log.error(JSON.stringify({ stage: 'claim_failed', paperId: paper.id, message: claimError.message }))
    return reply(500, { error: 'Could not start extraction. Please try again.' })
  }

  if (!claimed || claimed.length === 0) {
    return reply(200, { status: paper.extraction_status, alreadyHandled: true })
  }

  if (reclaiming) {
    // Worth its own line: this is the abandoned-extraction path, and
    // if it starts appearing often it means extractions are dying
    // rather than that the recovery is working well.
    log.log(JSON.stringify({ stage: 'stale_claim_reclaimed', paperId: paper.id, staleAfterMs: STALE_CLAIM_MS }))
  }

  if (retryingFailed) {
    // A rising count here means the provider is failing often enough
    // that people are having to retry by hand.
    log.log(JSON.stringify({
      stage: 'failed_retry_claimed',
      paperId: paper.id,
      previousFailureCode: paper.failure_code,
    }))
  }

  const providerName = env.AI_PROVIDER || 'mock'

  try {
    const fileType = detectFileType(paper.file_path)

    if (fileType === 'unsupported') {
      const { data: gen } = await supabase
        .from('ai_generations')
        .insert({
          paper_id: paper.id,
          generation_type: 'metadata_extraction',
          provider: 'none',
          model_used: 'none',
          status: 'failed',
          result_data: { rejection_reason: { status: 'found', value: 'unsupported_file_type' } },
          notes: `Unsupported file type for automatic extraction: ${paper.file_path}.`,
        })
        .select('id')
        .single()

      const { error: unsupportedError } = await supabase
        .from('papers')
        .update({ extraction_status: 'failed', last_applied_generation_id: gen?.id ?? null })
        .eq('id', paper.id)
      assertPapersWrite(unsupportedError, 'unsupported_file_type')

      return reply(422, {
        status: 'failed',
        reason: 'unsupported_file_type',
        message: 'We can only read PDF and DOCX files at the moment. Please upload your research in one of those formats.',
      })
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('papers')
      .download(paper.file_path)

    if (downloadError || !fileBlob) {
      throw new Error(`Could not download file from storage: ${downloadError?.message || 'unknown error'}`)
    }

    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer())
    const provider = getProvider()

    log.log(JSON.stringify({
      stage: 'extraction_start',
      paperId: paper.id,
      fileType,
      fileBytes: fileBuffer.length,
      provider: providerName,
    }))

    const extractionStartedAt = Date.now()
    const extraction = await runExtraction({ fileBuffer, fileType, provider })
    const extractionDurationMs = Date.now() - extractionStartedAt

    log.log(JSON.stringify({
      stage: 'extraction_complete',
      paperId: paper.id,
      fileType,
      durationMs: extractionDurationMs,
      passesRun: extraction.passesRun,
      documentType: extraction.documentType,
    }))

    // Every pass gets its own permanent row regardless of outcome.
    // This is the historical record; it is never overwritten.
    const generationRows = extraction.generations.map((g) => ({
      paper_id: paper.id,
      generation_type: 'metadata_extraction',
      provider: g.provider,
      model_used: g.model,
      status: 'success',
      result_data: { ...g.result, _diagnostics: g.diagnostics || null },
      notes: g.pass === 2 ? `Pass 2, targeted at: ${(g.missingFieldsRequested || []).join(', ')}` : 'Pass 1',
    }))

    // A research document that yielded nothing is worth a log line of
    // its own. It is stored as 'completed' - which is honest, the run
    // did complete - but in the status column it is indistinguishable
    // from a run that found everything, and that is how paper bdc6d112
    // (two passes, zero fields) went unnoticed.
    if (extraction.extractionYield.zeroYield && extraction.documentType !== 'not_research') {
      log.warn(JSON.stringify({
        stage: 'extraction_zero_yield',
        paperId: paper.id,
        documentType: extraction.documentType,
        passesRun: extraction.passesRun,
      }))
    }

    // A "merged" row only makes sense when there's an actual merge to
    // represent. On a partial outcome, pass 1's own row already IS the
    // current best result - there is nothing to merge it with.
    if (extraction.extractionStatus === 'completed') {
      generationRows.push({
        paper_id: paper.id,
        generation_type: 'metadata_extraction',
        provider: extraction.provider,
        model_used: extraction.model,
        status: 'success',
        result_data: extraction.finalResult,
        notes:
          `Merged result after ${extraction.passesRun} pass(es) in ${extractionDurationMs}ms. ` +
          `Document type: ${extraction.documentType || 'unknown'}. ` +
          `Fields found: ${extraction.extractionYield.foundCount}/${extraction.extractionYield.totalFields}.`,
      })
    }

    // The pass-2 failure itself is recorded as its own row. This is the
    // evidence trail the whole resilience phase exists for - a partial
    // outcome must be explainable later, not just observable.
    if (extraction.pass2Failure) {
      generationRows.push({
        paper_id: paper.id,
        generation_type: 'metadata_extraction',
        provider: providerName,
        model_used: env.GEMINI_MODEL || null,
        status: 'failed',
        result_data: { _diagnostics: extraction.pass2Failure.diagnostics },
        notes: `Pass 2 failed [${extraction.pass2Failure.code}]: ${extraction.pass2Failure.message}`.slice(0, 500),
      })
    }

    const { data: insertedGenerations, error: insertError } = await supabase
      .from('ai_generations')
      .insert(generationRows)
      .select('id, notes')

    if (insertError) throw new Error(`Failed to record extraction history: ${insertError.message}`)

    // The "current best result" row: the merged row when one exists,
    // otherwise pass 1's own row - which, on a partial outcome, is the
    // whole point: it's still there, still usable, still applied.
    const currentResultGeneration =
      insertedGenerations.find((g) => g.notes.startsWith('Merged')) ||
      insertedGenerations.find((g) => g.notes === 'Pass 1')

    // A CV, invoice, or similar. Nothing to confirm, so don't send the
    // submitter into a confirmation screen full of empty fields.
    // document_type is written explicitly here: without it the
    // confirmation page can't tell "this is a CV" apart from "extraction
    // crashed", which is exactly the generic-error problem being fixed.
    if (extraction.documentType === 'not_research') {
      // The applied-generation pointer only moves while nobody has
      // confirmed, for the same reason as the apply step below.
      const notResearchPatch = { extraction_status: 'failed', document_type: 'not_research' }
      const { data: pointed, error: notResearchError } = await supabase
        .from('papers')
        .update({ ...notResearchPatch, last_applied_generation_id: currentResultGeneration.id })
        .eq('id', paper.id)
        .is('metadata_confirmed_at', null)
        .is('manual_entry_at', null)
        .select('id')
      assertPapersWrite(notResearchError, 'not_research')
      if (!pointed || pointed.length === 0) {
        const { error: nrStatusError } = await supabase.from('papers').update(notResearchPatch).eq('id', paper.id)
        assertPapersWrite(nrStatusError, 'not_research_status_only')
      }

      return reply(422, {
        status: 'failed',
        reason: 'not_research',
        message: 'This document does not appear to be an academic paper, thesis, dissertation, conference paper, or journal article.',
      })
    }

    const { shouldApplyToPapers, papersUpdate } = decideApplication({
      alreadyConfirmed: Boolean(paper.metadata_confirmed_at),
      extractionResult: extraction.finalResult,
    })

    // extraction_status is now whatever the orchestrator determined:
    // 'completed' for a full run (one pass sufficient, or two passes
    // merged cleanly), 'partial' when pass 2 failed but pass 1's real
    // result survived intact. failure_code records WHY when partial,
    // so "partial" is never a dead end for debugging.
    const statusPatch = {
      extraction_status: extraction.extractionStatus,
      document_type: extraction.documentType || null,
      failure_code: extraction.pass2Failure ? extraction.pass2Failure.code : null,
    }

    let appliedToPapers = false
    if (shouldApplyToPapers) {
      // The confirmation read above is up to a few minutes old by now.
      // With manual entry available while this ran, the researcher may
      // have typed and confirmed their own details in the meantime, so
      // the "not yet confirmed" condition is enforced by the database in
      // the same statement as the write. A human's confirmed values are
      // never overwritten by a result that arrives late. The same holds
      // once manual entry has been recorded, confirmed or not: the
      // researcher's own entry is the authoritative source from then on.
      const { data: applied, error: applyError } = await supabase
        .from('papers')
        .update({ ...statusPatch, ...papersUpdate, last_applied_generation_id: currentResultGeneration.id })
        .eq('id', paper.id)
        .is('metadata_confirmed_at', null)
        .is('manual_entry_at', null)
        .select('id')
      assertPapersWrite(applyError, 'apply_result')
      appliedToPapers = Boolean(applied && applied.length)
    }

    if (!appliedToPapers) {
      // Already confirmed, before the claim or while this ran: the
      // papers columns and last_applied_generation_id are deliberately
      // left untouched. The run itself is still recorded in full above.
      const { error: statusError } = await supabase.from('papers').update(statusPatch).eq('id', paper.id)
      assertPapersWrite(statusError, 'status_only')
      if (shouldApplyToPapers) {
        log.log(JSON.stringify({ stage: 'extraction_result_not_applied', paperId: paper.id, reason: 'confirmed_or_manual' }))
      }
    }

    return reply(200, {
      status: extraction.extractionStatus,
      passesRun: extraction.passesRun,
      documentType: extraction.documentType,
      appliedToPapers,
      ...(extraction.pass2Failure ? { partialReason: extraction.pass2Failure.code } : {}),
    })
  } catch (err) {
    // Typed failures carry a code and the full diagnostics from the
    // Gemini call. Untyped ones (storage, database) fall back to
    // 'internal' so they are still distinguishable from a model failure.
    const code = err.code || 'internal'
    const diagnostics = err.diagnostics || null

    const FAILURE_MESSAGES = {
      max_tokens: 'The document was read, but the model ran out of its output budget before answering. This is a configuration issue on our side, not a problem with your file.',
      malformed_json: 'The document was read, but the model returned an unreadable answer.',
      api_error: 'We could not reach the extraction service. This is usually temporary.',
      timeout: 'The extraction service took too long to respond.',
      empty_response: 'The document was read, but the model returned nothing.',
      config: 'The extraction service is not configured correctly.',
      encrypted_document: 'This document is password-protected and cannot be processed automatically.',
      internal: 'Something went wrong while processing your submission.',
    }

    log.error(JSON.stringify({
      stage: 'extraction_failed',
      paperId: paper.id,
      failureCode: code,
      message: String(err.message).slice(0, 500),
      diagnostics,
    }))

    // Persist the diagnostics so they are readable in Supabase later,
    // not only in whatever log window happens to still be open.
    const { data: failGen } = await supabase
      .from('ai_generations')
      .insert({
        paper_id: paper.id,
        generation_type: 'metadata_extraction',
        provider: providerName,
        model_used: env.GEMINI_MODEL || null,
        status: 'failed',
        result_data: { _diagnostics: diagnostics, _failure_code: code },
        notes: `[${code}] ${String(err.message).slice(0, 400)}`,
      })
      .select('id')
      .single()

    // Deliberately does NOT use assertPapersWrite: this is already the
    // failure path, and throwing here would escape the catch and return
    // an empty 500, losing the typed message we are about to send. A
    // failure to record the failure is logged loudly and no more - the
    // paper stays 'processing' in that case, which is the one remaining
    // way to strand one, and is what the recovery path (bug J) exists
    // to cover.
    const { error: failWriteError } = await supabase
      .from('papers')
      .update({ extraction_status: 'failed', failure_code: code })
      .eq('id', paper.id)

    // Separate, and only while unconfirmed: a researcher who confirmed
    // their own details while this ran keeps the record they saw. Not
    // checked - the status write above is the one that matters.
    if (!failWriteError && failGen?.id) {
      await supabase
        .from('papers')
        .update({ last_applied_generation_id: failGen.id })
        .eq('id', paper.id)
        .is('metadata_confirmed_at', null)
        .is('manual_entry_at', null)
    }

    if (failWriteError) {
      log.error(JSON.stringify({
        stage: 'failure_status_write_failed',
        paperId: paper.id,
        failureCode: code,
        message: failWriteError.message,
      }))
    }

    return reply(500, {
      status: 'failed',
      reason: code,
      message: FAILURE_MESSAGES[code] || FAILURE_MESSAGES.internal,
    })
  }
}

module.exports = {
  handleExtract,
  handleManualChoice,
  STALE_CLAIM_MS,
  TRANSIENT_FAILURE_CODES,
  FAILED_RETRY_COOLDOWN_MS,
}
