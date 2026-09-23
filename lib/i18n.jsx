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
  },
}

export function messagesFor(locale) {
  return MESSAGES[normalizeLocale(locale)]
}
