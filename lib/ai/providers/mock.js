// lib/ai/providers/mock.js
//
// Returns realistic, deliberately varied structured data so every code
// path can be exercised without ever calling a live API. Not a
// placeholder to delete later - it's how the rest of the system gets
// tested for real.
//
// MOCK_SCENARIO selects which situation to simulate:
//   'thesis'        (default) a thesis whose supervisor is missed on
//                   pass 1 and recovered on pass 2. This is the exact
//                   failure seen in production, so it stays the default
//                   to keep the fix covered.
//   'article'       a journal article with genuinely no supervisor,
//                   which must NOT trigger a second pass.
//   'not_research'  a CV or similar, which must be rejected cleanly.

function scenario() {
  return process.env.MOCK_SCENARIO || 'thesis';
}

const THESIS_PASS_1 = {
  document_type: { status: 'found', value: 'thesis' },
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
  abstract: {
    status: 'found',
    value: 'This study examines how small enterprise owners in Khartoum State adopt mobile banking services and the effect of that adoption on access to credit and day-to-day cash management.',
    source: 'abstract page',
  },
  abstract_ar: { status: 'not_found' },
  // Deliberately missed on pass 1: this is the production bug being
  // guarded against. Because document_type is 'thesis', the
  // orchestrator must treat this as critical and run pass 2.
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

const THESIS_PASS_2 = {
  supervisor_name: {
    status: 'found',
    value: 'Prof. Hijjo Abdel-Wahid Hijjo Taha',
    source: 'cover page, "Supervised by"',
  },
};

const ARTICLE_PASS_1 = {
  document_type: { status: 'found', value: 'journal_article' },
  title: { status: 'found', value: 'Determinants of Agricultural Credit Access in Gezira State', source: 'first page' },
  title_ar: { status: 'not_found' },
  abstract: { status: 'found', value: 'This paper analyses factors affecting smallholder access to agricultural credit.', source: 'first page' },
  abstract_ar: { status: 'not_found' },
  // Correct answer for a journal article. Must NOT trigger pass 2.
  supervisor_name: { status: 'not_found' },
  year: { status: 'found', value: '2022', source: 'journal header' },
  researchers: {
    status: 'found',
    value: [{ name: 'Dr. Salma Osman Bakheit', author_order: 1 }],
  },
};

const NOT_RESEARCH_PASS_1 = {
  document_type: { status: 'found', value: 'not_research' },
  title: { status: 'not_found' },
  title_ar: { status: 'not_found' },
  abstract: { status: 'not_found' },
  abstract_ar: { status: 'not_found' },
  supervisor_name: { status: 'not_found' },
  year: { status: 'not_found' },
  researchers: { status: 'not_found' },
};

const PASS_1_BY_SCENARIO = {
  thesis: THESIS_PASS_1,
  article: ARTICLE_PASS_1,
  not_research: NOT_RESEARCH_PASS_1,
};

const PASS_2_BY_SCENARIO = {
  thesis: THESIS_PASS_2,
  article: {},
  not_research: {},
};

async function extractMetadata({ pass, missingFields }) {
  // Brief deliberate delay so any "processing" UI state is genuinely
  // exercised during testing rather than resolving instantly.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const key = scenario();

  if (pass === 1) {
    return {
      provider: 'mock',
      model: 'mock',
      result: PASS_1_BY_SCENARIO[key] || THESIS_PASS_1,
    };
  }

  const answers = PASS_2_BY_SCENARIO[key] || {};
  const result = {};
  for (const field of missingFields || []) {
    result[field] = answers[field] || { status: 'not_found' };
  }

  return { provider: 'mock', model: 'mock', result };
}

module.exports = { extractMetadata };
