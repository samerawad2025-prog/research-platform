// Interface language: constants, cookie handling and the shell/landing
// copy. Deliberately a single small module rather than an i18n
// framework — two languages and a handful of screens do not need one.
//
// Shared by the server (root layout, metadata) and the client
// (LocaleProvider and its consumers), so nothing here may use hooks or
// browser APIs.

import { ADMIN_MESSAGES } from './i18nAdmin'
import { PUBLIC_MESSAGES } from './i18nPublic'

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

// The platform's official name in each language: the one visible
// identity (header wordmark, landing title, footer, browser title and the
// completion message all read from here, so they cannot drift apart
// again). No abbreviation is used anywhere in the interface.
const OFFICIAL_NAME = {
  en: 'Sudanese Academic Research Platform',
  ar: 'المنصة السودانية للبحث الأكاديمي',
}

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
  // Added by migration 0013.
  "This person is also listed on another submission, so their name and profile can't be changed here. Please contact us to correct them.":
    'هذا الشخص مُدرج أيضاً في طلب تقديم آخر، لذلك لا يمكن تغيير اسمه أو ملفه الشخصي من هنا. يرجى التواصل معنا لتصحيحهما.',
  'Please enter a LinkedIn profile address, for example https://www.linkedin.com/in/your-name':
    'يرجى إدخال عنوان ملف شخصي على LinkedIn، مثل \u2066https://www.linkedin.com/in/your-name\u2069',
}

