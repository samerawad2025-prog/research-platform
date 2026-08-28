// app/api/extract/route.js
//
// Server-only. Called by the browser right after a successful
// submission, passing the confirmation token (never the paper's raw
// id as an auth mechanism, matching the same rule as everywhere else).
// This route is the one place in the whole app that holds the Gemini
// key and the Supabase service role key.

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

  const supabase = getSupabaseAdmin()

  const { data: paper, error: lookupError } = await supabase
    .from('papers')
    .select('id, file_path, metadata_confirmed_at, extraction_status')
    .eq('confirmation_token_hash', hashToken(token))
    .maybeSingle()

  if (lookupError || !paper) {
    // Deliberately the same response whether the token is malformed,
    // unknown, or belongs to nothing: nothing to enumerate.
    return Response.json({ error: 'Invalid confirmation link.' }, { status: 404 })
  }

  // Concurrency guard: only proceed if we're the request that actually
  // moves this paper from pending to processing. A second overlapping
  // request (a retry, a double-click reaching the server twice) will
  // find zero rows updated here and stop, rather than run extraction
  // twice and burn quota for nothing.
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
      await supabase
        .from('papers')
        .update({ extraction_status: 'failed' })
        .eq('id', paper.id)
      await supabase.from('ai_generations').insert({
        paper_id: paper.id,
        generation_type: 'metadata_extraction',
        provider: 'none',
        model_used: 'none',
        status: 'failed',
        notes: `Unsupported file type for automatic extraction: ${paper.file_path}. This is expected for legacy .doc files; handle manually.`,
      })
      return Response.json({ status: 'failed', reason: 'unsupported_file_type' })
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('papers')
      .download(paper.file_path)

    if (downloadError || !fileBlob) {
      throw new Error(`Could not download file from storage: ${downloadError?.message || 'unknown error'}`)
    }

    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer())
    const provider = getProvider()

    const extraction = await runExtraction({ fileBuffer, fileType, provider })

    // Every pass gets its own permanent row, regardless of what happens
    // next. This is the historical record; it is never overwritten.
    const generationRows = extraction.generations.map((g) => ({
      paper_id: paper.id,
      generation_type: 'metadata_extraction',
      provider: g.provider,
      model_used: g.model,
      status: 'success',
      result_data: g.result,
      notes: g.pass === 2 ? `Pass 2, targeted at: ${(g.missingFieldsRequested || []).join(', ')}` : 'Pass 1',
    }))

    // A third row for the merged, final view used by the confirmation
    // screen, distinct from either raw pass, so "which generation is
    // actually live" is never ambiguous.
    generationRows.push({
      paper_id: paper.id,
      generation_type: 'metadata_extraction',
      provider: extraction.provider,
      model_used: extraction.model,
      status: 'success',
      result_data: extraction.finalResult,
      notes: `Merged result after ${extraction.passesRun} pass(es).`,
    })

    const { data: insertedGenerations, error: insertError } = await supabase
      .from('ai_generations')
      .insert(generationRows)
      .select('id, notes')

    if (insertError) throw new Error(`Failed to record extraction history: ${insertError.message}`)

    const mergedGeneration = insertedGenerations.find((g) => g.notes.startsWith('Merged'))

    const { shouldApplyToPapers, papersUpdate } = decideApplication({
      alreadyConfirmed: Boolean(paper.metadata_confirmed_at),
      extractionResult: extraction.finalResult,
    })

    const papersPatch = { extraction_status: 'completed' }
    if (shouldApplyToPapers) {
      Object.assign(papersPatch, papersUpdate, { last_applied_generation_id: mergedGeneration.id })
    }
    // If already confirmed, extraction_status still moves to 'completed'
    // (the AI operation itself succeeded), last_applied_generation_id and
    // the papers columns are deliberately left untouched.

    await supabase.from('papers').update(papersPatch).eq('id', paper.id)

    return Response.json({ status: 'completed', passesRun: extraction.passesRun, appliedToPapers: shouldApplyToPapers })
  } catch (err) {
    await supabase
      .from('papers')
      .update({ extraction_status: 'failed' })
      .eq('id', paper.id)
    await supabase.from('ai_generations').insert({
      paper_id: paper.id,
      generation_type: 'metadata_extraction',
      provider: process.env.AI_PROVIDER || 'mock',
      status: 'failed',
      notes: String(err.message).slice(0, 500),
    })
    console.error('Extraction failed:', err)
    return Response.json({ error: 'Extraction failed.' }, { status: 500 })
  }
}
