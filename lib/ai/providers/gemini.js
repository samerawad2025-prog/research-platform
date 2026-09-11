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

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUSES = [503, 429];
const RETRY_DELAY_MS = 1500;

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
      e.retryable = false; // a slow response retried immediately is likely to be slow again
      throw e;
    }
    const diag = { stage: 'gemini_request', pass: context.pass, attempt: context.attempt, model, durationMs, networkError: String(err.message) };
    console.error(JSON.stringify({ ...diag, outcome: 'network_error' }));
    const e = new ExtractionError('api_error', `Network error calling Gemini: ${err.message}`, diag);
    e.retryable = true; // a dropped connection is exactly the transient case
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const diag = { pass: context.pass, attempt: context.attempt, model, durationMs, httpStatus: response.status, body: errorBody.slice(0, 500) };
    console.error(JSON.stringify({ stage: 'gemini_response', outcome: 'api_error', ...diag }));
    const e = new ExtractionError('api_error', `Gemini API error ${response.status}.`, diag);
    e.retryable = RETRYABLE_STATUSES.includes(response.status);
    e.httpStatus = response.status;
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
    e.retryable = false; // identical input/config will very likely hit the same ceiling again
    throw e;
  }

  if (!text) {
    const e = new ExtractionError('empty_response', `Gemini returned no content (finishReason=${finishReason}).`, diagnostics);
    e.retryable = false;
    throw e;
  }

  try {
    return { parsed: JSON.parse(text), model, diagnostics };
  } catch (err) {
    const diag = { ...diagnostics, parseError: String(err.message), rawTextPreview: text.slice(0, 1000) };
    console.error(JSON.stringify({ ...diag, outcome: 'malformed_json' }));
    const e = new ExtractionError('malformed_json', `Gemini response was not valid JSON: ${err.message}`, diag);
    e.retryable = false;
    throw e;
  }
}

// Exactly one retry, only for failures marked retryable above. Bounded
// by construction: there is no loop here, just a single extra attempt.
async function callGemini(parts, context) {
  try {
    return await callGeminiOnce(parts, { ...context, attempt: 1 });
  } catch (err) {
    if (!err.retryable) throw err;

    console.log(JSON.stringify({
      stage: 'gemini_retry',
      pass: context.pass,
      reason: err.code,
      httpStatus: err.httpStatus ?? null,
      delayMs: RETRY_DELAY_MS,
    }));

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    try {
      const result = await callGeminiOnce(parts, { ...context, attempt: 2 });
      result.diagnostics = { ...result.diagnostics, retriedAfter: err.code };
      console.log(JSON.stringify({ stage: 'gemini_retry_succeeded', pass: context.pass, afterReason: err.code }));
      return result;
    } catch (err2) {
      err2.diagnostics = { ...(err2.diagnostics || {}), retriedAfter: err.code, retryAlsoFailed: true };
      console.log(JSON.stringify({ stage: 'gemini_retry_failed', pass: context.pass, firstReason: err.code, secondReason: err2.code }));
      throw err2;
    }
  }
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
  return { provider: 'gemini', model, result: parsed, diagnostics };
}

module.exports = { extractMetadata };
