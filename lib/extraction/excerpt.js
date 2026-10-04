// lib/extraction/excerpt.js
//
// The minimized excerpt: the only document content sent to Gemini under
// Google's UNPAID (free-tier) terms (founder decision of 2026-10-04,
// agreement version 3).
//
// Why it exists. Under the unpaid terms Google uses what it is sent, and
// its answers, to improve its products; human reviewers may read both;
// and Google says: "Do not submit sensitive, confidential, or personal
// information to the Unpaid Services." The researcher's acceptance cannot
// change that, and cannot authorize sending other people's details. A
// research document's front pages name its authors, supervisors, family
// and colleagues, and carry email addresses, phone and student numbers.
// So the document itself is never sent. This server reads it (pdfText.js,
// docx.js) and keeps only:
//   - cover-page lines that name the institution, faculty, degree or
//     date (an allow-list), and lines that look like the title, up to the
//     first "By" / "Supervisor" / "إعداد" / "إشراف" label;
//   - the abstract section(s), sentence by sentence.
// Anything that looks like a person or contact detail is removed first,
// and the result is checked again before use. If what remains is not
// enough to be useful, or still looks personal, NOTHING is sent and the
// researcher enters the details (eligible: false, with the reason).
//
// What this is not: an anonymizer, or proof that an excerpt holds no
// personal information. The rules are small, specific and conservative
// (when unsure, a line is dropped; when a possible name remains, nothing
// is sent at all), and they can still be wrong: a name the lists in
// names.js have never seen, written without any label, title or contact
// detail, can pass (scripts/test-excerpt.js measures this). Agreement
// version 3 says so plainly, asks researchers to choose manual entry when
// their title or abstract contains personal or confidential information,
// and the model is never asked for any person's name: authors and
// supervisors are always entered by the researcher.

const { possiblePersonName } = require('./names')

const MAX_TITLE_LINES = 6
const MAX_ABSTRACT_CHARS = 4000
const MIN_ABSTRACT_CHARS = 200
const MAX_TITLE_REGION_LINES = 60

// ---------- matching helpers ----------

const ARABIC_INDIC = /[٠-٩۰-۹]/g
function asciiDigits(s) {
  return s.replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)))
}

// For comparison only: case, Arabic letter variants and diacritics folded.
function key(s) {
  return asciiDigits(String(s || ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}@.+\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s) {
  return key(s).replace(/[.]/g, ' ').split(' ').filter(Boolean)
}

// ---------- what is never kept ----------

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const URL = /(https?:\/\/|www\.)\S+/i
const LONG_NUMBER = /\d{6,}/ // student / ID / phone numbers (a year is 4 digits)
// A phone number: at least nine digits, with the usual separators.
const PHONE = /\+?\d[\d\s().-]{7,}\d/g
// Labels, only where they label something (a colon next to them): a
// title about "mobile phone use" is not a contact detail.
const CONTACT_LABEL = /\b(e-?mail|tel|telephone|phone|mobile|cell|whatsapp|fax|orcid|signature|signed)\b\s*(no\.?|number)?\s*:/i
const ID_LABEL = /\b(student|registration|reg|index|id|university|matric\w*)\s*(no|number|id)\b/i
const CONTACT_LABEL_AR = /(البريد|الالكتروني|هاتف|الهاتف|جوال|الجوال|موبايل|واتساب|فاكس|الرقم الجامعي|رقم القيد|رقم الطالب|التوقيع|توقيع)\s*:|:\s*(البريد|الهاتف|هاتف|الجوال|جوال|التوقيع)/

// Tokens that introduce a person's name. "Dr", "Prof" and their Arabic
// equivalents always; "Mr.", "Ms." and the like only with their dot, so
// that "an MS thesis" is not taken for a person.
const HONORIFICS = new Set([
  'dr', 'prof', 'professor', 'ustaz', 'ustaza', 'sheikh',
  'د', 'ا.د', 'بروف', 'بروفيسور', 'البروفيسور', 'الدكتور', 'الدكتوره', 'دكتور', 'دكتوره',
  'الاستاذ', 'الاستاذه', 'استاذ', 'استاذه', 'المهندس', 'المهندسه', 'الشيخ', 'السيد', 'السيده',
])
const DOTTED_HONORIFICS = new Set(['mr', 'mrs', 'ms', 'eng', 'engr', 'st'])

// Labels after which a cover page lists people. Matched at the start of a
// line, after folding (so اعداد and إعداد are the same).
const PERSON_CUE = /^(?:\d+[.)]\s*)?(by|prepared by|submitted by|presented by|written by|compiled by|authors?|researchers?|student|students|candidate|name|names|supervisors?|co-?supervisors?|supervised by|main supervisor|advisors?|advisers?|under the supervision|under supervision|examiners?|examination committee|committee|corresponding author|acknowledg\w*|dedicat\w*|declaration)\b/
const PERSON_CUE_AR = /^(اعداد|الطالب|الطالبه|الباحث|الباحثه|الباحثون|الباحثين|مقدم من|مقدمه من|تقديم|اسم|الاسم|اشراف|باشراف|تحت اشراف|المشرف|المشرفه|المشرفون|المشرف المشارك|لجنه|الممتحن|الممتحنون|المناقشون|اقرار|الاهداء|اهداء|الشكر|شكر)/

