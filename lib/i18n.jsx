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
  },
}

export function messagesFor(locale) {
  return MESSAGES[normalizeLocale(locale)]
}
