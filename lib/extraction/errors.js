// lib/extraction/errors.js
//
// A single, shared error type for every stage of the extraction
// pipeline (Gemini calls, document preprocessing). Having one shape
// with a stable `.code` is what lets the route classify a failure
// instead of collapsing everything into one generic message.
//
// Retry decisions deliberately do NOT live on this class. A boolean
// `.retryable` flag used to be set here, but whether a retry is worth
// making depends on the status, which pass is running, and the delay
// the server stated - none of which a boolean can carry. That logic
// now lives in lib/ai/retryPolicy.js, and this type just carries the
// facts it needs: `.httpStatus`, `.responseHeaders`, `.responseBody`.

class ExtractionError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

module.exports = { ExtractionError };