// ---------- what may be kept from a cover page ----------

const STRUCTURAL = /\b(universit\w*|faculty|college|school of|department|institute|centre|center|academy|ministry|thesis|dissertation|project|research|submitted|presented|fulfil\w*|fulfill\w*|requirements?|degree|master\w*|m\.?sc|m\.?a|mba|mph|ph\.?d|doctor of|doctorate|bachelor\w*|b\.?sc|diploma|fellowship|journal|vol|volume|issue|proceedings|conference)\b/
const STRUCTURAL_AR = /(جامعه|الجامعه|كليه|قسم|معهد|مركز|اكاديميه|وزاره|بحث|رساله|اطروحه|مشروع|مقدم|مقدمه|لنيل|استكمال|متطلبات|درجه|الماجستير|ماجستير|الدكتوراه|دكتوراه|البكالوريوس|بكالوريوس|الدبلوم|دبلوم|الزماله|مجله|المجلد|العدد|مؤتمر)/
const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const MONTHS_AR = '(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر|محرم|صفر|ربيع|جمادي|رجب|شعبان|رمضان|شوال|ذو القعده|ذو الحجه)'
const DATE_LINE = new RegExp(`^((${MONTHS}|${MONTHS_AR})\\s*,?\\s*)?(\\d{1,2}\\s*)?((${MONTHS}|${MONTHS_AR})\\s*,?\\s*)?(1[3-4]\\d{2}|19\\d{2}|20\\d{2})\\s*(م|هـ|ه|ad|ah)?$`)

// Words that make a line read like a title rather than a name. A name has
// none of these; most titles have at least one.
const TITLE_WORDS = new Set([
  'of', 'the', 'in', 'on', 'for', 'and', 'to', 'with', 'using', 'among', 'between', 'towards', 'toward', 'a', 'an',
  'from', 'at', 'into', 'via', 'under', 'its', 'their', 'case', 'study', 'effect', 'effects', 'impact', 'role',
  'في', 'من', 'الي', 'عن', 'مع', 'بين', 'لدي', 'حول', 'نحو', 'دراسه', 'اثر', 'تقييم', 'تحليل', 'دور', 'تاثير',
  'استخدام', 'مدي', 'واقع', 'حاله', 'تطوير', 'تصميم', 'مقارنه', 'العلاقه', 'العوامل', 'ولايه', 'بولايه', 'السودان',
])

// Headings that end the cover page, or an abstract.
const SECTION_HEADING = /^(?:\d+[.)]?\s*)?(abstract|summary|executive summary|keywords?|key words|index terms|acknowledg\w*|dedicat\w*|declaration|approval|certificate|copyright|table of contents|contents|list of\b|chapter|introduction|background|abbreviations|preface|foreword)\b/
const SECTION_HEADING_AR = /^(المستخلص|مستخلص|الملخص|ملخص|الخلاصه|الكلمات المفتاحيه|الكلمات الداله|الشكر|شكر|الاهداء|اهداء|اقرار|التفويض|الاجازه|فهرس|الفهرس|المحتويات|قائمه|الفصل|المقدمه|مقدمه)/
const ABSTRACT_HEADING = /^(abstract|summary|executive summary)\b\s*[:.\-–]?\s*/
const ABSTRACT_HEADING_AR = /^(المستخلص|مستخلص|الملخص|ملخص البحث|ملخص الدراسه|ملخص|الخلاصه|خلاصه البحث)\s*[:.\-–]?\s*/
// Sentences that thank or credit people do not belong in an abstract.
const CREDIT_SENTENCE = /\b(thank\w*|grateful|gratitude|acknowledg\w*|supervis\w*|corresponding|funded by|supported by)\b|(اشكر|الشكر|شكر|امتنان|اشراف|المشرف)/

