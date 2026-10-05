// scripts/fixtures/make-synthetic-documents.js
//
// Builds the synthetic research documents in scripts/fixtures/synthetic/.
// Every name, email, phone number and ID in them is invented. They exist
// to test what the extraction pipeline would send to an external AI
// service (lib/extraction/excerpt.js), so they deliberately contain the
// kinds of personal details real theses carry on their front pages.
//
// Dev-time only (needs Playwright's Chromium, as the browser tests do):
//   NODE_PATH=$(npm root -g) node scripts/fixtures/make-synthetic-documents.js
// The generated files are committed, so tests never need a browser.

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { PDFDocument } = require('pdf-lib')
const { chromium } = require('playwright')

const OUT = path.join(__dirname, 'synthetic')

const EN_TITLE = 'Assessment of Solar-Powered Irrigation Pumps in Gezira State, Sudan'
const AR_TITLE = 'تقييم مضخات الري العاملة بالطاقة الشمسية في ولاية الجزيرة'
const EN_ABSTRACT = 'This study assessed the technical and economic performance of solar-powered irrigation pumps in twelve smallholder schemes of Gezira State. Pump discharge, operating hours and maintenance records were collected over two seasons. Solar pumps reduced seasonal energy costs by 61 percent compared with diesel pumps, while discharge fell during the dusty months of the dry season. The study recommends regular panel cleaning and shared maintenance arrangements among farmer groups.'
const AR_ABSTRACT = 'هدفت هذه الدراسة إلى تقييم الأداء الفني والاقتصادي لمضخات الري العاملة بالطاقة الشمسية في اثني عشر مشروعا صغيرا بولاية الجزيرة. جمعت بيانات التصريف وساعات التشغيل وسجلات الصيانة خلال موسمين. خفضت المضخات الشمسية تكاليف الطاقة الموسمية بنسبة 61 في المائة مقارنة بمضخات الديزل. توصي الدراسة بالتنظيف المنتظم للألواح.'

const page = (body, dir = 'ltr') => `<section dir="${dir}" style="page-break-after: always; min-height: 24cm; padding: 2cm; font-family: 'DejaVu Sans', 'FreeSerif', sans-serif; font-size: 13pt; line-height: 1.6;">${body}</section>`
const c = (t, size = 13) => `<p style="text-align:center; font-size:${size}pt; margin: 0.5em 0;">${t}</p>`
const p = (t) => `<p style="margin: 0.6em 0;">${t}</p>`

const THESIS_EN = [
  page([
    c('University of Khartoum', 16), c('Faculty of Engineering'), c('Department of Agricultural Engineering'),
    '<br><br>', c(EN_TITLE, 18), '<br>',
    c('A thesis submitted in partial fulfillment of the requirements for the degree of Master of Science in Agricultural Engineering'),
    '<br>', c('By:'), c('Amna Osman Elhassan'), c('B.Sc. (Agricultural Engineering), University of Khartoum, 2016'),
    c('Student No. 2019-0412345'), '<br>', c('Supervisor:'), c('Dr. Kamal Eldin Yousif'),
    c('Co-supervisor:'), c('Prof. Nafisa Abdelrahim'), '<br>', c('October 2021'),
  ].join('')),
  page([c('Declaration', 15), p('I, Amna Osman Elhassan, declare that this thesis is my own work and has not been submitted for any other degree.'), p('Signature: ............  Date: 12/10/2021'), p('Email: amna.elhassan@example.com'), p('Mobile: +249 912 345 678')].join('')),
  page([c('Dedication', 15), p('To my mother Fatima Ahmed and my father Osman Elhassan, and to my brother Mohamed.')].join('')),
  page([c('Acknowledgements', 15), p('I am grateful to my supervisor Dr. Kamal Eldin Yousif for his guidance, and to Hassan Ali and Sara Ahmed of the Gezira Scheme for their help in the field.')].join('')),
  page([c('Abstract', 15), p(EN_ABSTRACT), p('Keywords: solar irrigation, pumps, Gezira, smallholders')].join('')),
  page([c('المستخلص', 15), p(AR_ABSTRACT)].join(''), 'rtl'),
  page([c('Table of Contents', 15), p('Declaration ..... i'), p('Abstract ..... iv'), p('Chapter One: Introduction ..... 1')].join('')),
  page([c('Chapter One: Introduction', 15), p('Irrigated agriculture in Gezira depends on reliable pumping. Interviews with the scheme manager, Mr. Babiker Omer, informed the study design.')].join('')),
]

const THESIS_AR = [
  page([
    c('جامعة الخرطوم', 16), c('كلية الهندسة'), c('قسم الهندسة الزراعية'), '<br><br>', c(AR_TITLE, 18), '<br>',
    c('بحث مقدم لنيل درجة الماجستير في الهندسة الزراعية'), '<br>', c('إعداد الطالبة:'), c('آمنة عثمان الحسن'),
    c('الرقم الجامعي: 19-0412345'), '<br>', c('إشراف:'), c('د. كمال الدين يوسف'), '<br>', c('أكتوبر 2021م'),
  ].join(''), 'rtl'),
  page([c('إقرار', 15), p('أقر أنا آمنة عثمان الحسن بأن هذا البحث من عملي.'), p('البريد الإلكتروني: amna.elhassan@example.com'), p('الهاتف: 0912345678')].join(''), 'rtl'),
  page([c('الإهداء', 15), p('إلى أمي فاطمة أحمد وأبي عثمان الحسن.')].join(''), 'rtl'),
  page([c('الشكر والعرفان', 15), p('أشكر مشرفي د. كمال الدين يوسف وزملائي حسن علي وسارة أحمد.')].join(''), 'rtl'),
  page([c('المستخلص', 15), p(AR_ABSTRACT)].join(''), 'rtl'),
  page([c('Abstract', 15), p(EN_ABSTRACT)].join('')),
  page([c('الفصل الأول: المقدمة', 15), p('تعتمد الزراعة المروية في الجزيرة على الضخ.')].join(''), 'rtl'),
]

