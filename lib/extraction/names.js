// lib/extraction/names.js
//
// "Could this text name a person?" - the last check before an excerpt is
// sent under Google's unpaid terms (lib/extraction/excerpt.js). When it
// answers yes, NOTHING is sent and the researcher enters the details by
// hand: a possible name is a reason to refuse, not something to cut out
// and carry on (founder decision of 2026-10-04, after the case of an
// unlabelled name inside a title, "Poems of Hawa Eltaib ...").
//
// What it recognises, in English and Arabic text:
//   - common given names of Sudan and the wider Arabic-speaking world
//     (and a few common in South Sudan), in their usual spellings;
//   - "El"/"Al"-prefixed forms of those names (Elhassan, Al-Amin, Eltayeb);
//   - "Abd"/"Abdel"/"Abdul" compounds (Abdelrahim, Abdalla) and عبد + الـ;
//   - initials before a capitalised word (A. Elhassan, K. E. Yousif);
//   - lineage words between capitalised words (bin, bint, ibn, wad) and
//     بن or ود between two words.
//
// What it deliberately leaves alone, so that ordinary research text is not
// refused: Arabic words that are also names but are common words (على/علي
// "on", حسن "good", صالح "suitable", عمر "age", أمل "hope"...); English words
// that are also names ("said", "hind", "salah" the prayer, "iman"); place
// and institution names that contain a given name (Wad Medani, Abu Hamad,
// Ahmed Gasim University). Those are removed before the check.
//
// It is a heuristic. It misses names it has never seen (a surname used
// alone, "Wardi's songs") and refuses some text that names no one (a
// thesis on the Prophet Muhammad, a title mentioning a person honoured in
// a building's name). scripts/test-excerpt.js measures both on examples
// that were not used to write these lists. It is not anonymization and
// not proof that an excerpt holds no personal information.

const LATIN_GIVEN = `
mohamed mohammed muhammad mohammad mohamad mohd ahmed ahmad ali osman othman usman uthman hassan hasan hussein husain hussain hussien
husein ibrahim ibraheem omer omar khalid khaled abdalla abdallah abdullah abdella mustafa mostafa moustafa yousif yousef yusuf youssef
yousuf salih saleh babiker babikir bashir basheer amin ameen tayeb tayyib taib tyeb altayeb sir fadil fadl fadul hamid hamed hamad
hamdan mahmoud mahmud musa mousa moussa ismail ismael idris idriss yahia yahya yehia adam haroun harun suliman sulaiman suleiman sulieman
siddig siddiq siddik sadig sadiq awad gasim qasim kasim taha yassin yasin yaseen nasir naser nasser kamal jamal gamal tarig tariq tarek
tarik hisham hatim hatem hashim hashem maher malik mubarak nour noor sami samir saad saeed sharif shareef fathi faisal fouad fuad hamza
ishag ishaq ishak jaafar gaafar kheir khair majdi magdi mazin mazen moawia muawiya montasir muntasir mutasim motasim nadir nasreldin
osama usama rashid rasheed salaheldin seif saif waleed walid yasir yasser yaser zakaria zakariya ayman bakri bakheet bakhit dafalla
dafaalla elnour tigani tijani fatih ezzeldin izzeldin hamadnalla hassabo hassaballa hassab mahjoub mahgoub mirghani elmahdi mahdi
sadiq abbas abdou anwar azhari bukhari daoud dawood dawoud elias ilyas fakhri farouk faruq ghazi habib hafiz hafez hamadto haydar
hayder hussam ibrahima idrees imad emad jibril gibril jubara karar khalifa kabashi kamil kamel labib lutfi mamoun maamoun marwan
mekki makki mohanad muhannad munir mounir murtada murtadha mutaz moataz nabil nabeel nagi naji nasr nazar nimir omran imran qurashi
rabie rabea radwan ridwan rami rifaat sabir saber sabri sadig safwan sakhr salman samih shams shawgi shawqi shihab sidahmed sidig
sufian sofian suhaib suhayb sultan tahir taher talal tamer tamir tawfig tawfiq towfik ubai umar wagdi wail wael yagoub yaqub yahiya
zubair zubeir zuhair elsir alsir
fatima fatma fatimah amna amina aminah amena asma asmaa aisha aesha ayesha khadija khadeeja zainab zeinab zaynab mariam maryam miriam hawa sara
sarah samia samiya nafisa nafeesa salma suad souad suha rania randa rasha reem rehab safa sahar samah samar sawsan shaza shireen
sherin tahani tasneem wafa widad yasmin yasmeen zahra hiba hanan hana ilham inaam intisar ikhlas khalda lubna maha manal maysa
nagla najla najwa nawal nisreen nesreen nuha omayma umayma rabab alawia awatif azza azaz bakhita buthaina dalia duaa ebtisam
fadia fayza ghada haifa halima hayat hadia huwaida igbal ibtisam insaf kawthar kawther layla leila madiha mawahib mashair
mayada mervat nahid nahla najat nidal rahma rufaida rugaya ruqaya sakina salwa shadia siham sumaya tamadur thuraya umsalama
wisal zeinat zuhal
john james peter paul joseph michael david daniel george william samuel simon philip mary elizabeth martha rebecca grace
francis anthony emmanuel stephen thomas andrew matthew mark luke deng garang kiir machar lual akol bol
`.split(/\s+/).filter(Boolean)

