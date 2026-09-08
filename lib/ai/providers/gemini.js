// lib/ai/providers/gemini.js
//
// IMPORTANT: written against Google's documented REST API shape
// (https://ai.google.dev/api/generate-content), re-verified directly
// against current docs while fixing the pdf-parse issue, including
// switching to header-based auth and a more current default model.
// Still not exercised against a real Gemini response, no API key is
// available in this environment. Test with a live key before trusting
// this fully.
//
// Deliberately uses the stable generateContent API, not Google's newer
// Interactions API, which is explicitly documented as beta with
// breaking-change risk. Google's own docs recommend generateContent
// for stable production use, which is what an unattended pilot needs.
//
// Uses fetch() directly rather than an SDK dependency. Deliberate: the
// model landscape here has changed names multiple times in the last few
// months of research alone, and a plain REST call is one less moving
// dependency to go stale alongside it. The model name itself lives in
// an environment variable, not in this code, for the same reason.

const { EXTRACTION_INSTRUCTIONS, targetedInstructions } = require('../schema');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getModel() {
  // Pinned to a specific, generally-available model rather than a
  // "-latest" alias (Google's own docs mark that alias experimental,
  // not for production). Re-checked against ai.google.dev's current
  // examples while fixing this file - gemini-3.6-flash is what
  // Google's own current documentation demonstrates.
  return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

async function callGemini(parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Extraction cannot run against the live provider without it.');
  }

  const model = getModel();
  const url = `${API_BASE}/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    // Current documented method is a header, not a ?key= query
    // parameter - re-verified against ai.google.dev directly rather
    // than carrying over an older assumption. A query param risks
    // the key ending up in logs or proxies more readily than a header.
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no usable content.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${String(err.message)}`);
  }

  return { parsed, model };
}

// document: { type: 'pdf', base64: '...' } or { type: 'text', content: '...' }
async function extractMetadata({ pass, document, missingFields }) {
  const instructions = pass === 1 ? EXTRACTION_INSTRUCTIONS : targetedInstructions(missingFields || []);

  const parts = [{ text: instructions }];

  if (document.type === 'pdf') {
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: document.base64,
      },
    });
  } else {
    parts.push({ text: document.content });
  }

  const { parsed, model } = await callGemini(parts);

  return {
    provider: 'gemini',
    model,
    result: parsed,
  };
}

module.exports = { extractMetadata };
