// lib/ai/providers/gemini.js
//
// Written against Google's documented REST API shape
// (https://ai.google.dev/api/generate-content).
//
// PHASE 1 DIAGNOSTIC BUILD. This file now sets the two generation
// parameters that were previously left to Google's defaults, and
// captures the response metadata needed to prove or disprove the
// thinking-token-exhaustion hypothesis:
//
//   - maxOutputTokens was UNSET, so the API applied its 8,192 default.
//   - thinkingConfig was UNSET, so Gemini 3.6 Flash applied its default
//     thinking level (MEDIUM). Thinking tokens are billed against the
//     SAME maxOutputTokens budget.
//   - When that budget is exhausted with responseMimeType JSON, the API
//     returns finishReason MAX_TOKENS and NO content parts at all, not
//     partial JSON. The old code read parts[0].text, got undefined, and
//     threw "no usable content", which surfaced to the user as
//     "We couldn't read this document" — after the file had been read
//     perfectly well.
//
// Every failure mode below is now a typed ExtractionError so the route
// can tell them apart instead of collapsing them into one message.

const { EXTRACTION_INSTRUCTIONS, targetedInstructions } = require('../schema');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class ExtractionError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code; // max_tokens | malformed_json | api_error | timeout | empty_response | config
    this.diagnostics = diagnostics;
  }
}

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

// A complete extraction result measures ~300 tokens. 4096 is generous
// headroom for the answer itself while leaving the thinking budget
// explicit rather than implicit.
function getMaxOutputTokens() {
  return Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4096);
}

// Gemini 3 Flash supports minimal | low | medium | high, and defaults
// to medium. Metadata extraction is pattern-matching against a cover
// page, not multi-step reasoning, so "low" should be ample. Left in an
// env var so this is the one dial to turn during the experiment.
// Note: Gemini 3 Flash cannot disable thinking entirely; "minimal" is
// the floor.
function getThinkingLevel() {
  return process.env.GEMINI_THINKING_LEVEL || 'low';
}

function getTimeoutMs() {
  return Number(process.env.GEMINI_TIMEOUT_MS || 120000);
}

async function callGemini(parts, context) {
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

  const approxInputBytes = JSON.stringify(requestBody).length;

  console.log(JSON.stringify({
    stage: 'gemini_request',
    pass: context.pass,
    model,
    maxOutputTokens,
    thinkingLevel,
    timeoutMs,
    approxRequestBytes: approxInputBytes,
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
      const diag = { stage: 'gemini_request', pass: context.pass, model, durationMs, timeoutMs };
      console.error(JSON.stringify({ ...diag, outcome: 'timeout' }));
      throw new ExtractionError('timeout', `Gemini did not respond within ${timeoutMs}ms.`, diag);
    }
    const diag = { stage: 'gemini_request', pass: context.pass, model, durationMs, networkError: String(err.message) };
    console.error(JSON.stringify({ ...diag, outcome: 'network_error' }));
    throw new ExtractionError('api_error', `Network error calling Gemini: ${err.message}`, diag);
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const diag = { pass: context.pass, model, durationMs, httpStatus: response.status, body: errorBody.slice(0, 500) };
    console.error(JSON.stringify({ stage: 'gemini_response', outcome: 'api_error', ...diag }));
    throw new ExtractionError('api_error', `Gemini API error ${response.status}.`, diag);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  const usage = data?.usageMetadata || {};
  const text = candidate?.content?.parts?.[0]?.text;

  // THE core diagnostic line. thoughtsTokenCount versus
  // candidatesTokenCount against maxOutputTokens is what settles the
  // hypothesis one way or the other.
  const diagnostics = {
    stage: 'gemini_response',
    pass: context.pass,
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

  // MAX_TOKENS is checked BEFORE the empty-text check, because with
  // structured output the API returns no parts at all in that case.
  // Checking text first is exactly what produced the misleading
  // "couldn't read this document" message.
  if (finishReason === 'MAX_TOKENS') {
    throw new ExtractionError(
      'max_tokens',
      `Gemini hit its output ceiling (maxOutputTokens=${maxOutputTokens}) before returning an answer. thoughtsTokenCount=${usage.thoughtsTokenCount ?? 'unreported'}.`,
      diagnostics
    );
  }

  if (!text) {
    throw new ExtractionError(
      'empty_response',
      `Gemini returned no content (finishReason=${finishReason}).`,
      diagnostics
    );
  }

  try {
    return { parsed: JSON.parse(text), model, diagnostics };
  } catch (err) {
    // Keep the raw text on a parse failure. Previously this was
    // discarded the instant JSON.parse threw, which made the failure
    // undiagnosable after the fact.
    const diag = { ...diagnostics, parseError: String(err.message), rawTextPreview: text.slice(0, 1000) };
    console.error(JSON.stringify({ ...diag, outcome: 'malformed_json' }));
    throw new ExtractionError('malformed_json', `Gemini response was not valid JSON: ${err.message}`, diag);
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

module.exports = { extractMetadata, ExtractionError };