function isArabicDominant(s) {
  const ar = (s.match(/[؀-ۿ]/g) || []).length
  const la = (s.match(/[A-Za-z]/g) || []).length
  return ar > la
}

function hasPhone(ascii) {
  return [...ascii.matchAll(PHONE)].some((m) => (m[0].match(/\d/g) || []).length >= 9)
}

function hasContact(line) {
  const ascii = asciiDigits(String(line).normalize('NFKC'))
  return EMAIL.test(ascii) || URL.test(ascii) || LONG_NUMBER.test(ascii) || hasPhone(ascii)
    || CONTACT_LABEL.test(ascii) || ID_LABEL.test(ascii) || CONTACT_LABEL_AR.test(key(line).replace(/(\S):/g, '$1 :'))
}

function hasHonorific(line) {
  // "Dr.", "Prof.", "د." and the like, as separate tokens.
  const raw = String(line).normalize('NFKC').toLowerCase().replace(/[(),;]/g, ' ').split(/\s+/).filter(Boolean)
  return raw.some((t) => {
    const bare = t.replace(/:$/, '')
    const dotted = bare.endsWith('.')
    const k = key(bare.replace(/\.$/, ''))
    if (HONORIFICS.has(k) || HONORIFICS.has(key(bare))) return true
    if (dotted && DOTTED_HONORIFICS.has(k)) return true
    return /^(أ\.د|ا\.د|د\.)/.test(bare)
  })
}

// Any two consecutive words of a name the platform already holds for this
// paper (the submitter and declared authors), or a single-word name.
function namePairs(knownNames) {
  const pairs = []
  for (const name of knownNames || []) {
    const t = tokens(name).filter((w) => w.length > 1 && !HONORIFICS.has(w))
    if (t.length === 1) pairs.push(t[0])
    for (let i = 0; i + 1 < t.length; i += 1) pairs.push(`${t[i]} ${t[i + 1]}`)
  }
  return pairs
}

function hasKnownName(line, pairs) {
  if (!pairs.length) return false
  const k = ` ${tokens(line).join(' ')} `
  return pairs.some((p) => k.includes(` ${p} `))
}