const ARTICLE_EN = [
  page([
    c('Sudan Journal of Agricultural Research, Vol. 12 (2), 2022', 11),
    c('Effect of Panel Dust on Solar Pump Discharge in Central Sudan', 17),
    c('Amna O. Elhassan<sup>1</sup>, Kamal E. Yousif<sup>2*</sup>'),
    c('<sup>1</sup> Department of Agricultural Engineering, University of Khartoum, Sudan', 11),
    c('<sup>2</sup> Agricultural Research Corporation, Wad Medani, Sudan', 11),
    c('*Corresponding author: kamal.yousif@example.com, Tel: +249 911 222 333', 11),
    '<br>', p('<b>Abstract:</b> ' + EN_ABSTRACT), p('Keywords: dust, photovoltaic pumps, Sudan'),
    '<br>', c('1. Introduction', 14), p('Photovoltaic pumping has spread quickly in central Sudan.'),
  ].join('')),
]

// The author's name sits ABOVE the title, with no "By" label: the case a
// line-by-line rule is most likely to get wrong. Short name lines with no
// function words must be dropped, not taken for a title.
const NAME_FIRST = [
  page([
    c('Amna Osman Elhassan', 15), '<br>', c('Groundwater Salinity Mapping', 18), '<br>',
    c('A dissertation submitted to the University of Khartoum in fulfillment of the requirements for the degree of Doctor of Philosophy'),
    c('Faculty of Science'), c('2023'),
  ].join('')),
  page([c('Abstract', 15), p('Groundwater salinity was mapped across 40 wells in the Khartoum basin using electrical conductivity surveys during two dry seasons. Salinity increased towards the north-east of the study area and with well depth. Recommendations for well siting and monitoring are provided.')].join('')),
]

async function htmlToPdf(browser, sections, file) {
  const pg = await browser.newPage()
  await pg.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${sections.join('')}</body></html>`)
  const pdf = await pg.pdf({ format: 'A4', printBackground: true })
  await pg.close()
  fs.writeFileSync(path.join(OUT, file), pdf)
  return pdf
}

// A "scanned" thesis: the cover page as a picture only, no text layer.
async function scannedPdf(browser) {
  const pg = await browser.newPage({ viewport: { width: 794, height: 1123 } })
  await pg.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${THESIS_EN[0]}</body></html>`)
  const png = await pg.screenshot({ fullPage: false })
  await pg.close()
  const doc = await PDFDocument.create()
  const img = await doc.embedPng(png)
  const pageObj = doc.addPage([595, 842])
  pageObj.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
  fs.writeFileSync(path.join(OUT, 'scanned-cover.pdf'), await doc.save())
}

function docxXml(paragraphs) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = paragraphs.map((t) => t === '\f'
    ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    : `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:headerReference w:type="first" r:id="rIdH2"/><w:titlePg/></w:sectPr></w:body></w:document>`
}

async function thesisDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/></Relationships>')
  // As on the real thesis behind BUG_HISTORY.md #16: institution, faculty
  // and degree only in the first-page header.
  zip.file('word/header2.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>University of Khartoum - Faculty of Engineering - Master of Science in Agricultural Engineering</w:t></w:r></w:p></w:hdr>')
  zip.file('word/document.xml', docxXml([
    EN_TITLE, 'A thesis submitted in partial fulfillment of the requirements for the degree of Master of Science',
    'Prepared by', 'Amna Osman Elhassan', 'Supervised by', 'Dr. Kamal Eldin Yousif', 'October 2021', '\f',
    'Declaration', 'I, Amna Osman Elhassan, declare that this thesis is my own work. Email: amna.elhassan@example.com, phone 0912345678.', '\f',
    'Acknowledgements', 'Thanks to Dr. Kamal Eldin Yousif, Hassan Ali and Sara Ahmed.', '\f',
    'Abstract', EN_ABSTRACT, '\f', 'المستخلص', AR_ABSTRACT, '\f', 'Chapter One', 'Introduction text.',
  ]))
  fs.writeFileSync(path.join(OUT, 'thesis-en.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    await htmlToPdf(browser, THESIS_EN, 'thesis-en.pdf')
    await htmlToPdf(browser, THESIS_AR, 'thesis-ar.pdf')
    await htmlToPdf(browser, ARTICLE_EN, 'article-en.pdf')
    await htmlToPdf(browser, NAME_FIRST, 'name-first.pdf')
    await scannedPdf(browser)
  } finally {
    await browser.close()
  }
  await thesisDocx()
  for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size)
}

main().catch((err) => { console.error(err); process.exit(1) })