// Spellings that are common English (or Islamic-studies) words: never
// treated as names on their own.
const LATIN_EXCLUDE = new Set(['said', 'hind', 'salah', 'iman', 'huda', 'nada', 'amal', 'mark', 'grace', 'bol', 'sir', 'nour', 'noor'])

// Arabic given names that are not also common words (آمنة "safe", الطيب
// "good", الأمين as in "secretary-general", سمية "toxicity", هبة "gift",
// عمر "age", حسن "good", صالح "suitable", على "on" are left out on purpose).
const ARABIC_GIVEN = `
محمد احمد عثمان ابراهيم يوسف مصطفى موسى عيسى اسماعيل اسحاق يعقوب داود سليمان طه ياسين خديجة فاطمة عائشة زينب مريم حواء
بابكر حامد ادريس يحيى هارون عباس المهدي الميرغني حسين الحسين خالد طارق هشام حاتم هاشم محمود سهى رانيا رشا ريم سامية
نفيسة نوال نجلاء لبنى مها ناهد ثريا وصال عبدالله عبدالرحمن عبدالرحيم عبدالقادر عبدالعزيز
جون جيمس بيتر بطرس بولس جوزيف مايكل دانيال صموئيل فرانسيس دينق قرنق مشار ماريا
`.split(/\s+/).filter(Boolean)

// Words that start sentences or headings, not surnames.
const NOT_A_NAME_AFTER = new Set(['the', 'this', 'these', 'those', 'that', 'there', 'it', 'its', 'in', 'on', 'at', 'an', 'we', 'our',
  'results', 'result', 'however', 'moreover', 'furthermore', 'finally', 'also', 'data', 'both', 'all', 'each', 'most', 'some', 'many',
  'such', 'for', 'from', 'with', 'while', 'after', 'before', 'during', 'among', 'between', 'and', 'but', 'overall', 'conclusion',
  'conclusions', 'methods', 'method', 'background', 'objective', 'objectives', 'aim', 'aims', 'study', 'studies', 'patients',
  'participants', 'samples', 'keywords', 'key', 'introduction', 'recommendations', 'findings', 'significant', 'statistical'])

// Places and institutions that contain a given name. Removed (as whole
// phrases) before the check, so they never cause a refusal by themselves.
const NAMED_PLACES = [
  'wad medani', 'wad madani', 'wadi halfa', 'abu hamad', 'abu zabad', 'abu jubaiha', 'abu haraz', 'abu gibeiha', 'abu naama',
  'ahmed gasim university', 'al zaiem al azhari university', 'alzaiem alazhari university', 'zaiem azhari', 'ahfad university',
  'sheikh abdalla albadri university', 'mohamed ali street', 'sennar', 'king faisal', 'imam mahdi university', 'al imam al mahdi university',
  'ود مدني', 'ابو حمد', 'ابو زبد', 'ابو جبيهه', 'جامعه احمد قاسم', 'جامعه الزعيم الازهري', 'جامعه الاحفاد', 'جامعه الامام المهدي',
]

function foldArabic(s) {
  return s
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
}

const LATIN_SET = new Set(LATIN_GIVEN.filter((n) => !LATIN_EXCLUDE.has(n)))
const ARABIC_SET = new Set(ARABIC_GIVEN.map((n) => foldArabic(n)))

