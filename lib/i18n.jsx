// Interface language: constants, cookie handling and the shell/landing
// copy. Deliberately a single small module rather than an i18n
// framework — two languages and a handful of screens do not need one.
//
// Shared by the server (root layout, metadata) and the client
// (LocaleProvider and its consumers), so nothing here may use hooks or
// browser APIs.

export const LOCALES = ['en', 'ar']
export const DEFAULT_LOCALE = 'en'

// Remembers an explicit choice only. Not sensitive, not used for
// anything but the interface language.
export const LOCALE_COOKIE = 'sarp_lang'

// Anything other than an explicit "ar" is English. English is never
// replaced silently: no browser-language or location detection.
export function normalizeLocale(value) {
  return value === 'ar' ? 'ar' : DEFAULT_LOCALE
}

export function dirFor(locale) {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

// Email addresses, phone numbers, file formats and sizes are always read
// left to right. <bdi dir="ltr"> isolates them so surrounding Arabic
// never reorders their characters.
const Ltr = ({ children }) => <bdi dir="ltr">{children}</bdi>

export const CONTACT_EMAIL = 'sarpcontact2026@gmail.com'
export const CONTACT_PHONE = '+249117754018'

// Every deliberate `raise exception` (SQLSTATE P0001) in the current
// submit_paper (supabase/migrations/0004_whatsapp_field.sql), keyed by its
// exact English text. The SQL is unchanged; this only decides how each
// message reads in Arabic.
const AR_SUBMIT_PAPER_ERRORS = {
  'Permission to process is required to submit.': 'يلزم منح الموافقة على معالجة البحث لإتمام التقديم.',
  'At least one publication preference is required.': 'يلزم اختيار خيار نشر واحد على الأقل.',
  'Invalid publication scope value.': 'خيار النشر المحدد غير صالح.',
  'Submitter name is required.': 'اسم مقدّم البحث مطلوب.',
  'A research file is required.': 'ملف البحث مطلوب.',
  "That doesn't look like a valid WhatsApp number.": 'لا يبدو هذا رقم واتساب صالحاً.',
}

// validateWhatsApp()'s three messages, keyed by its exact English text,
// so lib/validation/phone.js and its semantics stay untouched.
const AR_PHONE_ERRORS = {
  notANumber: 'لا يبدو هذا رقم هاتف. يرجى التحقق منه أو ترك الحقل فارغاً.',
  'That doesn’t look like a phone number. Please check it, or leave it empty.':
    'لا يبدو هذا رقم هاتف. يرجى التحقق منه أو ترك الحقل فارغاً.',
  'That number looks too short. Please enter the full number.': 'يبدو هذا الرقم قصيراً جداً. يرجى إدخال الرقم كاملاً.',
  'That number isn’t valid for the country selected. Please check it.':
    'هذا الرقم غير صالح للدولة المحددة. يرجى التحقق منه.',
}

// Every deliberate `raise exception` (SQLSTATE P0001) in the current
// confirm_researcher_metadata (supabase/migrations/0010_confirm_year_never_erases.sql),
// keyed by its exact English text. The SQL is unchanged.
const AR_CONFIRM_ERRORS = {
  'Invalid or expired confirmation link.': 'رابط التأكيد غير صالح أو منتهي الصلاحية.',
  'At least one researcher is required.': 'يلزم وجود باحث واحد على الأقل.',
  'Each researcher needs a name.': 'يجب إدخال اسم لكل باحث.',
}

export const MESSAGES = {
  en: {
    meta: {
      title: 'Sudanese Academic Research Platform',
      description: 'Submit Sudanese academic research for review and future publication.',
    },
    shell: {
      skipLink: 'Skip to main content',
      wordmark: 'Sudanese Academic Research Platform',
      navSubmit: 'Submit research',
      footerLead: 'Questions about a submission? Contact the platform team.',
      emailLabel: 'Email:',
      whatsappLabel: 'WhatsApp:',
      // The toggle always offers the OTHER language, in that language.
      switchTo: 'ar',
      switchLabel: 'العربية',
      switchAriaLabel: 'عرض الموقع بالعربية',
    },
    landing: {
      title: 'Sudanese Academic Research Platform',
      lead:
        'A straightforward way to submit Sudanese academic research for review and future publication. The platform reads key details from your document, so you don’t have to retype them.',
      cta: 'Submit your research',
      howHeading: 'How it works',
      steps: [
        { heading: 'Upload', text: 'Upload your research as a PDF or DOCX document.' },
        {
          heading: 'Review',
          text: 'The platform reads details such as the title, abstract and research team from your document.',
        },
        {
          heading: 'Confirm',
          text: 'Check the extracted details and correct anything that needs changing before you confirm.',
        },
      ],
      whatHeading: 'What you can submit',
      whatText:
        'Academic work such as theses, dissertations, journal articles, conference papers and other academic papers.',
      formatsLabel: 'Accepted formats',
      formatsValue: 'PDF or DOCX',
      sizeLabel: 'Maximum file size',
      sizeValue: '20 MB',
    },
    submission: {
      aboutYou: 'About you',
      fullName: 'Full name',
      email: 'Email',
      emailInvalid: 'That doesn’t look like an email address. Please check it.',
      whatsappLabel: 'WhatsApp number (optional)',
      whatsappHint: 'We may use this only to contact you about your research submission if necessary.',
      yourResearch: 'Your research',
      uploadLabel: 'Upload your research file (PDF or DOCX)',
      uploadHint:
        'We’ll read the title, authors, and other details directly from your document — no need to retype them here.',
      consent: 'Consent',
      consentText:
        'I agree to let this platform, including an external AI service, process my research to extract details like the title, authors, and abstract.',
      scopeQuestion: 'What are you comfortable with us publishing? Select all that apply.',
      scope: {
        full_paper: 'Publish the complete paper',
        metadata_and_article: 'Publish an accessible article + summary',
        abstract_and_citation: 'Publish only the abstract and citation',
      },
      submit: 'Submit my research',
      submitting: 'Submitting…',
      extracting:
        'Thank you for sharing your work. We’re reading through it now to find your title, abstract, and research team, this usually takes under a minute.',
      stillNeeded: (items) => `Still needed: ${items.join(', ')}.`,
      outstanding: {
        name: 'your name',
        email: 'a valid email address',
        whatsapp: 'a valid WhatsApp number (or clear the field)',
        file: 'a PDF or DOCX file under 20 MB',
        permission: 'your permission to process the file',
        scope: 'at least one publishing choice',
      },
      errors: {
        noFile: 'Please attach your research file (PDF or DOCX).',
        tooBig: (sizeMb) => `That file is ${sizeMb} MB. The limit is 20 MB, so please upload a smaller version.`,
        wrongType: 'Please upload a PDF or DOCX file. Older .doc files aren’t supported.',
        noPermission: 'Please confirm you allow us to process your research.',
        noScope: 'Please choose at least one thing you’re comfortable with us publishing.',
        uploadTooLarge: 'That file is too large. The limit is 20 MB, so please upload a smaller version.',
        uploadType: 'That file type isn’t supported. Please upload a PDF or DOCX file.',
        uploadGeneric: 'We couldn’t upload your file. Please try again in a moment.',
        internal: 'Something went wrong on our side. Please try again in a moment.',
      },
      // English shows submit_paper's own P0001 text and the phone
      // validator's own text unchanged: both were written for people.
      rpcError: (message) => message,
      phoneError: (message) => message,
    },
    country: {
      name: (country) => country.name_en,
      trigger: (name) => `Country: ${name}. Change`,
      search: 'Search country or code',
      empty: 'No country matches that.',
    },
    confirmation: {
      linkInvalid:
        'We couldn’t find a submission for this link. If you believe this is a mistake, please contact us directly.',
      done: {
        heading: 'Thank you for confirming',
        lead: 'Your research details are recorded exactly as you approved them.',
        body:
          'Your work now enters the platform’s review process, where it will be prepared for publication. We’ll reach out using the details you provided if anything else is needed.',
        closing: 'Thank you for contributing your work to the Sudanese Research Platform.',
      },
      notResearch: {
        heading: 'This doesn’t look like an academic paper',
        body1:
          'The file you uploaded doesn’t appear to be an academic paper, thesis, dissertation, conference paper, or journal article.',
        body2:
          'If you uploaded the wrong file by mistake, you can start a new submission with the right one. If you believe this is an error, please contact us and we’ll take a look.',
      },
      encrypted: {
        heading: 'This document is password-protected',
        body1: 'This document is password-protected and cannot be processed automatically.',
        body2:
          'Please remove the password from the file and submit it again. If you’re not sure how, most word processors offer this under a “Protect Document” or “Encrypt” setting when saving.',
      },
      newSubmission: 'Start a new submission',
      transient: {
        heading: 'We couldn’t finish reading it just now',
        body1:
          'There’s nothing wrong with your document. Our reading service was temporarily busy and didn’t respond in time.',
        body2: 'Your submission is saved. You can try again right now, or leave it and we’ll follow up by email.',
        retry: 'Try again',
        retrying: 'Trying again…',
      },
      failed: {
        heading: 'We couldn’t read this document',
        body1:
          'Something about this file stopped us from reading it automatically. This sometimes happens with unusual formats or scanned pages of low quality.',
        body2: 'We still have your submission, and we’ll follow up with you by email.',
      },
      loadingHeading: 'Reading your research',
      readyHeading: 'Here’s what we found',
      loadingSubtitle: 'This usually takes under a minute. The page will fill in on its own.',
      readySubtitle: 'Please check everything below, and correct anything we got wrong.',
      attention: (n) => (n === 1 ? '1 field needs your attention.' : `${n} fields need your attention.`),
      partial:
        'We read the beginning of your document, but couldn’t automatically verify every field. Please look over everything below carefully.',
      teamHeading: 'Research team',
      teamHint: 'Listed in the order your paper presents them. Not a ranking, just the order.',
      moveUp: 'Move up',
      moveDown: 'Move down',
      fullName: 'Full name',
      researcherName: (n) => `Researcher ${n} full name`,
      remove: 'Remove',
      addResearcher: '+ Add a researcher',
      detailsHeading: 'Research details',
      // single: the only box of its pair on screen; paired: both are.
      fields: {
        title: { single: 'Title', paired: 'Title (English)' },
        title_ar: { single: 'Title', paired: 'Title (Arabic)' },
        supervisor_name: 'Supervisor',
        university: 'University',
        faculty: 'Faculty or school',
        degree_type: 'Degree',
        year: 'Year',
        abstract: { single: 'Abstract', paired: 'Abstract (English)' },
        abstract_ar: { single: 'Abstract', paired: 'Abstract (Arabic)' },
      },
      needsAttention: 'Needs your attention',
      edit: 'Edit',
      emptyHint: 'Not found in your paper. Tap to add it.',
      pairEmptyHint: 'Your paper doesn’t appear to have this in this language. You can leave it empty.',
      conflicting: 'Your paper gives two different answers here. Which is right?',
      ambiguous: 'We weren’t certain about this one. Please check it.',
      sourcePrefix: 'Found on ',
      socialAdd: 'Add a LinkedIn or Facebook link',
      socialWhy:
        'Adding a profile lets us credit and tag this researcher when the work is featured, so it reaches their own network too. Both are optional.',
      linkedin: 'LinkedIn URL (optional)',
      facebook: 'Facebook URL (optional)',
      confirm: 'Confirm these details',
      confirmExtracting: 'Reading your research…',
      confirmSaving: 'Saving…',
      timeout: 'This is taking longer than usual.',
      timeoutRetry: 'Try again',
      timeoutRestarting: 'Restarting…',
      errors: {
        emptyResearcher: 'Please fill in every researcher’s name, or remove the empty row.',
        missingTitle: 'Please add the title of your research, in English or Arabic, before confirming.',
        invalidYear: 'Please enter the year as four digits, for example 2023.',
        save: (code) =>
          `We couldn’t save your confirmation. Please try again in a moment.${code ? ` (reference: ${code})` : ''}`,
        network:
          'We couldn’t reach the server to save your confirmation. Please check your connection and try again — nothing has been lost.',
      },
      rpcError: (message) => message,
    },
  },
  ar: {
    meta: {
      title: 'المنصة السودانية للبحث الأكاديمي',
      description: 'تقديم البحوث الأكاديمية السودانية للمراجعة والنشر مستقبلاً.',
    },
    shell: {
      skipLink: 'انتقل إلى المحتوى الرئيسي',
      wordmark: 'المنصة السودانية للبحث الأكاديمي',
      navSubmit: 'تقديم بحث',
      footerLead: 'هل لديك سؤال حول تقديم بحث؟ تواصل مع فريق المنصة.',
      emailLabel: 'البريد الإلكتروني:',
      whatsappLabel: 'واتساب:',
      switchTo: 'en',
      switchLabel: 'English',
      switchAriaLabel: 'View site in English',
    },
    landing: {
      title: 'المنصة السودانية للبحث الأكاديمي',
      lead:
        'طريقة مباشرة لتقديم البحوث الأكاديمية السودانية للمراجعة والنشر مستقبلاً. تقرأ المنصة التفاصيل الأساسية من مستندك، حتى لا تضطر إلى إعادة كتابتها.',
      cta: 'قدّم بحثك',
      howHeading: 'كيف تعمل المنصة',
      steps: [
        {
          heading: 'الرفع',
          text: (
            <>
              ارفع بحثك بصيغة <Ltr>PDF</Ltr> أو <Ltr>DOCX</Ltr>.
            </>
          ),
        },
        { heading: 'المراجعة', text: 'تقرأ المنصة تفاصيل مثل العنوان والملخص وفريق البحث من مستندك.' },
        { heading: 'التأكيد', text: 'راجع التفاصيل المستخرجة وصحح ما يحتاج إلى تعديل قبل التأكيد.' },
      ],
      whatHeading: 'ما الذي يمكنك تقديمه',
      whatText:
        'أعمال أكاديمية مثل رسائل الماجستير وأطروحات الدكتوراه والمقالات العلمية وأوراق المؤتمرات وغيرها من البحوث الأكاديمية.',
      formatsLabel: 'الصيغ المقبولة',
      formatsValue: (
        <>
          <Ltr>PDF</Ltr> أو <Ltr>DOCX</Ltr>
        </>
      ),
      sizeLabel: 'الحد الأقصى لحجم الملف',
      sizeValue: <Ltr>20 MB</Ltr>,
    },
    submission: {
      aboutYou: 'عنك',
      fullName: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      emailInvalid: 'لا يبدو هذا عنوان بريد إلكتروني صالحاً. يرجى التحقق منه.',
      whatsappLabel: 'رقم الواتساب (اختياري)',
      whatsappHint: 'قد نستخدم هذا الرقم فقط للتواصل معك بشأن تقديم بحثك عند الحاجة.',
      yourResearch: 'بحثك',
      // A plain string on purpose: <bdi> inside a <label> pads the computed
      // accessible name ("( PDF"), and the bidi algorithm already orders
      // this line and mirrors its brackets correctly on its own.
      uploadLabel: 'ارفع ملف بحثك (PDF أو DOCX)',
      uploadHint: 'سنقرأ العنوان والباحثين والتفاصيل الأخرى مباشرةً من مستندك، فلا حاجة إلى إعادة كتابتها هنا.',
      consent: 'الموافقة',
      consentText:
        'أوافق على معالجة بحثي من قبل المنصة، بما في ذلك إرساله إلى خدمة ذكاء اصطناعي خارجية للمساعدة في استخراج تفاصيل مثل العنوان والباحثين والملخص.',
      scopeQuestion: 'ما الذي توافق على نشره؟ اختر كل ما ينطبق',
      scope: {
        full_paper: 'نشر البحث كاملاً',
        metadata_and_article: 'نشر مقال مبسط وملخص فقط',
        abstract_and_citation: 'نشر الملخص والاستشهاد فقط',
      },
      submit: 'قدّم بحثي',
      submitting: 'جارٍ تقديم البحث…',
      extracting:
        'شكراً لمشاركتك بحثك. نقرأه الآن لاستخراج العنوان والملخص وفريق البحث، ويستغرق ذلك عادةً أقل من دقيقة.',
      stillNeeded: (items) => `ما يزال مطلوباً: ${items.join('، ')}.`,
      outstanding: {
        name: 'اسمك',
        email: 'عنوان بريد إلكتروني صالح',
        whatsapp: 'رقم واتساب صالح (أو اترك الحقل فارغاً)',
        file: 'ملف PDF أو DOCX بحجم أقل من \u206620 MB\u2069',
        permission: 'موافقتك على معالجة الملف',
        scope: 'خيار نشر واحد على الأقل',
      },
      // \u2066…\u2069 (LRI…PDI) isolate "20 MB" inside plain strings the way
      // <bdi dir="ltr"> does in markup; without it RTL shows "MB 20".
      errors: {
        noFile: 'يرجى إرفاق ملف البحث بصيغة PDF أو DOCX.',
        tooBig: (sizeMb) => `حجم هذا الملف \u2066${sizeMb} MB\u2069. الحد الأقصى هو \u206620 MB\u2069، لذا يرجى رفع نسخة أصغر.`,
        wrongType: 'يرجى رفع ملف بصيغة PDF أو DOCX. ملفات .doc القديمة غير مدعومة.',
        noPermission: 'يرجى تأكيد موافقتك على معالجة بحثك.',
        noScope: 'يرجى اختيار عنصر واحد على الأقل مما توافق على نشره.',
        uploadTooLarge: 'هذا الملف كبير جداً. الحد الأقصى هو \u206620 MB\u2069، لذا يرجى رفع نسخة أصغر.',
        uploadType: 'نوع هذا الملف غير مدعوم. يرجى رفع ملف بصيغة PDF أو DOCX.',
        uploadGeneric: 'تعذر علينا رفع ملفك. يرجى المحاولة مرة أخرى بعد قليل.',
        internal: 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى بعد قليل.',
      },
      // Unknown P0001 text is never shown untranslated in Arabic; it falls
      // back to the generic message rather than leaking English.
      rpcError: (message) => AR_SUBMIT_PAPER_ERRORS[message] || 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى بعد قليل.',
      phoneError: (message) => AR_PHONE_ERRORS[message] || AR_PHONE_ERRORS.notANumber,
    },
    country: {
      name: (country) => country.name_ar,
      trigger: (name) => `الدولة: ${name}. تغيير`,
      search: 'ابحث عن دولة أو رمز',
      empty: 'لا توجد دولة مطابقة.',
    },
    confirmation: {
      linkInvalid:
        'لم نتمكن من العثور على طلب تقديم مرتبط بهذا الرابط. إذا كنت تعتقد أن هناك خطأ، يرجى التواصل معنا مباشرةً.',
      done: {
        heading: 'شكراً لتأكيد التفاصيل',
        lead: 'تم تسجيل تفاصيل بحثك كما وافقت عليها تماماً.',
        body:
          'ينتقل بحثك الآن إلى مرحلة المراجعة في المنصة تمهيداً لإعداده للنشر. سنتواصل معك باستخدام البيانات التي قدمتها إذا احتجنا إلى أي معلومات إضافية.',
        closing: 'شكراً لمساهمتك ببحثك في المنصة السودانية للبحث الأكاديمي.',
      },
      notResearch: {
        heading: 'لا يبدو هذا مستنداً أكاديمياً',
        body1:
          'لا يبدو أن الملف الذي رفعته بحث أكاديمي أو رسالة ماجستير أو أطروحة دكتوراه أو ورقة مؤتمر أو مقالاً علمياً.',
        body2:
          'إذا رفعت الملف الخطأ عن طريق الخطأ، يمكنك بدء تقديم جديد باستخدام الملف الصحيح. وإذا كنت تعتقد أن هذه النتيجة غير صحيحة، فتواصل معنا وسنراجعها.',
      },
      encrypted: {
        heading: 'هذا المستند محمي بكلمة مرور',
        body1: 'هذا المستند محمي بكلمة مرور ولا يمكن معالجته تلقائياً.',
        body2:
          'يرجى إزالة كلمة المرور من الملف ثم تقديمه مرة أخرى. إذا لم تكن متأكداً من الطريقة، توفر معظم برامج معالجة النصوص هذا الخيار ضمن إعدادات حماية المستند أو التشفير عند الحفظ.',
      },
      newSubmission: 'ابدأ تقديم بحث جديد',
      transient: {
        heading: 'لم نتمكن من إكمال قراءة البحث الآن',
        body1: 'لا توجد مشكلة في مستندك. كانت خدمة قراءة المستندات لدينا مشغولة مؤقتاً ولم تستجب في الوقت المحدد.',
        body2: 'تم حفظ طلبك. يمكنك المحاولة مرة أخرى الآن، أو تركه وسنتابع معك عبر البريد الإلكتروني.',
        retry: 'حاول مرة أخرى',
        retrying: 'جارٍ المحاولة مرة أخرى…',
      },
      failed: {
        heading: 'لم نتمكن من قراءة هذا المستند',
        body1:
          'منعنا شيء في هذا الملف من قراءته تلقائياً. قد يحدث ذلك أحياناً مع التنسيقات غير المعتادة أو الصفحات الممسوحة ضوئياً بجودة منخفضة.',
        body2: 'ما زال طلبك محفوظاً، وسنتابع معك عبر البريد الإلكتروني.',
      },
      loadingHeading: 'جارٍ قراءة بحثك',
      readyHeading: 'هذه هي التفاصيل التي وجدناها',
      loadingSubtitle: 'يستغرق هذا عادةً أقل من دقيقة. ستظهر التفاصيل في الصفحة تلقائياً.',
      readySubtitle: 'يرجى مراجعة جميع التفاصيل أدناه وتصحيح أي شيء غير صحيح.',
      // Arabic number agreement: singular, dual, then plural (3-10). Nine
      // fields is the most that can ever be flagged.
      attention: (n) =>
        n === 1
          ? 'هناك حقل واحد يحتاج إلى انتباهك.'
          : n === 2
            ? 'هناك حقلان يحتاجان إلى انتباهك.'
            : `هناك ${n} حقول تحتاج إلى انتباهك.`,
      partial:
        'قرأنا بداية مستندك، لكننا لم نتمكن من التحقق تلقائياً من كل حقل. يرجى مراجعة جميع التفاصيل أدناه بعناية.',
      teamHeading: 'فريق البحث',
      teamHint: 'الأسماء مرتبة حسب ترتيب ظهورها في البحث. هذا ليس ترتيباً تفضيلياً، بل ترتيب الظهور فقط.',
      moveUp: 'تحريك لأعلى',
      moveDown: 'تحريك لأسفل',
      fullName: 'الاسم الكامل',
      researcherName: (n) => `الاسم الكامل للباحث ${n}`,
      remove: 'إزالة الباحث',
      addResearcher: '+ إضافة باحث',
      detailsHeading: 'تفاصيل البحث',
      fields: {
        title: { single: 'العنوان', paired: 'العنوان (بالإنجليزية)' },
        title_ar: { single: 'العنوان', paired: 'العنوان (بالعربية)' },
        supervisor_name: 'المشرف',
        university: 'الجامعة',
        faculty: 'الكلية أو المدرسة',
        degree_type: 'الدرجة العلمية',
        year: 'السنة',
        abstract: { single: 'الملخص', paired: 'الملخص (بالإنجليزية)' },
        abstract_ar: { single: 'الملخص', paired: 'الملخص (بالعربية)' },
      },
      needsAttention: 'يحتاج إلى انتباهك',
      edit: 'تعديل',
      emptyHint: 'لم نعثر عليه في بحثك. اضغط لإضافته.',
      pairEmptyHint: 'لا يبدو أن بحثك يتضمن هذا المحتوى بهذه اللغة. يمكنك ترك الحقل فارغاً.',
      conflicting: 'يعرض بحثك إجابتين مختلفتين هنا. أيهما الصحيحة؟',
      ambiguous: 'لم نكن متأكدين من هذه المعلومة. يرجى التحقق منها.',
      sourcePrefix: 'المصدر: ',
      socialAdd: (
        <>
          إضافة رابط <Ltr>LinkedIn</Ltr> أو <Ltr>Facebook</Ltr>
        </>
      ),
      socialWhy:
        'تتيح إضافة ملف شخصي لنا نسب العمل إلى هذا الباحث والإشارة إليه عند إبراز البحث، مما يساعد على وصوله إلى شبكته أيضاً. كلا الرابطين اختياري.',
      linkedin: 'رابط LinkedIn (اختياري)',
      facebook: 'رابط Facebook (اختياري)',
      confirm: 'تأكيد هذه التفاصيل',
      confirmExtracting: 'جارٍ قراءة بحثك…',
      confirmSaving: 'جارٍ الحفظ…',
      timeout: 'يستغرق هذا وقتاً أطول من المعتاد.',
      timeoutRetry: 'حاول مرة أخرى',
      timeoutRestarting: 'جارٍ إعادة المحاولة…',
      errors: {
        emptyResearcher: 'يرجى إدخال اسم لكل باحث أو إزالة الصف الفارغ.',
        missingTitle: 'يرجى إضافة عنوان بحثك بالإنجليزية أو العربية قبل التأكيد.',
        invalidYear: 'يرجى إدخال السنة بأربعة أرقام، مثلاً 2023.',
        // The reference code is isolated LTR (LRI…PDI) so a code such as
        // PGRST301 is never reordered inside the Arabic sentence.
        save: (code) =>
          `تعذر علينا حفظ تأكيدك. يرجى المحاولة مرة أخرى بعد قليل.${code ? ` (المرجع: ⁦${code}⁩)` : ''}`,
        network:
          'تعذر علينا الوصول إلى الخادم لحفظ تأكيدك. يرجى التحقق من اتصالك والمحاولة مرة أخرى — لم يتم فقدان أي من تعديلاتك.',
      },
      rpcError: (message) => AR_CONFIRM_ERRORS[message] || 'تعذر علينا حفظ تأكيدك. يرجى المحاولة مرة أخرى بعد قليل.',
    },
  },
}

export function messagesFor(locale) {
  return MESSAGES[normalizeLocale(locale)]
}
