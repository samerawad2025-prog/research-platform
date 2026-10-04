// scripts/test-excerpt.js
//
// The minimized excerpt sent to Gemini under Google's unpaid (free-tier)
// terms (lib/extraction/excerpt.js, pdfText.js; agreement version 3).
// Runs against the synthetic documents in scripts/fixtures/synthetic/
// (every person, email, phone and ID in them is invented) and against
// small hand-written cover pages for the individual rules.
//
// One check below records the misses on purpose: the rules are not an
// anonymizer, and agreement version 3 says so.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { extractPdfLines, lineText } = require('../lib/extraction/pdfText')
const { prepareExcerpt } = require('../lib/extraction/orchestrator')
const {
  buildExcerpt, hasContact, hasHonorific, looksLikePersonList, isTitleLike, assessText,
} = require('../lib/extraction/excerpt')
const { possiblePersonName } = require('../lib/extraction/names')

const FIX = path.join(__dirname, 'fixtures', 'synthetic')
const NAMES = ['Amna Osman Elhassan']
const PERSONAL = [/Amna/i, /Elhassan/i, /Kamal/i, /Yousif/i, /Nafisa/i, /Fatima/i, /Hassan Ali/i, /Sara Ahmed/i, /Babiker/i, /@/, /912\s?345/, /0412345/, /آمنة/, /كمال/, /فاطمة/, /سارة/, /حسن علي/]

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    failed += 1
    console.log(`FAIL   ${name} — ${err.message}`)
  }
}

const ABSTRACT = 'This study assessed the performance of solar irrigation pumps in twelve schemes over two seasons. Solar pumps reduced seasonal energy costs compared with diesel pumps, while discharge fell in the dusty months. The study recommends regular panel cleaning and shared maintenance among farmer groups in the region.'
const cover = (lines, extra = []) => ({ pages: [[...lines, 'Abstract', ABSTRACT, ...extra]], knownNames: NAMES })

