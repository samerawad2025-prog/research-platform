// lib/ai/index.js
//
// The orchestrator calls extractMetadata() from here and never imports
// a specific provider directly. Swapping providers, or adding a new
// one, means adding a file next to these two and one line here, not
// touching the extraction logic itself.

const mock = require('./providers/mock');
const gemini = require('./providers/gemini');

const PROVIDERS = { mock, gemini };

function getProvider() {
  const name = process.env.AI_PROVIDER || 'mock';
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown AI_PROVIDER "${name}". Valid options: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getProvider };
