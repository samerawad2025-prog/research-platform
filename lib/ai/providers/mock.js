// lib/ai/providers/mock.js
//
// Returns realistic, deliberately varied structured data so every code
// path in the confirmation screen and the extraction orchestration can
// be exercised without ever calling a live API. This is not a
// placeholder to delete later, it's how the rest of the system gets
// tested for real.
//
// Deliberate design: this scenario is now a genuine single-pass case -
// title, researchers, and year (the only fields that trigger a second
// call) are all resolved on pass 1. Abstract, supervisor, and the
// Arabic title are deliberately left not_found/ambiguous/conflicting to
// prove those no longer force a second call, which is the entire point
// of the simplification. All four uncertainty states still appear, in
// one pass, since none of them need a retry to be correctly represented.

const PASS_1_RESULT = {
  title: {
    status: 'found',
    value: 'Mobile Banking Adoption and Financial Inclusion Among Small Enterprises in Khartoum State',
    source: 'title page',
  },
  title_ar: {
    status: 'ambiguous',
    candidates: ['اعتماد الخدمات المصرفية عبر الهاتف المحمول', 'تبني الخدمات المصرفية عبر الجوال في ولاية الخرطوم'],
    source: 'title page, two overlapping renderings visible',
  },
  abstract: { status: 'not_found' },
  abstract_ar: { status: 'not_found' },
  supervisor_name: { status: 'not_found' },
  year: {
    status: 'conflicting',
    candidates: [
      { value: '2023', source: 'title page' },
      { value: '2024', source: 'approval page' },
    ],
  },
  researchers: {
    status: 'found',
    value: [
      { name: 'Fatima Al-Amin Suleiman', author_order: 1 },
      { name: 'Mohammed Ibrahim Adam', author_order: 2 },
    ],
  },
};

// Used only if a test scenario genuinely needs a second pass (e.g. title
// or researchers missing on pass 1) - see the orchestrator tests, which
// construct that case directly rather than reshaping this fixture.
const PASS_2_RESULT = {
  supervisor_name: {
    status: 'found',
    value: 'Dr. Amna Khalid Hassan',
    source: 'approval page',
  },
  title: {
    status: 'found',
    value: 'Mobile Banking Adoption and Financial Inclusion Among Small Enterprises in Khartoum State',
    source: 'approval page, restated',
  },
};

async function extractMetadata({ pass, missingFields }) {
  // A brief, deliberate delay so any "processing" UI state is genuinely
  // exercised during testing rather than resolving instantly.
  await new Promise((resolve) => setTimeout(resolve, 150));

  if (pass === 1) {
    return {
      provider: 'mock',
      model: 'mock',
      result: PASS_1_RESULT,
    };
  }

  const result = {};
  for (const field of missingFields || []) {
    result[field] = PASS_2_RESULT[field] || { status: 'not_found' };
  }

  return {
    provider: 'mock',
    model: 'mock',
    result,
  };
}

module.exports = { extractMetadata };