function clean(text) {
  let t = ` ${String(text || '').normalize('NFKC')} `
  // Remove named places and institutions first (case-insensitive, folded).
  let folded = foldArabic(t.toLowerCase())
  for (const place of NAMED_PLACES) {
    let i = folded.indexOf(place)
    while (i !== -1) {
      t = t.slice(0, i) + ' '.repeat(place.length) + t.slice(i + place.length)
      folded = folded.slice(0, i) + ' '.repeat(place.length) + folded.slice(i + place.length)
      i = folded.indexOf(place)
    }
  }
  return t
}

// Returns null, or the RULE that matched (never the matched text: the
// result is stored in diagnostics, and must not itself carry a name).
function possiblePersonName(text) {
  const t = clean(text)
  // Latin tokens, with their original case.
  const latin = t.match(/[A-Za-z][A-Za-z'’.-]*/g) || []
  for (let i = 0; i < latin.length; i += 1) {
    const raw = latin[i].replace(/['’]s$/, '').replace(/[.'’-]+$/, '')
    if (!raw) continue
    const lower = raw.toLowerCase()
    const capitalised = /^[A-Z]/.test(raw)
    if (!capitalised) continue
    const parts = lower.split('-').filter(Boolean)
    for (const p of parts) {
      if (LATIN_SET.has(p)) return 'given_name'
      const stem = p.replace(/^(el|al|ad|ed|es|et|as|at|an|en)(?=[a-z]{3,})/, '')
      if (stem !== p && LATIN_SET.has(stem)) return 'prefixed_name'
      if (/^abd(el|al|ul|u|ou|a|e)?[a-z]{3,}$/.test(p) && p !== 'abdomen' && !p.startsWith('abdomin') && !p.startsWith('abduct')) return 'abd_compound'
    }
    // lineage words between two capitalised words
    if (['bin', 'bint', 'ibn', 'wad', 'walad'].includes(lower) && i > 0 && latin[i + 1] && /^[A-Z]/.test(latin[i - 1]) && /^[A-Z]/.test(latin[i + 1])) {
      return 'lineage'
    }
  }
  // Lower-case lineage words: "X bin Y" with unknown names.
  if (/\b[A-Z][a-z]+ (bin|bint|ibn) [A-Z][a-z]+/.test(t)) return 'lineage'

  // "A. Elhassan", "K. E. Yousif": initials before a capitalised word, but
  // not "Group A. The results" or "vitamin D. Patients".
  for (const m of t.matchAll(/(^|[\s,;(])((?:[A-Z]\.\s?){1,3})([A-Z][a-z]{2,})/g)) {
    const before = t.slice(0, m.index + m[1].length).trim().split(/\s+/).pop() || ''
    if (NOT_A_NAME_AFTER.has(m[3].toLowerCase())) continue
    if (/^(vitamin|group|groups|type|grade|class|stage|phase|table|figure|fig|zone|region|site|area|block|plot|hepatitis|category|level|part|section|appendix|plan|option|scenario|model|sample|samples|batch|unit|line|treatment|strain)$/i.test(before)) continue
    return 'initial_and_name'
  }

  // Arabic tokens.
  const arabic = foldArabic(t).match(/[ء-ي]+/g) || []
  for (let i = 0; i < arabic.length; i += 1) {
    const w = arabic[i]
    // A leading "و" (and) or "ل"/"ب" (to/by) can be attached to a name.
    const bare = [w, w.replace(/^[وبل]/, ''), w.replace(/^[وبل]ال/, 'ال')]
    if (bare.some((b) => ARABIC_SET.has(b))) return 'given_name'
    // عبد + a word beginning with ال, or written together (عبدالله, عبدالرحمن).
    if ((w === 'عبد' || w === 'وعبد') && arabic[i + 1] && arabic[i + 1].startsWith('ال')) return 'abd_compound'
    if (/^و?عبدال[ء-ي]{2,}$/.test(w)) return 'abd_compound'
    // بن between two words ("محمد بن سلمان"); بنت ("girl") and ابن ("son")
    // are too common in research text to count on their own.
    if (w === 'بن' && i > 0 && arabic[i + 1]) return 'lineage'
    // ود ("son of", Sudanese) between two words: "فرح ود تكتوك". Place
    // names that contain it (ود مدني) were removed above.
    if (w === 'ود' && i > 0 && arabic[i + 1]) return 'lineage'
  }
  return null
}

module.exports = { possiblePersonName, NAMED_PLACES }
