// app/api/extract/route.js
//
// Server-only. Called by the browser right after a successful
// submission, passing the confirmation token (never the paper's raw id
// as an auth mechanism). This route is the one place in the whole app
// that holds the Gemini key and the Supabase service role key.

import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'
import { runExtraction } from '../../../lib/extraction/orchestrator'
import { decideApplication } from '../../../lib/extraction/applyResult'
import { getProvider } from '../../../lib/ai'

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function detectFileType(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  return 'unsupported'
}

export async function POST(request) {
  const { token } = await request.json().catch(() => ({}))

  if (!token) {
    return Response.json({ error: 'Missing confirmation token.' }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    console.error('Extraction route misconfigured:', err.message)
    return Response.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  const { data: paper, error: lookupError } = await supabase
    .from('papers')
    .select('id, file_path, metadata_confirmed_at, extraction_status')
    .eq('confirmation_token_hash', hashToken(token))
    .maybeSingle()

  if (lookupError || !paper) {
    return Response.json({ error: 'Invalid confirmation link.' }, { status: 404 })
  }

  // Concurrency guard: only proceed if we're the request that actually
  // moves this paper from pending to processing. A second overlapping
  // request finds zero rows updated and stops, rather than running
  // extraction twice and burning quota for nothing.
  const { data: claimed } = await supabase
    .from('papers')
    .update({ extraction_status: 'processing' })
    .eq('id', paper.id)
    .eq('extraction_status', 'pending')
    .select('id')

  if (!claimed || claimed.length === 0) {
    return Response.json({ status: paper.extraction_status, alreadyHandled: true })
  }

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

      await supabase
        .from('papers')
        .update({ extraction_status: 'failed', last_applied_generation_id: gen?.id ?? null })
        .eq('id', paper.id)

      return Response.json({
        status: 'failed',
        reason: 'unsupported_file_type',
        message: 'We can only read PDF and DOCX files at the moment. Please upload your research in one of those formats.',
      }, { status: 422 })
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('papers')
      .download(paper.file_path)

    if (downloadError || !fileBlob) {
      throw new Error(`Could not download file from storage: ${downloadError?.message || 'unknown error'}`)
    }

    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer())
    const provider = getProvider()

    console.log(JSON.stringify({
      stage: 'extraction_start',
      paperId: paper.id,
      fileType,
      fileBytes: fileBuffer.length,
      provider: process.env.AI_PROVIDER || 'mock',
    }))

    const extractionStartedAt = Date.now()
    const extraction = await runExtraction({ fileBuffer, fileType, provider })
    const extractionDurationMs = Date.now() - extractionStartedAt

    console.log(JSON.stringify({
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
        notes: `Merged result after ${extraction.passesRun} pass(es) in ${extractionDurationMs}ms. Document type: ${extraction.documentType || 'unknown'}.`,
      })
    }

    // The pass-2 failure itself is recorded as its own row. This is the
    // evidence trail the whole resilience phase exists for - a partial
    // outcome must be explainable later, not just observable.
    if (extraction.pass2Failure) {
      generationRows.push({
        paper_id: paper.id,
        generation_type: 'metadata_extraction',
        provider: process.env.AI_PROVIDER || 'mock',
        model_used: process.env.GEMINI_MODEL || null,
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
      await supabase
        .from('papers')
        .update({
          extraction_status: 'failed',
          document_type: 'not_research',
          last_applied_generation_id: currentResultGeneration.id,
        })
        .eq('id', paper.id)

      return Response.json({
        status: 'failed',
        reason: 'not_research',
        message: 'This document does not appear to be an academic paper, thesis, dissertation, conference paper, or journal article.',
      }, { status: 422 })
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
    const papersPatch = {
      extraction_status: extraction.extractionStatus,
      document_type: extraction.documentType || null,
      failure_code: extraction.pass2Failure ? extraction.pass2Failure.code : null,
    }
    if (shouldApplyToPapers) {
      Object.assign(papersPatch, papersUpdate, { last_applied_generation_id: currentResultGeneration.id })
    }
    // If already confirmed, the papers columns and
    // last_applied_generation_id are deliberately left untouched.

    await supabase.from('papers').update(papersPatch).eq('id', paper.id)

    return Response.json({
      status: extraction.extractionStatus,
      passesRun: extraction.passesRun,
      documentType: extraction.documentType,
      appliedToPapers: shouldApplyToPapers,
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

    console.error(JSON.stringify({
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
        provider: process.env.AI_PROVIDER || 'mock',
        model_used: process.env.GEMINI_MODEL || null,
        status: 'failed',
        result_data: { _diagnostics: diagnostics, _failure_code: code },
        notes: `[${code}] ${String(err.message).slice(0, 400)}`,
      })
      .select('id')
      .single()

    await supabase
      .from('papers')
      .update({
        extraction_status: 'failed',
        failure_code: code,
        last_applied_generation_id: failGen?.id ?? null,
      })
      .eq('id', paper.id)

    return Response.json({
      status: 'failed',
      reason: code,
      message: FAILURE_MESSAGES[code] || FAILURE_MESSAGES.internal,
    }, { status: 500 })
  }
}