export const MESSAGES = {
  en: {
    admin: ADMIN_MESSAGES.en,
    research: PUBLIC_MESSAGES.en,
    meta: {
      title: OFFICIAL_NAME.en,
      description: 'Submit Sudanese academic research for review and future publication.',
    },
    shell: {
      skipLink: 'Skip to main content',
      wordmark: OFFICIAL_NAME.en,
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
      title: OFFICIAL_NAME.en,
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
      chooseFile: 'Choose research file',
      required: 'Required',
      noFileSelected: 'No file selected',
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
      // Shown between a stored submission and the next page. A progress
      // message, never a thank-you: nothing is finished until the details
      // are confirmed on the next page.
      opening: 'Uploaded. Opening the next step…',
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
    // Phase 3 M2B: the acceptance-based submission form
    // (components/AcceptanceSubmissionForm.jsx).
    acceptance: {
      loading: 'Loading the submission terms…',
      unavailableHeading: 'Submissions are temporarily unavailable',
      unavailableBody:
        'New submissions can’t be accepted right now, and nothing has been sent. Please try again later, or contact us using the details below.',
      retry: 'Try again',
      roleLegend: 'Your role',
      roles: {
        author: { label: 'I am the author', hint: 'You wrote this work, or are its only or first author.' },
        coauthor: { label: 'I am one of the authors', hint: 'You are one of several authors of this work.' },
        authorized_depositor: {
          label: 'I am submitting on behalf of the authors',
          hint: 'For example, a librarian or volunteer with the authors’ permission. You will not be listed as an author.',
        },
      },
      authorsLegend: 'Authors of this work',
      authorsHint: 'Enter each author’s name as it appears on the work, in order. The list can be corrected later.',
      authorName: (n) => `Author ${n} name`,
      addAuthor: '+ Add an author',
      removeAuthor: (n) => `Remove author ${n}`,
      settingLegend: 'Publication permission',
      settingIntro:
        'Choose what may be made public if the platform approves your submission. Nothing is published before review, and no open (Creative Commons) licence is applied.',
      settings: {
        record_abstract: {
          label: 'Record and abstract only',
          hint: 'The approved title, authors, bibliographic details, abstract and citation may be public. The full document stays private.',
        },
        record_abstract_fulltext: {
          label: 'Record, abstract and full text',
          hint: 'The same, plus the approved document, which readers may read online and download for personal study and research.',
        },
      },
      processingLegend: 'How your document will be processed',
      processing: {
        // Short, visible AI-processing explanation (agreement section 6 has the detail).
        // Keyed by the arrangement the server attests (GEMINI_DATA_TERMS).
        automaticBy: {
          gemini_api_unpaid:
            'By default, our server reads your file itself and sends Google’s Gemini AI service (free tier) only a short excerpt — cover-page lines, the likely title and the abstract — with names and contact details removed. Google may use it to improve its products, and people at Google may review it. Removal is automatic and can miss things, so choose manual entry if your title or abstract contains personal or confidential information. Suggestions can be wrong: you add the authors and supervisor yourself and check every detail.',
          gemini_api_paid:
            'By default, the first pages of your document (or text from a Word file) are sent to Google’s Gemini AI service to suggest its title, authors and other details. Google does not use them to improve its products, but keeps them for up to 55 days to check for misuse. Suggestions can be wrong: you check and correct every detail before confirming.',
        },
        manual: 'Your document will not be read automatically. After upload, you will enter its details yourself.',
      },
      processingChoices: {
        automatic: {
          label: 'Read my document with Gemini (recommended)',
          hint: 'The details are filled in for you to check and correct.',
        },
        manual: {
          label: 'Enter details manually',
          hint: 'Nothing from your document is sent to Gemini. You type its details yourself after upload.',
        },
      },
      termsLegend: 'Agreement',
      summary:
        'Your submission remains private until reviewed. Publication follows your selected setting. Approved public full text can be read and downloaded.',
      readTerms: 'Read the full agreement',
      version: (label, date) => `${label}, ${date}`,
      termsRegion: 'Full text of the agreement',
      otherLanguage: 'The agreement is not available in your language, so it is shown in the language below.',
      submit: 'Accept and submit',
      working: {
        intent: 'Recording your acceptance…',
        upload: 'Uploading your file…',
        finalize: 'Completing your submission…',
        opening: 'Uploaded. Opening the next step…',
      },
      narrowedHeading: 'Processing has changed',
      narrowedBody:
        'Since this form was opened, automatic reading was switched off. Your document will not be read automatically; after upload, you will enter its details yourself.',
      narrowedContinue: 'Continue with upload',
      narrowedCancel: 'Cancel and edit details',
      lockedNote:
        'Your details, file and choices are locked to what you just accepted. To change anything, choose “Cancel and edit details”; you will then accept again.',
      pinnedLanguage: 'This is the agreement you accepted, so it stays shown in its own language until the submission is completed or cancelled.',
      notices: {
        offer_expired:
          'The terms you were shown have expired, so we’ve loaded the current terms. Please read them and tick the box again to accept. Your details and file are kept.',
        agreement_changed:
          'The agreement has changed since you opened this form. Please read the current version and tick the box again to accept. Your details and file are kept.',
        processing_broadened:
          'How submissions are processed has changed since you opened this form. Please read the updated explanation and tick the box again to accept. Your details and file are kept.',
        offer_invalid:
          'We couldn’t verify the terms you were shown, so we’ve loaded them again. Please tick the box again to accept. Your details and file are kept.',
        language: 'The agreement is now shown in the language you chose. Please read it and tick the box again to accept.',
        locked: 'That change wasn’t applied: the form is locked to what you accepted. Choose “Cancel and edit details” first.',
      },
      errors: {
        uploadLinkExpired:
          'The upload link expired before your file finished uploading. Your details are kept. Press “Accept and submit” to try again with a new link.',
        uploadFailed: 'Your file didn’t upload. Please check your connection and press “Accept and submit” to try again. Your details are kept.',
        submissionExpired:
          'This submission expired before it was completed. Your details are kept. Press “Accept and submit” to start it again.',
        unavailable: 'Submissions are temporarily unavailable. Nothing was submitted. Please try again later.',
        rateLimited: 'There have been too many attempts from your connection. Please wait a while and try again.',
        network: 'We couldn’t reach the server. Please check your connection and try again. Your details are kept.',
        objectMismatch: 'The uploaded file didn’t match the file you chose. Please choose the file again and submit.',
        objectType: 'The uploaded file isn’t a readable PDF or DOCX document. Please choose another file.',
        invalid: 'Some details weren’t accepted. Please check the form and try again.',
        internal: 'Something went wrong on our side. Please try again in a moment.',
        recoveryIncomplete: 'The file from your earlier attempt never reached us, so that submission can’t be completed. Please submit again.',
      },
      recoveryHeading: 'Finish your earlier submission',
      recoveryBody: 'Your file was uploaded, but the submission wasn’t completed. You can complete it now.',
      recoveryAction: 'Complete submission',
      recoveryDiscard: 'Start a new one instead',
      outstanding: {
        role: 'your role',
        authors: 'the authors’ names',
        accept: 'your acceptance of the agreement',
      },
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
        closing: `Thank you for contributing your work to the ${OFFICIAL_NAME.en}.`,
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
      // Before the page knows the submission's state: it must not claim
      // to be reading a document that may never be read (manual choice).
      openingHeading: 'Opening your submission',
      // Suggestions made from a minimized excerpt (Google's unpaid terms).
      excerptNote:
        'These suggestions come from a short excerpt of your document with names and contact details removed. Add the authors and the supervisor yourself, and check every detail.',
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
      linkedinAdd: 'Add a LinkedIn profile (optional)',
      linkedinWhy: 'Optional. It stays private unless its owner chooses to show it.',
      linkedin: 'LinkedIn profile address (optional)',
      linkedinInvalid: 'Please enter a LinkedIn profile address, for example https://www.linkedin.com/in/your-name',
      linkedinPublic: 'Show my LinkedIn profile on this research’s public record, if it is published',
      linkedinOthers: 'Only you can choose to show your own profile. Other people’s links stay private.',
      receipt: {
        heading: 'Your research has been received',
        body:
          'It is private and has not been published. Next, check its details below and confirm them. It will then be reviewed; anything made public later follows the publication permission you chose, and only after approval.',
      },
      privateLink:
        'This page’s address is your private link to these details. Keep it to yourself: it is not a public page for your research.',
      confirm: 'Confirm these details',
      confirmExtracting: 'Reading your research…',
      confirmSaving: 'Saving…',
      timeout: 'This is taking longer than usual.',
      timeoutRetry: 'Try again',
      timeoutRestarting: 'Restarting…',
      // Hand entry: shown when the details are typed by the researcher,
      // either because this site is set up that way (no mention of
      // automatic reading at all) or because reading did not work.
      manual: {
        heading: 'Add your research details',
        subtitle:
          'Please enter the details of your research below, then confirm them. Only the title and the research team are required.',
        fallbackNote:
          'We couldn’t fill these in from your document this time, so please enter them yourself. What you enter here is what will be saved.',
        // The researcher chose manual entry before submitting.
        chosenNote: 'You chose to enter these details yourself, so your document was not sent for automatic reading.',
        // No safe excerpt could be prepared (lib/extraction/excerpt.js).
        protectedNote:
          'To protect personal information, only a short excerpt of a document, with names and contact details removed, can be sent for automatic reading. We could not prepare one from this file (for example, a scanned PDF without readable text), so nothing was sent. Please enter the details yourself.',
        emptyHint: 'Tap to add.',
        enterYourself: 'Enter the details yourself',
        switching: 'One moment…',
        orEnter: 'Or, if you prefer, you can enter your research details yourself now.',
        unavailable: 'We can’t read your document automatically right now. You can enter the details yourself instead.',
      },
      errors: {
        emptyResearcher: 'Please fill in every researcher’s name, or remove the empty row.',
        missingTitle: 'Please add the title of your research, in English or Arabic, before confirming.',
        linkedin: 'Please correct the LinkedIn address, or clear it, before confirming.',
        invalidYear: 'Please enter the year as four digits, for example 2023.',
        save: (code) =>
          `We couldn’t save your confirmation. Please try again in a moment.${code ? ` (reference: ${code})` : ''}`,
        network:
          'We couldn’t reach the server to save your confirmation. Please check your connection and try again — nothing has been lost.',
        manualChoice:
          'We couldn’t switch to entering the details yourself just now. Please try again in a moment.',
      },
      rpcError: (message) => message,
    },
  },
  ar: {
    admin: ADMIN_MESSAGES.ar,
    research: PUBLIC_MESSAGES.ar,
    meta: {
      title: OFFICIAL_NAME.ar,
      description: 'تقديم البحوث الأكاديمية السودانية للمراجعة والنشر مستقبلاً.',
    },
    shell: {
      skipLink: 'انتقل إلى المحتوى الرئيسي',
      wordmark: OFFICIAL_NAME.ar,
      navSubmit: 'تقديم بحث',
      footerLead: 'هل لديك سؤال حول تقديم بحث؟ تواصل مع فريق المنصة.',
      emailLabel: 'البريد الإلكتروني:',
      whatsappLabel: 'واتساب:',
      switchTo: 'en',
      switchLabel: 'English',
      switchAriaLabel: 'View site in English',
    },
    landing: {
      title: OFFICIAL_NAME.ar,
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
      chooseFile: 'اختر ملف البحث',
      required: 'مطلوب',
      noFileSelected: 'لم يتم اختيار ملف',
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
      opening: 'تم الرفع. جارٍ فتح الخطوة التالية…',
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
    acceptance: {
      loading: 'جارٍ تحميل شروط التقديم…',
      unavailableHeading: 'التقديم غير متاح مؤقتاً',
      unavailableBody:
        'لا يمكن قبول طلبات تقديم جديدة الآن، ولم يُرسل أي شيء. يرجى المحاولة لاحقاً، أو التواصل معنا عبر البيانات أدناه.',
      retry: 'حاول مرة أخرى',
      roleLegend: 'صفتك',
      roles: {
        author: { label: 'أنا مؤلف البحث', hint: 'كتبت هذا العمل، أو أنت مؤلفه الوحيد أو الأول.' },
        coauthor: { label: 'أنا أحد مؤلفي البحث', hint: 'أنت واحد من عدة مؤلفين لهذا العمل.' },
        authorized_depositor: {
          label: 'أقدّم البحث نيابةً عن مؤلفيه',
          hint: 'مثل أمين مكتبة أو متطوع بإذن من المؤلفين. لن تُدرج مؤلفاً للبحث.',
        },
      },
      authorsLegend: 'مؤلفو هذا العمل',
      authorsHint: 'أدخل اسم كل مؤلف كما يظهر في العمل، وبالترتيب نفسه. يمكن تصحيح القائمة لاحقاً.',
      authorName: (n) => `اسم المؤلف ${n}`,
      addAuthor: '+ إضافة مؤلف',
      removeAuthor: (n) => `إزالة المؤلف ${n}`,
      settingLegend: 'إذن النشر',
      settingIntro:
        'اختر ما يجوز نشره للعامة إذا وافقت المنصة على طلبك. لا يُنشر شيء قبل المراجعة، ولا تُطبَّق أي رخصة مفتوحة (المشاع الإبداعي).',
      settings: {
        record_abstract: {
          label: 'بيانات البحث والملخص فقط',
          hint: 'يجوز نشر العنوان المعتمد وأسماء المؤلفين والبيانات الببليوغرافية والملخص والاستشهاد. يبقى المستند الكامل خاصاً.',
        },
        record_abstract_fulltext: {
          label: 'بيانات البحث والملخص والنص الكامل',
          hint: 'ما سبق، إضافةً إلى المستند المعتمد الذي يمكن للقراء قراءته عبر الإنترنت وتنزيله للدراسة والبحث الشخصي.',
        },
      },
      processingLegend: 'كيف ستتم معالجة مستندك',
      processing: {
        automaticBy: {
          gemini_api_unpaid: (
            <>
              افتراضياً، يقرأ خادمنا ملفك بنفسه ولا يرسل إلى خدمة الذكاء الاصطناعي <Ltr>Gemini</Ltr> التابعة لشركة <Ltr>Google</Ltr>
              (الفئة المجانية) إلا مقتطفاً قصيراً، هو أسطر من صفحة الغلاف والعنوان المرجّح والملخص، بعد حذف الأسماء وبيانات الاتصال.
              وقد تستخدمه <Ltr>Google</Ltr> لتحسين منتجاتها، وقد يراجعه موظفون لديها. والحذف آلي وقد يفوته شيء، فاختر الإدخال اليدوي إذا
              تضمّن عنوانك أو ملخصك معلومات شخصية أو سرية. وقد تكون الاقتراحات خاطئة: تضيف أنت المؤلفين والمشرف وتراجع كل تفصيل.
            </>
          ),
          gemini_api_paid: (
            <>
              افتراضياً، تُرسل الصفحات الأولى من مستندك (أو نص من ملف Word) إلى خدمة الذكاء الاصطناعي <Ltr>Gemini</Ltr> التابعة
              لشركة <Ltr>Google</Ltr> لاقتراح عنوانه ومؤلفيه وتفاصيل أخرى. لا تستخدمها <Ltr>Google</Ltr> لتحسين منتجاتها، لكنها
              تحتفظ بها مدة أقصاها 55 يوماً للتحقق من إساءة الاستخدام. قد تكون الاقتراحات خاطئة: تراجع كل تفصيل وتصححه قبل التأكيد.
            </>
          ),
        },
        manual: 'لن تتم قراءة مستندك آلياً. بعد الرفع، ستُدخل تفاصيله بنفسك.',
      },
      processingChoices: {
        automatic: {
          label: <>اقرأ مستندي باستخدام <Ltr>Gemini</Ltr> (موصى به)</>,
          hint: 'تُعبّأ التفاصيل لتراجعها وتصححها.',
        },
        manual: {
          label: 'أدخل التفاصيل يدوياً',
          hint: <>لا يُرسل أي شيء من مستندك إلى <Ltr>Gemini</Ltr>. تكتب تفاصيله بنفسك بعد الرفع.</>,
        },
      },
      termsLegend: 'الاتفاقية',
      summary:
        'يبقى طلبك خاصاً حتى تتم مراجعته. يتبع النشر الخيار الذي تحدده. ويمكن قراءة النص الكامل المعتمد للعامة وتنزيله.',
      readTerms: 'اقرأ نص الاتفاقية كاملاً',
      // The registry's labels are English; the date is isolated LTR.
      version: (label, date) =>
        `${{ 'Initial Version': 'الإصدار الأول', 'Version 2': 'الإصدار الثاني', 'Version 3': 'الإصدار الثالث' }[label] || label}، \u2066${date}\u2069`,
      termsRegion: 'النص الكامل للاتفاقية',
      otherLanguage: 'الاتفاقية غير متاحة بلغتك، لذلك تُعرض باللغة أدناه.',
      submit: 'أوافق وأقدّم البحث',
      working: {
        intent: 'جارٍ تسجيل موافقتك…',
        upload: 'جارٍ رفع ملفك…',
        finalize: 'جارٍ إكمال التقديم…',
        opening: 'تم الرفع. جارٍ فتح الخطوة التالية…',
      },
      narrowedHeading: 'تغيّرت طريقة المعالجة',
      narrowedBody:
        'منذ فتح هذا النموذج، أُوقفت القراءة الآلية. لن تتم قراءة مستندك آلياً، وبعد الرفع ستُدخل تفاصيله بنفسك.',
      narrowedContinue: 'متابعة الرفع',
      narrowedCancel: 'إلغاء وتعديل البيانات',
      lockedNote:
        'بياناتك وملفك وخياراتك مثبتة على ما وافقت عليه للتو. لتغيير أي شيء، اختر «إلغاء وتعديل البيانات»، ثم وافق مرة أخرى.',
      pinnedLanguage: 'هذه هي الاتفاقية التي وافقت عليها، لذلك تبقى معروضة بلغتها حتى يكتمل الطلب أو يُلغى.',
      notices: {
        offer_expired:
          'انتهت صلاحية الشروط التي عُرضت عليك، لذا حمّلنا الشروط الحالية. يرجى قراءتها ثم تحديد المربع مرة أخرى للموافقة. تم الاحتفاظ ببياناتك وملفك.',
        agreement_changed:
          'تغيّرت الاتفاقية منذ فتح هذا النموذج. يرجى قراءة النسخة الحالية ثم تحديد المربع مرة أخرى للموافقة. تم الاحتفاظ ببياناتك وملفك.',
        processing_broadened:
          'تغيّرت طريقة معالجة الطلبات منذ فتح هذا النموذج. يرجى قراءة الشرح المحدّث ثم تحديد المربع مرة أخرى للموافقة. تم الاحتفاظ ببياناتك وملفك.',
        offer_invalid:
          'تعذر التحقق من الشروط التي عُرضت عليك، لذا حمّلناها مرة أخرى. يرجى تحديد المربع مرة أخرى للموافقة. تم الاحتفاظ ببياناتك وملفك.',
        language: 'تُعرض الاتفاقية الآن باللغة التي اخترتها. يرجى قراءتها ثم تحديد المربع مرة أخرى للموافقة.',
        locked: 'لم يُطبَّق هذا التغيير: النموذج مثبت على ما وافقت عليه. اختر «إلغاء وتعديل البيانات» أولاً.',
      },
      errors: {
        uploadLinkExpired:
          'انتهت صلاحية رابط الرفع قبل اكتمال رفع ملفك. تم الاحتفاظ ببياناتك. اضغط «أوافق وأقدّم البحث» للمحاولة مرة أخرى برابط جديد.',
        uploadFailed: 'لم يُرفع ملفك. يرجى التحقق من اتصالك ثم الضغط على «أوافق وأقدّم البحث» للمحاولة مرة أخرى. تم الاحتفاظ ببياناتك.',
        submissionExpired:
          'انتهت صلاحية هذا الطلب قبل إكماله. تم الاحتفاظ ببياناتك. اضغط «أوافق وأقدّم البحث» لبدئه من جديد.',
        unavailable: 'التقديم غير متاح مؤقتاً. لم يُرسل أي شيء. يرجى المحاولة لاحقاً.',
        rateLimited: 'تجاوزت المحاولات من اتصالك الحد المسموح. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
        network: 'تعذر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى. تم الاحتفاظ ببياناتك.',
        objectMismatch: 'الملف المرفوع لا يطابق الملف الذي اخترته. يرجى اختيار الملف مرة أخرى ثم التقديم.',
        objectType: 'الملف المرفوع ليس مستند PDF أو DOCX قابلاً للقراءة. يرجى اختيار ملف آخر.',
        invalid: 'لم تُقبل بعض البيانات. يرجى مراجعة النموذج والمحاولة مرة أخرى.',
        internal: 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى بعد قليل.',
        recoveryIncomplete: 'لم يصلنا ملف محاولتك السابقة، لذلك لا يمكن إكمال ذلك الطلب. يرجى التقديم مرة أخرى.',
      },
      recoveryHeading: 'أكمل طلبك السابق',
      recoveryBody: 'تم رفع ملفك، لكن الطلب لم يكتمل. يمكنك إكماله الآن.',
      recoveryAction: 'إكمال التقديم',
      recoveryDiscard: 'بدء طلب جديد بدلاً من ذلك',
      outstanding: {
        role: 'صفتك',
        authors: 'أسماء المؤلفين',
        accept: 'موافقتك على الاتفاقية',
      },
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
        closing: `شكراً لمساهمتك ببحثك في ${OFFICIAL_NAME.ar}.`,
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
      openingHeading: 'جارٍ فتح طلبك',
      excerptNote:
        'هذه الاقتراحات مأخوذة من مقتطف قصير من مستندك بعد حذف الأسماء وبيانات الاتصال. أضف المؤلفين والمشرف بنفسك، وراجع كل تفصيل.',
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
      linkedinAdd: (
        <>
          إضافة ملف شخصي على <Ltr>LinkedIn</Ltr> (اختياري)
        </>
      ),
      linkedinWhy: 'اختياري. يبقى خاصاً ما لم يختر صاحبه إظهاره.',
      linkedin: 'عنوان الملف الشخصي على LinkedIn (اختياري)',
      linkedinInvalid: 'يرجى إدخال عنوان ملف شخصي على LinkedIn، مثل \u2066https://www.linkedin.com/in/your-name\u2069',
      linkedinPublic: 'أظهر ملفي الشخصي على LinkedIn في السجل العام لهذا البحث، إذا نُشر',
      linkedinOthers: 'يمكنك اختيار إظهار ملفك الشخصي فقط. تبقى روابط الآخرين خاصة.',
      receipt: {
        heading: 'تم استلام بحثك',
        body:
          'بحثك خاص ولم يُنشر. الخطوة التالية: راجع تفاصيله أدناه ثم أكّدها. بعد ذلك تتم مراجعته، ولا يُنشر لاحقاً إلا ما يسمح به إذن النشر الذي اخترته، وبعد الموافقة فقط.',
      },
      privateLink: 'عنوان هذه الصفحة هو رابطك الخاص لهذه التفاصيل. احتفظ به لنفسك، فهو ليس صفحة عامة لبحثك.',
      confirm: 'تأكيد هذه التفاصيل',
      confirmExtracting: 'جارٍ قراءة بحثك…',
      confirmSaving: 'جارٍ الحفظ…',
      timeout: 'يستغرق هذا وقتاً أطول من المعتاد.',
      timeoutRetry: 'حاول مرة أخرى',
      timeoutRestarting: 'جارٍ إعادة المحاولة…',
      manual: {
        heading: 'أضف تفاصيل بحثك',
        subtitle: 'يرجى إدخال تفاصيل بحثك أدناه ثم تأكيدها. العنوان وفريق البحث فقط مطلوبان.',
        fallbackNote:
          'لم نتمكن هذه المرة من تعبئة هذه التفاصيل من مستندك، لذا يرجى إدخالها بنفسك. ما تُدخله هنا هو ما سيُحفظ.',
        chosenNote: 'اخترت إدخال هذه التفاصيل بنفسك، لذا لم يُرسل مستندك للقراءة الآلية.',
        protectedNote:
          'حمايةً للمعلومات الشخصية، لا يمكن أن يُرسل للقراءة الآلية إلا مقتطف قصير من المستند بعد حذف الأسماء وبيانات الاتصال. ولم نتمكن من إعداده من هذا الملف (مثل ملف PDF ممسوح ضوئياً بلا نص قابل للقراءة)، لذا لم يُرسل أي شيء. يُرجى إدخال التفاصيل بنفسك.',
        emptyHint: 'اضغط للإضافة.',
        enterYourself: 'أدخل التفاصيل بنفسك',
        switching: 'لحظة من فضلك…',
        orEnter: 'أو يمكنك، إن أردت، إدخال تفاصيل بحثك بنفسك الآن.',
        unavailable: 'لا يمكننا قراءة مستندك تلقائياً في الوقت الحالي. يمكنك إدخال التفاصيل بنفسك بدلاً من ذلك.',
      },
      errors: {
        emptyResearcher: 'يرجى إدخال اسم لكل باحث أو إزالة الصف الفارغ.',
        missingTitle: 'يرجى إضافة عنوان بحثك بالإنجليزية أو العربية قبل التأكيد.',
        linkedin: 'يرجى تصحيح عنوان LinkedIn أو حذفه قبل التأكيد.',
        invalidYear: 'يرجى إدخال السنة بأربعة أرقام، مثلاً 2023.',
        // The reference code is isolated LTR (LRI…PDI) so a code such as
        // PGRST301 is never reordered inside the Arabic sentence.
        save: (code) =>
          `تعذر علينا حفظ تأكيدك. يرجى المحاولة مرة أخرى بعد قليل.${code ? ` (المرجع: ⁦${code}⁩)` : ''}`,
        network:
          'تعذر علينا الوصول إلى الخادم لحفظ تأكيدك. يرجى التحقق من اتصالك والمحاولة مرة أخرى — لم يتم فقدان أي من تعديلاتك.',
        manualChoice: 'تعذر علينا الآن الانتقال إلى إدخال التفاصيل بنفسك. يرجى المحاولة مرة أخرى بعد قليل.',
      },
      rpcError: (message) => AR_CONFIRM_ERRORS[message] || 'تعذر علينا حفظ تأكيدك. يرجى المحاولة مرة أخرى بعد قليل.',
    },
  },
}

export function messagesFor(locale) {
  return MESSAGES[normalizeLocale(locale)]
}