async function main() {
  await check('local PDF reading puts Arabic back in reading order, with ordinary letters', async () => {
    const { pages } = await extractPdfLines(fs.readFileSync(path.join(FIX, 'thesis-ar.pdf')))
    assert.strictEqual(pages[0][0], 'جامعة الخرطوم')
    assert.strictEqual(pages[0][3], 'تقييم مضخات الري العاملة بالطاقة الشمسية في ولاية الجزيرة')
    assert.ok(!/[ﭐ-﷿ﹰ-﻿]/.test(pages.flat().join(' ')), 'no presentation forms left')
  })

  await check('a right-to-left run inside an English line, and digits inside an Arabic line, keep their order', () => {
    // Glyphs as pdf.js reports them for a visual-order PDF: left to right.
    const items = (s, x0) => [...s].map((ch, i) => ({ str: ch, x: x0 + i * 5, w: 5, h: 10 }))
    assert.strictEqual(lineText([...items('2021', 0), { str: ' ', x: 20, w: 3, h: 0 }, ...items('ربوتكأ', 25)]), 'أكتوبر 2021')
  })

  await check('every synthetic document: the excerpt holds no person, contact detail or ID, and keeps institution and abstract', async () => {
    for (const [file, type] of [['thesis-en.pdf', 'pdf'], ['thesis-ar.pdf', 'pdf'], ['article-en.pdf', 'pdf'], ['name-first.pdf', 'pdf'], ['thesis-en.docx', 'docx']]) {
      const excerpt = await prepareExcerpt(fs.readFileSync(path.join(FIX, file)), type, NAMES)
      assert.ok(excerpt.eligible, file)
      for (const re of PERSONAL) assert.ok(!re.test(excerpt.text), `${file}: ${re} survived`)
      assert.ok(/Khartoum|الخرطوم/.test(excerpt.text), `${file}: institution kept`)
      assert.ok(excerpt.stats.abstracts.length >= 1, `${file}: an abstract kept`)
      assert.ok(excerpt.text.length < 4000, `${file}: short (${excerpt.text.length} chars)`)
    }
  })

  await check('a thesis cover: title (over two lines), institution, degree and date kept; everything after "By:" dropped', async () => {
    const excerpt = await prepareExcerpt(fs.readFileSync(path.join(FIX, 'thesis-en.pdf')), 'pdf', NAMES)
    const lines = excerpt.text.split('\n')
    for (const want of ['University of Khartoum', 'Faculty of Engineering', 'Assessment of Solar-Powered Irrigation Pumps in', 'Gezira State, Sudan', 'October 2021']) {
      assert.ok(lines.includes(want), want)
    }
    assert.ok(!lines.some((l) => /B\.Sc|Student|Supervisor/.test(l)), 'the author\'s own details and labels are gone')
  })

  await check('the author name above the title, with no label: the name is dropped, and an ambiguous short title with it', async () => {
    const r = buildExcerpt({ pages: [['Amna Osman Elhassan', 'Groundwater Salinity Mapping', 'A dissertation submitted to the University of Khartoum', '2023', 'Abstract', ABSTRACT]], knownNames: ['Someone Else'] })
    assert.ok(r.eligible)
    assert.ok(!/Amna/.test(r.text))
    assert.ok(!/Groundwater Salinity Mapping/.test(r.text), 'three capitalised words could be a name: dropped, the researcher types the title')
  })

  await check('scanned or unreadable files are refused before anything could be sent', async () => {
    const scanned = await prepareExcerpt(fs.readFileSync(path.join(FIX, 'scanned-cover.pdf')), 'pdf', NAMES).catch((e) => e)
    assert.strictEqual(scanned.code, 'excerpt_unavailable')
    assert.strictEqual(scanned.diagnostics.reason, 'no_text_layer')
    assert.strictEqual(assessText([' '.repeat(200)]).reason, 'text_unreadable')
    const broken = await prepareExcerpt(Buffer.from('%PDF-not really'), 'pdf', NAMES).catch((e) => e)
    assert.strictEqual(broken.code, 'excerpt_unavailable')
    assert.strictEqual(broken.diagnostics.reason, 'unreadable_file')
  })

  await check('too little left after removal: refused (no_safe_excerpt)', () => {
    const r = buildExcerpt({ pages: [['By', 'Amna Osman Elhassan', 'Dr. Kamal Eldin Yousif', 'Some introductory chapter text that is long enough to count as letters '.repeat(5)]], knownNames: NAMES })
    assert.strictEqual(r.eligible, false)
    assert.strictEqual(r.reason, 'no_safe_excerpt')
  })

  await check('without the names held for the paper, nothing is built (fail closed)', () => {
    assert.strictEqual(buildExcerpt({ ...cover(['University of Khartoum', 'A Study of Malaria in Khartoum']), knownNames: [] }).reason, 'names_unavailable')
  })

  await check('contact details and IDs are recognised; a title about phones or a year span is not', () => {
    for (const line of ['amna@example.com', 'Tel: +249 912 345 678', 'Mobile: 0912345678', 'Student No. 2019-0412345', 'www.example.org/amna', 'الهاتف: 0912345678', 'الرقم الجامعي: 19-0412345']) {
      assert.ok(hasContact(line), line)
    }
    for (const line of ['Mobile Phone Use Among University Students in Khartoum', 'Rainfall Variability in Sudan, 1990-2020', 'October 2021', 'استخدام الهاتف المحمول بين طلاب الجامعات']) {
      assert.ok(!hasContact(line), line)
    }
  })

  await check('honorifics introduce people; "an MS thesis" does not', () => {
    for (const line of ['Dr. Kamal Eldin Yousif', 'Prof Nafisa Abdelrahim', 'Ms. Sara Ahmed', 'د. كمال الدين يوسف', 'أ.د كمال يوسف', 'الدكتور كمال يوسف']) assert.ok(hasHonorific(line), line)
    for (const line of ['An MS thesis in Agricultural Engineering', 'Faculty of Medicine', 'كلية الطب']) assert.ok(!hasHonorific(line), line)
  })

  await check('author lines are lists of people; titles are not', () => {
    for (const line of ['Amna O. Elhassan1, Kamal E. Yousif2*', 'Amna Elhassan and Kamal Yousif', 'AMNA ELHASSAN AND KAMAL YOUSIF']) assert.ok(looksLikePersonList(line), line)
    for (const line of ['Assessment of Solar Pumps in Gezira', 'ASSESSMENT OF SOLAR PUMPS IN GEZIRA', 'Gezira State, Sudan']) assert.ok(!looksLikePersonList(line), line)
    assert.ok(isTitleLike('Effect of Panel Dust on Solar Pump Discharge'))
    assert.ok(!isTitleLike('Amna Osman Elhassan'))
  })

  await check('abstract sentences that credit or contact people are removed; the rest is kept', () => {
    const r = buildExcerpt(cover(['University of Khartoum', 'A Study of Malaria in Khartoum'], []))
    assert.ok(r.text.includes('twelve schemes'))
    const withCredit = buildExcerpt({ pages: [['University of Khartoum', 'A Study of Malaria in Khartoum', 'Abstract', `${ABSTRACT} We thank Dr. Omer Babiker for his support. Contact: omer@example.com.`]], knownNames: NAMES })
    assert.ok(!/Babiker|omer@/.test(withCredit.text))
    assert.ok(withCredit.stats.dropped.abstract_honorific >= 1)
  })

  await check('Arabic cover: everything after إعداد and إشراف is dropped; the degree statement before them is kept', () => {
    const r = buildExcerpt({ pages: [['جامعة الخرطوم', 'كلية الزراعة', 'أثر الري بالتنقيط على إنتاجية القمح في ولاية الجزيرة', 'بحث مقدم لنيل درجة الماجستير', 'إعداد:', 'محمد أحمد علي', 'إشراف:', 'د. فاطمة حسن', 'مارس 2022م', 'المستخلص', 'هدفت هذه الدراسة إلى قياس أثر الري بالتنقيط على إنتاجية القمح في مشروع الجزيرة خلال موسمين زراعيين. أظهرت النتائج زيادة الإنتاجية وتوفير المياه مقارنة بالري السطحي. توصي الدراسة بتوسيع استخدام الري بالتنقيط وتدريب المزارعين على صيانته.']], knownNames: ['Mohamed Ahmed Ali'] })
    assert.ok(r.eligible)
    assert.ok(!/محمد|فاطمة/.test(r.text))
    for (const want of ['جامعة الخرطوم', 'بحث مقدم لنيل درجة الماجستير', 'مارس 2022م', 'أثر الري بالتنقيط على إنتاجية القمح في ولاية الجزيرة']) assert.ok(r.text.includes(want), want)
  })

  await check('an unlabelled name inside a title-like line is a refusal: nothing is sent, the researcher enters the details', () => {
    const r = buildExcerpt({ pages: [['University of Khartoum', 'Poems of Hawa Eltaib in the Oral Tradition of Kordofan', 'Abstract', ABSTRACT]], knownNames: NAMES })
    assert.strictEqual(r.eligible, false)
    assert.strictEqual(r.reason, 'possible_personal_name')
    assert.ok(!('text' in r), 'no excerpt is produced at all')
    assert.ok(!JSON.stringify(r.stats).includes('Hawa'), 'the diagnostics name the rule, never the person')
  })

  await check('a possible name in an abstract sentence, English or Arabic, is also a refusal', () => {
    for (const sentence of ['The study draws on interviews with Mohamed Elfaitori and other poets.', 'وتستند الدراسة إلى مقابلات مع الشاعرة حواء الطقطاقة.']) {
      const r = buildExcerpt({ pages: [['University of Khartoum', 'A Study of Oral Poetry in Kordofan', 'Abstract', `${ABSTRACT} ${sentence}`]], knownNames: NAMES })
      assert.strictEqual(r.reason, 'possible_personal_name', sentence)
    }
  })

  await check('name detection generalizes beyond the fixture (two evaluation sets, written separately from the lists)', () => {
    const corpus = require('./fixtures/name-corpus')
    for (const [named, clean, label] of [[corpus.ROUND_1_NAMED, corpus.ROUND_1_CLEAN, 'round 1'], [corpus.ROUND_2_NAMED, corpus.ROUND_2_CLEAN, 'round 2']]) {
      const missed = named.filter((t) => !possiblePersonName(t))
      const refused = clean.filter((t) => possiblePersonName(t))
      assert.deepStrictEqual(missed, [], `${label}: names not detected`)
      assert.deepStrictEqual(refused, [], `${label}: clean text refused`)
      console.log(`       ${label}: ${named.length}/${named.length} named lines detected, 0/${clean.length} clean lines refused`)
    }
  })

  await check('RECORDED MISSES (stated as a limitation in agreement v3 section 6): names the rules have never seen still pass', () => {
    const corpus = require('./fixtures/name-corpus')
    for (const t of corpus.KNOWN_MISSES) {
      assert.strictEqual(possiblePersonName(t), null, `"${t}" is now detected: move it to a NAMED set`)
    }
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main()
