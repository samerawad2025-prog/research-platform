// lib/ai/providers/gemini.js
//
// Written against Google's documented REST API shape
// (https://ai.google.dev/api/generate-content).
//
// RESILIENCE PHASE: adds exactly one bounded retry on the failure
// modes confirmed transient by production evidence (a real 503 was
// observed and logged). Retry is deliberately narrow: only HTTP 503,
// HTTP 429, and network-level failures (not aborts) are retried.
// MAX_TOKENS, malformed JSON, and timeouts are NOT retried, since
// identical input at temperature 0 has no reason to produce a
// materially different outcome on those paths, and a timeout retry
// would double the worst-case wait for likely no benefit.

const { EXTRACTION_INSTRUCTIONS, targetedInstructions } = require('../schema');
const { ExtractionError } = require('../../extraction/errors');
const { decideRetry } = require('../retryPolicy');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

function getMaxOutputTokens() {
  return Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4096);
}

function getThinkingLevel() {
  return process.env.GEMINI_THINKING_LEVEL || 'low';
}

function getTimeoutMs() {
  return Number(process.env.GEMINI_TIMEOUT_MS || 120000);
}

// A single attempt, no retry logic here. callGemini() below decides
// whether a failure from this function is worth retrying.
async function callGeminiOnce(parts, context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractionError('config', 'GEMINI_API_KEY is not set.');
  }

  const model = getModel();
  const maxOutputTokens = getMaxOutputTokens();
  const thinkingLevel = getThinkingLevel();
  const timeoutMs = getTimeoutMs();

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel },
    },
  };

  console.log(JSON.stringify({
    stage: 'gemini_request',
    pass: context.pass,
    attempt: context.attempt,
    model,
    maxOutputTokens,
    thinkingLevel,
    timeoutMs,
    approxRequestBytes: JSON.stringify(requestBody).length,
  }));

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const diag = { stage: 'gemini_request', pass: context.pass, attempt: context.attempt, model, durationMs, timeoutMs };
      console.error(JSON.stringify({ ...diag, outcome: 'timeout' }));
      const e = new ExtractionError('timeout', `Gemini did not respond within ${timeoutMs}ms.`, diag);
      e.httpStatus = 'timeout'; // never retried: a slow call retried is likely slow again
      throw e;
    }
    const diag = { stage: 'gemini_request', pass: context.pass, attempt: context.attempt, model, durationMs, networkError: String(err.message) };
    console.error(JSON.stringify({ ...diag, outcome: 'network_error' }));
    const e = new ExtractionError('api_error', `Network error calling Gemini: ${err.message}`, diag);
    e.httpStatus = null; // the policy reads a null status as "network level"
    e.networkError = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');

    // Parsed BEFORE truncation. The retry delay lives inside this body,
    // and the old code sliced it to 500 characters for logging and then
    // had nothing else to read - so RetryInfo was being thrown away
    // before anything could use it (BUG_HISTORY.md #29).
    let parsedBody = null;
    try {
      parsedBody = JSON.parse(errorBody);
    } catch {
      parsedBody = null;
    }

    const diag = { pass: context.pass, attempt: context.attempt, model, durationMs, httpStatus: response.status, body: errorBody.slice(0, 500) };
    console.error(JSON.stringify({ stage: 'gemini_response', outcome: 'api_error', ...diag }));

    const e = new ExtractionError('api_error', `Gemini API error ${response.status}.`, diag);
    e.httpStatus = response.status;
    // Carried so callGemini() can ask the policy what to do without
    // re-reading a body that has already been consumed.
    e.responseHeaders = response.headers;
    e.responseBody = parsedBody;
    throw e;
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  const usage = data?.usageMetadata || {};
  const text = candidate?.content?.parts?.[0]?.text;

  const diagnostics = {
    stage: 'gemini_response',
    pass: context.pass,
    attempt: context.attempt,
    model,
    durationMs,
    finishReason,
    maxOutputTokens,
    thinkingLevel,
    promptTokenCount: usage.promptTokenCount ?? null,
    candidatesTokenCount: usage.candidatesTokenCount ?? null,
    thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
    totalTokenCount: usage.totalTokenCount ?? null,
    responseChars: typeof text === 'string' ? text.length : 0,
    hasContentParts: Boolean(candidate?.content?.parts?.length),
  };
  console.log(JSON.stringify(diagnostics));

  if (finishReason === 'MAX_TOKENS') {
    const e = new ExtractionError(
      'max_tokens',
      `Gemini hit its output ceiling (maxOutputTokens=${maxOutputTokens}) before returning an answer. thoughtsTokenCount=${usage.thoughtsTokenCount ?? 'unreported'}.`,
      diagnostics
    );
    e.httpStatus = 'max_tokens'; // identical input/config hits the same ceiling again
    throw e;
  }

  if (!text) {
    const e = new ExtractionError('empty_response', `Gemini returned no content (finishReason=${finishReason}).`, diagnostics);
    e.httpStatus = 'empty_response';
    throw e;
  }

  try {
    return { parsed: JSON.parse(text), model, diagnostics };
  } catch (err) {
    const diag = { ...diagnostics, parseError: String(err.message), rawTextPreview: text.slice(0, 1000) };
    console.error(JSON.stringify({ ...diag, outcome: 'malformed_json' }));
    const e = new ExtractionError('malformed_json', `Gemini response was not valid JSON: ${err.message}`, diag);
    e.httpStatus = 'malformed_json';
    throw e;
  }
}