// "Amna O. Elhassan1, Kamal E. Yousif2*" / "A. Elhassan and K. Yousif":
// every comma/and-separated part is 2-4 capitalized words or initials.
function looksLikePersonList(line) {
  const cleaned = line.replace(/[\d*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/[A-Za-z]/.test(cleaned)) return false
  const parts = cleaned.split(/,|;|&|\band\b/i).map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return false
  return parts.every((part) => {
    const words = part.split(' ')
    if (words.length < 2 || words.length > 4) return false
    return words.every((w) => /^([A-Z][A-Za-z'’-]+|[A-Z]\.)$/.test(w) && !TITLE_WORDS.has(w.toLowerCase()))
  })
}

function isStructural(line) {
  const k = key(line)
  return STRUCTURAL.test(k) || STRUCTURAL_AR.test(k) || DATE_LINE.test(k)
}

function isDateLine(line) {
  return DATE_LINE.test(key(line))
}

function isPersonCue(line) {
  const k = key(line)
  return PERSON_CUE.test(k) || PERSON_CUE_AR.test(k)
}

function isSectionHeading(line) {
  const k = key(line)
  return SECTION_HEADING.test(k) || SECTION_HEADING_AR.test(k)
}

function isTitleLike(line) {
  const t = tokens(line)
  if (t.length < 3) return false
  if ((line.match(/\p{L}/gu) || []).length < 10) return false
  if (looksLikePersonList(line)) return false
  return t.some((w) => TITLE_WORDS.has(w))
}

// ---------- the cover page ----------

function coverRegion(pages, headerLines = [], maxLines = MAX_TITLE_REGION_LINES) {
  const lines = [...headerLines]
  const firstPages = pages.slice(0, 2)
  outer: for (let p = 0; p < firstPages.length; p += 1) {
    for (const line of firstPages[p]) {
      if (lines.length - headerLines.length > 0 && isSectionHeading(line)) break outer
      lines.push(line)
      if (lines.length >= maxLines) break outer
    }
    // A cover page is one page; read on only when page 1 had almost nothing.
    if (firstPages[p].length >= 4) break
  }
  return lines
}

// A title line that ends mid-phrase ("... Pumps in", "... of the",
// "...،") is continued by the next line, which may hold no title word of
// its own ("Gezira State, Sudan").
function endsMidPhrase(line) {
  const t = tokens(line)
  return /[,،:\-–]$/.test(line.trim()) || (t.length > 0 && TITLE_WORDS.has(t[t.length - 1]) && t[t.length - 1].length <= 5)
}

function minimizeCover(lines, pairs, dropped) {
  const kept = []
  let titleLines = 0
  let afterCue = false
  let lastWasTitle = false
  for (const line of lines) {
    const wasTitle = lastWasTitle
    lastWasTitle = false
    const drop = (rule) => { dropped[rule] = (dropped[rule] || 0) + 1 }
    if (hasContact(line)) { drop('contact'); continue }
    if (hasKnownName(line, pairs)) { drop('known_name'); continue }
    if (hasHonorific(line)) { drop('honorific'); afterCue = true; continue }
    if (isPersonCue(line)) { drop('person_label'); afterCue = true; continue }
    // After a "By" / "Supervisor" / "إعداد" label, a cover page lists
    // people and their own details: only a bare date survives.
    if (afterCue) {
      if (isDateLine(line)) kept.push(line)
      else drop('after_person_label')
      continue
    }
    // The rest of a title broken mid-phrase, or a one-word last line
    // ("Sudan"). Never a list of names: a name needs two words or more.
    const continuation = wasTitle && (endsMidPhrase(kept[kept.length - 1]) || tokens(line).length === 1)
    if (continuation && titleLines < MAX_TITLE_LINES && !isStructural(line)) {
      kept.push(line)
      titleLines += 1
      lastWasTitle = true
      continue
    }
    if (looksLikePersonList(line)) { drop('person_list'); continue }
    if (isStructural(line)) { kept.push(line); continue }
    if (isTitleLike(line) && titleLines < MAX_TITLE_LINES) {
      kept.push(line)
      titleLines += 1
      lastWasTitle = true
      continue
    }
    drop('not_title_like')
  }
  return { kept, titleLines }
}

// ---------- the abstract ----------

function findAbstracts(allLines) {
  const found = []
  for (let i = 0; i < allLines.length && found.length < 2; i += 1) {
    const raw = allLines[i].text.trim()
    const k = key(raw)
    const m = k.match(ABSTRACT_HEADING) || k.match(ABSTRACT_HEADING_AR)
    if (!m) continue
    // A heading on its own line, or followed by a colon or full stop
    // ("Abstract: This study ..."); not a sentence that starts "Summary of".
    const alone = k === m[0].trim()
    const labelled = /^[^\s:.]+(\s+[^\s:.]+){0,2}\s*[:.\-–]/.test(raw)
    if (!alone && !labelled) continue
    // The rest of the heading line ("Abstract: This study ...") is content.
    const headingWords = m[0].trim().split(' ').length
    const first = allLines[i].text.split(/\s+/).slice(headingWords).join(' ').replace(/^[:.\-–]\s*/, '')
    const body = first ? [first] : []
    const startPage = allLines[i].page
    let j = i + 1
    for (; j < allLines.length; j += 1) {
      const { text, page } = allLines[j]
      if (page > startPage + 1) break
      if (isSectionHeading(text)) break
      body.push(text)
      if (body.join(' ').length > MAX_ABSTRACT_CHARS) break
    }
    const text = body.join(' ').replace(/-\s+(?=[a-z])/g, '-').replace(/\s+/g, ' ').trim()
    const language = isArabicDominant(text) ? 'ar' : 'en'
    if (text.length < MIN_ABSTRACT_CHARS) { i = j - 1; continue }
    if (!found.some((a) => a.language === language)) found.push({ text: text.slice(0, MAX_ABSTRACT_CHARS), language })
    i = j - 1
  }
  return found
}

// Sentence boundaries, without breaking after "Dr.", "Prof.", "et al." or
// an initial: "We thank Dr. Omer Babiker" must stay one sentence, or its
// second half would pass every check on its own.
const ABBREVIATION = /(?:^|\s)(dr|prof|mr|mrs|ms|eng|st|vol|no|fig|figs|eq|al|etc|e\.g|i\.e|vs|approx|[a-z])\.$/i
function sentencesOf(text) {
  const pieces = text.split(/(?<=[.!?؟])\s+/)
  const out = []
  for (const piece of pieces) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`
    else out.push(piece)
  }
  return out
}

function minimizeAbstract(text, pairs, dropped) {
  const sentences = sentencesOf(text)
  const kept = sentences.filter((s) => {
    const drop = (rule) => { dropped[rule] = (dropped[rule] || 0) + 1; return false }
    if (hasContact(s)) return drop('abstract_contact')
    if (hasKnownName(s, pairs)) return drop('abstract_known_name')
    if (hasHonorific(s)) return drop('abstract_honorific')
    if (CREDIT_SENTENCE.test(key(s))) return drop('abstract_credit')
    return true
  })
  return kept.join(' ').trim()
}

// ---------- text quality ----------

// A text layer good enough to minimize reliably: enough real letters, and
// not the private-use or replacement glyphs a PDF without a Unicode
// mapping produces.
function assessText(lines) {
  const all = lines.join('\n')
  const visible = all.replace(/\s/g, '')
  const letters = (all.match(/\p{L}/gu) || []).length
  const broken = (all.match(/[�-]/g) || []).length
  if (visible.length < 200) return { ok: false, reason: 'no_text_layer', letters, broken }
  if (broken / visible.length > 0.02 || letters / visible.length < 0.5) {
    return { ok: false, reason: 'text_unreadable', letters, broken }
  }
  if (letters < 200) return { ok: false, reason: 'no_text_layer', letters, broken }
  return { ok: true, letters, broken }
}

// ---------- the whole excerpt ----------

// pages: [[line, ...], ...] in reading order (a DOCX is one long "page"
//        list split by the caller); headerLines: DOCX header text.
// knownNames: names the platform holds for this paper.
// Returns { eligible, reason?, text?, stats }.
function buildExcerpt({ pages, headerLines = [], knownNames = [], maxCoverLines = MAX_TITLE_REGION_LINES }) {
  const flat = pages.flatMap((lines, page) => lines.map((text) => ({ text, page })))
  const quality = assessText([...headerLines, ...flat.map((l) => l.text)])
  const stats = { pagesRead: pages.length, letters: quality.letters, dropped: {} }
  if (!quality.ok) return { eligible: false, reason: quality.reason, stats }

  const pairs = namePairs(knownNames)
  stats.knownNames = knownNames.length
  // Fail closed: without the declared names, the one check that catches
  // an unlabelled name is missing.
  if (!pairs.length) return { eligible: false, reason: 'names_unavailable', stats }

  const cover = minimizeCover(coverRegion(pages, headerLines, maxCoverLines), pairs, stats.dropped)
  const abstracts = findAbstracts(flat)
    .map((a) => ({ ...a, text: minimizeAbstract(a.text, pairs, stats.dropped) }))
    .filter((a) => a.text.length >= MIN_ABSTRACT_CHARS)

  stats.coverLinesKept = cover.kept.length
  stats.titleLinesKept = cover.titleLines
  stats.abstracts = abstracts.map((a) => ({ language: a.language, chars: a.text.length }))

  const usefulCover = cover.titleLines > 0 && cover.kept.length > cover.titleLines
  if (!abstracts.length && !usefulCover) return { eligible: false, reason: 'no_safe_excerpt', stats }

  const parts = []
  if (cover.kept.length) parts.push(`[Cover page, with names and contact details removed]\n${cover.kept.join('\n')}`)
  for (const a of abstracts) parts.push(`[Abstract (${a.language === 'ar' ? 'Arabic' : 'English'}), with names and contact details removed]\n${a.text}`)
  const text = parts.join('\n\n')

  // Belt and braces: the assembled excerpt is checked once more as a whole.
  const content = text.split('\n').filter((l) => !l.startsWith('['))
  const residual = content.filter((l) => hasContact(l) || hasKnownName(l, pairs) || hasHonorific(l))
  if (residual.length) return { eligible: false, reason: 'personal_data_remaining', stats }

  // A possible person's name anywhere in what would be sent - a name the
  // platform does not hold, with no label or title before it, inside a
  // line that reads like a title or an abstract sentence - means the
  // document is ABOUT or BY someone the rules above cannot remove. The
  // whole excerpt is refused (nothing sent; hand entry), rather than
  // cutting the name out and sending the rest. lib/extraction/names.js.
  for (const line of content) {
    const rule = possiblePersonName(line)
    if (rule) {
      stats.nameRule = rule // the rule only, never the matched text
      return { eligible: false, reason: 'possible_personal_name', stats }
    }
  }

  stats.chars = text.length
  return { eligible: true, text, stats }
}

module.exports = {
  buildExcerpt,
  assessText,
  looksLikePersonList,
  hasContact,
  hasHonorific,
  isTitleLike,
  isPersonCue,
  isStructural,
  namePairs,
  hasKnownName,
  findAbstracts,
}
