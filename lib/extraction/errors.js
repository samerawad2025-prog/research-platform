// lib/extraction/errors.js
//
// A single, shared error type for every stage of the extraction
// pipeline (Gemini calls, document preprocessing). Having one shape
// with a stable `.code` is what lets the route classify a failure
// instead of collapsing everything into one generic message.
//
// `.retryable` marks failures where a single retry is worth
// attempting (set by the caller that knows the failure was
// transient, e.g. gemini.js on a 503/429). It is NOT set by default,
// so a new failure type is non-retryable unless something explicitly
// decides otherwise.

class ExtractionError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.diagnostics = diagnostics;
    this.retryable = false;
  }
}

module.exports = { ExtractionError };