// At most one retry, and only when the policy says a retry could
// actually succeed. Bounded by construction: there is no loop here,
// just a single extra attempt.
//
// The policy decides both WHETHER and HOW LONG, because those two
// questions have the same answer source. A 429 carries the server's own
// stated delay; ignoring it and retrying after a fixed 1500ms produced
// a retry that landed inside the quota window and could not succeed,
// while spending more of the quota it had just exhausted
// (BUG_HISTORY.md #29).
async function callGemini(parts, context) {
  try {
    return await callGeminiOnce(parts, { ...context, attempt: 1 });
  } catch (err) {
    const decision = decideRetry({
      status: err.networkError ? null : err.httpStatus,
      pass: context.pass,
      headers: err.responseHeaders,
      body: err.responseBody,
      alreadyRetried: false,
    });

    if (!decision.retry) {
      // Logged even when NOT retrying: "we chose not to retry, and
      // why" is exactly the line that was missing when this was
      // diagnosed after the fact.
      console.log(JSON.stringify({
        stage: 'gemini_retry_skipped',
        pass: context.pass,
        reason: decision.reason,
        code: err.code,
        httpStatus: err.httpStatus ?? null,
        statedDelayMs: decision.statedDelayMs ?? null,
      }));
      err.diagnostics = { ...(err.diagnostics || {}), retrySkipped: decision.reason, statedDelayMs: decision.statedDelayMs ?? null };
      throw err;
    }

    console.log(JSON.stringify({
      stage: 'gemini_retry',
      pass: context.pass,
      reason: decision.reason,
      code: err.code,
      httpStatus: err.httpStatus ?? null,
      delayMs: decision.delayMs,
      statedDelayMs: decision.statedDelayMs ?? null,
    }));

    await new Promise((resolve) => setTimeout(resolve, decision.delayMs));

    try {
      const result = await callGeminiOnce(parts, { ...context, attempt: 2 });
      result.diagnostics = { ...result.diagnostics, retriedAfter: err.code, retryReason: decision.reason, retryDelayMs: decision.delayMs };
      console.log(JSON.stringify({ stage: 'gemini_retry_succeeded', pass: context.pass, afterReason: err.code, waitedMs: decision.delayMs }));
      return result;
    } catch (err2) {
      err2.diagnostics = { ...(err2.diagnostics || {}), retriedAfter: err.code, retryAlsoFailed: true, retryDelayMs: decision.delayMs };
      console.log(JSON.stringify({ stage: 'gemini_retry_failed', pass: context.pass, firstReason: err.code, secondReason: err2.code, waitedMs: decision.delayMs }));
      throw err2;
    }
  }
}

// Confirmed via production evidence (12/12 real generation records
// inspected, both PDF and DOCX): Gemini consistently returns this
// field under the key "supervisor", not "supervisor_name", which the
// rest of the pipeline reads. The prompt now states the intended key
// explicitly (see schema.js), but this is kept as a safety net - an
// LLM's adherence to a stated key name on every future call isn't
// guaranteed, and this normalization costs nothing when the key is
// already correct. Deliberately narrow: renames one confirmed,
// evidenced mismatch, not a general schema-coercion layer.
function normalizeResponseKeys(parsed) {
  if (parsed && typeof parsed === 'object' && !('supervisor_name' in parsed) && 'supervisor' in parsed) {
    parsed.supervisor_name = parsed.supervisor;
    delete parsed.supervisor;
  }
  return parsed;
}

async function extractMetadata({ pass, document, missingFields }) {
  const instructions = pass === 1 ? EXTRACTION_INSTRUCTIONS : targetedInstructions(missingFields || []);
  const parts = [{ text: instructions }];

  if (document.type === 'pdf') {
    parts.push({ inline_data: { mime_type: 'application/pdf', data: document.base64 } });
  } else {
    parts.push({ text: document.content });
  }

  const { parsed, model, diagnostics } = await callGemini(parts, { pass });
  return { provider: 'gemini', model, result: normalizeResponseKeys(parsed), diagnostics };
}

module.exports = { extractMetadata };
