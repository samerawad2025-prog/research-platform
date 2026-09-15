// lib/ai/providers/mock.js
//
// Realistic, deliberately varied structured data so every path in the
// confirmation screen and the orchestration can be exercised without
// calling a live API. Not a placeholder to delete later: this is how
// the rest of the system gets tested for real.
//
// Scenarios (set MOCK_SCENARIO):
//   'thesis' (default) - a thesis whose supervisor is missed on pass 1.
//        This is the exact production bug being fixed: it proves that a
//        thesis with no supervisor now DOES trigger a second pass, and
//        that the second pass recovers it.
//   'article' - a journal article with no supervisor, which must NOT
//        trigger a second pass, since absence there is the truth.
//   'not_research' - a CV, which must be classified and rejected
//        cleanly rather than mined for metadata.

const THESIS_PASS_1 = {
  document_type: 'thesis',
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
  supervisor_name: { status: 'not_found' }, // the bug: recovered in pass 2
  year: {
    status: 'conflicting',
    candidates: [
      { value: '2023', source: 'title page' },
      { value: '2024', source: 'approval page' },
    ],
  },
  university: { status: 'found', value: 'University of Khartoum', source: 'cover page' },
  faculty: { status: 'found', value: 'School of Management Studies', source: 'cover page' },
  degree_type: { status: 'not_found' },
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
  degree_type: {
    status: 'found',
    value: 'Bachelor of Business Administration',
    source: 'title page',
  },
};

const ARTICLE_PASS_1 = {
  document_type: 'journal_article',
  title: { status: 'found', value: 'Agricultural Credit Access in Gezira State', source: 'first page' },
  title_ar: { status: 'not_found' },
  abstract: { status: 'found', value: 'This paper analyses smallholder access to agricultural credit.', source: 'first page' },
  abstract_ar: { status: 'not_found' },
  supervisor_name: { status: 'not_found' }, // correct: articles have none
  year: { status: 'found', value: '2022', source: 'journal header' },
  university: { status: 'found', value: 'University of Gezira', source: 'author affiliation' },
  faculty: { status: 'not_found' },
  degree_type: { status: 'not_found' },
  researchers: { status: 'found', value: [{ name: 'Dr. Salma Yousif', author_order: 1 }] },
};

const NOT_RESEARCH_PASS_1 = {
  document_type: 'not_research',
  title: { status: 'not_found' },
  title_ar: { status: 'not_found' },
  abstract: { status: 'not_found' },
  abstract_ar: { status: 'not_found' },
  supervisor_name: { status: 'not_found' },
  year: { status: 'not_found' },
  university: { status: 'not_found' },
  faculty: { status: 'not_found' },
  degree_type: { status: 'not_found' },
  researchers: { status: 'not_found' },
};

const SCENARIOS = {
  thesis: { pass1: THESIS_PASS_1, pass2: THESIS_PASS_2 },
  article: { pass1: ARTICLE_PASS_1, pass2: {} },
  not_research: { pass1: NOT_RESEARCH_PASS_1, pass2: {} },
};

async function extractMetadata({ pass, missingFields }) {
  // Brief deliberate delay so any in-progress UI state is genuinely
  // exercised in testing rather than resolving instantly.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const scenario = SCENARIOS[process.env.MOCK_SCENARIO] || SCENARIOS.thesis;

  if (pass === 1) {
    return { provider: 'mock', model: 'mock', result: scenario.pass1 };
  }

  const result = {};
  for (const field of missingFields || []) {
    result[field] = scenario.pass2[field] || { status: 'not_found' };
  }

  return { provider: 'mock', model: 'mock', result };
}

module.exports = { extractMetadata };
