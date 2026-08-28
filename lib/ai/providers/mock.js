// lib/ai/providers/mock.js
//
// Returns realistic, deliberately varied structured data so every code
// path in the confirmation screen and the two-pass orchestration can be
// exercised without ever calling a live API. This is not a placeholder
// to delete later, it's how the rest of the system gets tested for real.
//
// Deliberate design: pass 1 is incomplete on purpose (missing
// supervisor, conflicting year) so the orchestrator's second pass
// actually runs and gets tested too, not just the happy path.

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
  methodology: { status: 'not_found' },
  supervisor_name: { status: 'not_found' },
  year: {
    status: 'conflicting',
    candidates: [
      { value: '2023', source: 'title page' },
      { value: '2024', source: 'approval page' },
    ],
  },
  keywords: { status: 'not_found' },
  researchers: {
    status: 'found',
    value: [
      { name: 'Fatima Al-Amin Suleiman', author_order: 1 },
      { name: 'Mohammed Ibrahim Adam', author_order: 2 },
    ],
  },
};

const PASS_2_RESULT = {
  abstract: {
    status: 'found',
    value:
      'This study examines how small enterprise owners in Khartoum State adopt mobile banking services and the effect of that adoption on access to credit and day-to-day cash management.',
    source: 'abstract page',
  },
  methodology: {
    status: 'found',
    value: 'Mixed methods: a structured survey of 140 small business owners, supplemented by 12 semi-structured interviews.',
    source: 'chapter 3, page 18',
  },
  supervisor_name: {
    status: 'found',
    value: 'Dr. Amna Khalid Hassan',
    source: 'approval page',
  },
  keywords: {
    status: 'found',
    value: ['mobile banking', 'financial inclusion', 'SMEs', 'Khartoum'],
    source: 'abstract page',
  },
  // title_ar and abstract_ar deliberately stay not_found in this fixture:
  // the fictional source paper genuinely has no Arabic title or abstract,
  // and pass 2 should say so honestly rather than manufacture one.
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

  // Pass 2: only ever answer what was actually asked for, mirroring how
  // a real targeted second call behaves.
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
