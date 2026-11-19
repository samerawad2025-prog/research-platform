-- Version 5 bundles reader/article permission into the submission agreement.
-- Prospective only. Seed inactive; activate only after compatible code is live.
begin;
insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active, external_ai_processing)
values
  ('submission-terms-2026-11-18-v5-en', 'submission-terms', 'en', 'Version 5', '2026-11-18',
   '627189ac3f271af57f08002a8b45b4c7b700729c8c2fd7e40f031faae2d74959', false, 'gemini_api_unpaid'),
  ('submission-terms-2026-11-18-v5-ar', 'submission-terms', 'ar', 'Version 5', '2026-11-18',
   '7c106bc2e3b8bbd81577a6b6b5765edb316afcce449eb145603cb9951e961f29', false, 'gemini_api_unpaid');

-- The exact complete accepted terms are the permission evidence.
insert into knowledge_notices(version,text_en,text_ar) values
('submission-v5-2026-11-18', $v5$# Sudanese Academic Research Platform

## Submission and Deposit Agreement and Privacy Notice

**Version:** Version 5  
**Date:** 18 NOV 2026  
**Operator:** Samer Habiballa Awad Abdelrahim  
**Location:** Khartoum, Sudan  
**Contact:** sarpcontact2026@gmail.com

### 1. About this agreement

These terms apply when you submit research to the Sudanese Academic Research Platform, referred to below as the Platform or we. They take effect for your submission when you accept them. Participation is free for researchers and universities.

The Platform is an independent research repository. Naming a university or other institution does not imply its endorsement or a formal partnership. Submission is open to researchers from different institutions and independent researchers. Public collections are introduced in stages, beginning with the University of Khartoum.

### 2. Your authority and responsibilities

You must have legal capacity to enter this agreement and identify yourself accurately as an author, coauthor or authorized depositor. You confirm that you have the permissions needed to submit this version and authorize the selected uses, including any required permission from coauthors, institutions, funders, publishers and other rights holders.

Provide accurate information, acknowledge sources, and disclose any embargo or restriction. Do not submit confidential material, identifiable research-participant information, signatures, identity documents or unnecessary private contact details. Provide a redacted version where needed. Approval to conduct a study does not itself authorize public disclosure of participant information.

We may request evidence of your authority or a further authorization document where required by law or the circumstances of the work.

### 3. Copyright and permission to operate the repository

Copyright remains with its owners. You grant us a non-exclusive, royalty-free permission to store and preserve the submitted version, extract and organize its bibliographic information, check for duplicate deposits, and make necessary technical or accessibility conversions without changing its scholarly substance.

You also authorize publication within the setting you select, with attribution, after approval. These permissions apply worldwide as needed for internet publication and the service providers described below. They last while we provide the authorized repository services, subject to the withdrawal and retention provisions of this agreement. No royalty is payable, and no waiver of rights that cannot lawfully be waived is required.

### 4. What may be published

Your submission remains private pending review. Choose one publication setting:

* **Record and abstract only:** the approved title, author names, affiliations, bibliographic details, author-written abstract and citation may be public. The full document remains private.
* **Record, abstract and full text:** the same information and the approved document may be public, with online reading and downloads for personal study and research.

Publication requires administrative approval, appropriate permissions and eligibility for the current public collection. We may request corrections, delay or decline publication, or restrict access where rights, privacy, record quality or service operation require it. A new institution becoming eligible does not automatically publish its submissions.

The AI reader and reviewed articles described in section 6A are included in this agreement. Other new uses and replacement documents require the appropriate recorded authorization.

### 5. Reading, downloading and academic use

Readers must acknowledge authorship and comply with the rights statement for each work. Public access does not transfer copyright or automatically grant an open licence. Further copying, adaptation or redistribution requires permission unless applicable law or an existing licence permits it.

Publicly displayed documents can be saved or copied. We cannot guarantee prevention of copying or recall copies obtained by others. Do not select full-text publication where that exposure conflicts with the work's restrictions.

Claiming another person's work as your own, impersonation, unauthorized access to private material and abusive automated access are prohibited. Repository inclusion is not peer review, institutional accreditation or certification of originality.

### 6. Automated reading with Google Gemini (free tier)

**The default.** After upload, the Platform sends part of your document to Google's Gemini API, an external AI service, to suggest its title, authors, supervisor, institution, faculty, degree, year and abstract. Before you submit, you can choose to enter these details manually instead. If you do, your document is not sent to Gemini. If automated reading does not work, you can also switch to manual entry without uploading again.

**What is sent and why.** For a PDF, we send the first pages of the document as a file: up to the first 10 pages, and up to the first 25 pages if a second reading is needed to find missing details. A scanned PDF is sent the same way. For a Word document, we send text taken from it: up to its first 6,000 characters, including page headers, and if needed up to 12,000 characters or selected passages that appear to contain the missing details. Our instructions describing what to look for are sent with this material. It contains whatever appears in those pages or passages, including the names of authors and supervisors, affiliations, and any other personal information printed there, such as names in acknowledgements, signatures or contact details. Nothing is removed before it is sent. The contact details you enter in the submission form are not sent to Gemini. We send this material only to suggest bibliographic details.

**Google's terms that apply.** The Platform uses the Gemini API under its unpaid-service terms. Google may use submitted content and generated responses to improve its products and machine-learning technologies, and human reviewers may examine them. Content may be processed outside Sudan. We do not control Google's retention or processing, and deleting a submission here does not delete Google's copies. See the Gemini API Additional Terms of Service at https://ai.google.dev/gemini-api/terms and Google's Privacy Policy at https://policies.google.com/privacy.

**Personal information and your choice.** Google's terms for unpaid services ask that sensitive, confidential or personal information not be submitted. The pages sent will usually include names and may include other personal information. Your acceptance does not change Google's terms, and it does not give consent on behalf of coauthors, supervisors or anyone else named in the document. If you do not want your document, or the information about other people in it, sent to Google on these terms, choose "Enter details manually": nothing from your document is then sent to Gemini. Before uploading, remove information that is not needed to describe the work, such as signatures, identity numbers or private contact details.

**Check every suggestion.** Suggested details can be wrong, incomplete or attributed to the wrong person. Check and correct every detail before you confirm. What you confirm is what we record. Publication decisions remain with authorized reviewers.

**Our record of what was read.** We keep the suggestions returned by Gemini with your submission's processing record. It is not shown on any public page; only the Platform's server, you through your private link, and the operator through the database can read it. It is kept for as long as your submission's records are kept and is deleted with them (section 8).

**Other uses.** We do not sell private documents or personal contact information. The Platform's own automated checks may compare bibliographic details to detect duplicate deposits; these checks do not send documents outside the Platform. Google's use of material sent to Gemini is governed by Google's terms, as described above. This agreement does not authorize use of private documents in a cross-institution plagiarism service or a student-facing AI research-direction service. Such uses require a separate rights and privacy process before introduction.

### 6A. AI reader and reviewed articles

By accepting this agreement, you also authorize the Platform to send the approved public title and abstract to Google Gemini under its unpaid-service terms for source-linked explanations, answers, comparisons, Arabic or English translations and accessible articles. This use does not include private documents, submission contact details or unpublished material. It applies after the research is approved and publicly available, under either publication setting, including when you choose manual metadata entry.

Google may use inputs and outputs for product and model improvement, and human reviewers may examine them. Google's terms and input restrictions continue to apply; acceptance does not override them or give consent on behalf of other people. The Platform cannot delete content held by Google. Readers' questions are also sent to Google.

AI output may be wrong or incomplete. Articles require editorial approval, attribution and a link to the original research. These services are not peer review or professional advice. You confirm that you have authority from the relevant rights holders to authorize these uses.

You can later withdraw the reader/article permission through your private research settings or by contacting us. Withdrawal stops new AI requests and removes the related articles from public access on the Platform, without withdrawing ordinary research publication. It cannot recall copies already obtained or requests already sent. The permission record and private editorial history are retained while the submission record is retained.

### 7. Privacy

We use submission details, documents, contact information, acceptance records, correspondence and limited technical and usage information to administer submissions, provide the agreed services, protect the Platform and address requests or legal obligations.

Approved research information may be public within your selected setting. Submission contact details, private management links, unpublished files and internal review notes are not public profile fields. An optional LinkedIn link is public only if you choose to display it.

Service providers include Vercel for hosting the website and its server functions, Supabase for database and document storage, and Google, through the Gemini API, for automated reading as described in section 6 unless you choose manual entry, and for the public reader and articles described in section 6A. Messages sent to our Gmail address are handled through Google's email service. Relevant information is processed outside Sudan: our database and document storage are currently hosted in Frankfurt, Germany, and Google states that it maintains servers around the world and may process information on servers located outside the country where you live. Provider access is limited to what the service requires, subject to applicable contractual arrangements; security logs and legally required disclosures may still occur.

Authorized administrators and volunteers may access information needed for their duties. Public activity statistics are aggregated and do not identify individual readers. A view, download or citation export does not establish that the work was read or cited. Optional alerts and promotional messages require a separate choice where applicable.

### 8. Retention, correction and withdrawal

Research records are retained while they serve the authorized repository purpose. Other personal information is retained only as needed to administer the submission, resolve requests, protect the service or meet legal obligations. Unneeded temporary files and operational records are deleted or anonymized. Retention is reviewed when a submission is abandoned, rejected, withdrawn or otherwise no longer needed.

Contact sarpcontact2026@gmail.com to request access, correction, restriction, withdrawal or deletion. We may ask for proportionate evidence of identity or authority. On an accepted withdrawal, we stop the affected public access and remove the material from our active search systems. A minimal withdrawal notice may remain where lawful and appropriate, without exposing sensitive information.

Limited acceptance, rights or complaint records may be retained where justified. Residual backup copies may remain until overwritten or deleted through the applicable backup process; they must not be used to restore withdrawn public access. We cannot remove copies held independently by others or revoke rights already granted under an irrevocable licence.

### 9. Complaints, service operation and changes

Send copyright, privacy, authorship or other complaints to sarpcontact2026@gmail.com, identifying the work, your connection to it and the concern. We may restrict access during review and seek an appropriate response from the depositor. An allegation is not treated as an established finding of misconduct.

We will exercise reasonable care, but do not guarantee uninterrupted service, indefinite preservation or error-free content. Nothing in this agreement excludes responsibility or rights that applicable law does not allow to be excluded.

Material changes will be identified by version. They do not expand permissions for earlier submissions without the necessary new authorization. Your submission record identifies the terms and publication setting you accepted.

### Acceptance

**I have read and agree to the Submission and Deposit Agreement and Privacy Notice, including Gemini processing unless I choose manual metadata entry, publication under my selected sharing setting after approval, and the AI reader and reviewed articles using the approved public title and abstract. I confirm that I have authority to grant these permissions.**
$v5$, $v5$# المنصة السودانية للبحث الأكاديمي

## اتفاقية تقديم البحوث وإيداعها وإشعار الخصوصية

**الإصدار:** الإصدار الخامس  
**التاريخ:** 18 نوفمبر 2026  
**المشغّل:** Samer Habiballa Awad Abdelrahim  
**الموقع:** الخرطوم، السودان  
**للتواصل:** sarpcontact2026@gmail.com

### 1. عن هذه الاتفاقية

تنطبق هذه الشروط عند تقديم بحث إلى المنصة السودانية للبحث الأكاديمي، ويُشار إليها أدناه بلفظ «المنصة» أو «نحن». وتسري على إيداعك عند موافقتك عليها. المشاركة مجانية للباحثين والجامعات.

المنصة مستودع بحثي مستقل. ولا يعني ذكر جامعة أو مؤسسة أخرى أنها تعتمد المنصة أو ترتبط بها بشراكة رسمية. نقبل البحوث من باحثي المؤسسات المختلفة والباحثين المستقلين. وتتاح المجموعات البحثية للجمهور على مراحل، بدءاً بجامعة الخرطوم.

### 2. صلاحيتك ومسؤولياتك

يجب أن تتوافر لديك الأهلية القانونية لإبرام هذه الاتفاقية، وأن تبيّن صفتك بدقة بوصفك مؤلفاً أو مؤلفاً مشاركاً أو مودعاً مفوّضاً. وتؤكد حصولك على الأذونات اللازمة لإيداع هذه النسخة والسماح بالاستخدامات المختارة، بما يشمل ما يلزم من أذونات المؤلفين المشاركين والمؤسسات والممولين والناشرين وغيرهم من أصحاب الحقوق.

قدّم معلومات دقيقة، وانسب المصادر إلى أصحابها، وأفصح عن أي حظر مؤقت على النشر أو قيد آخر. لا ترفع مواد سرية، أو معلومات تكشف هوية المشاركين في البحث، أو توقيعات، أو وثائق هوية، أو بيانات اتصال خاصة غير لازمة. وقدّم نسخة منقّحة عند الحاجة. الموافقة على إجراء دراسة لا تعني بذاتها السماح بنشر معلومات المشاركين فيها.

يجوز لنا طلب ما يثبت صلاحيتك، أو وثيقة تفويض إضافية، إذا تطلّب القانون أو ظروف البحث ذلك.

### 3. حقوق المؤلف والإذن بتشغيل المستودع

تبقى حقوق المؤلف لأصحابها. وتمنحنا إذناً غير حصري ودون مقابل مالي لتخزين النسخة المقدمة وحفظها، واستخراج بياناتها الببليوغرافية وتنظيمها، والتحقق من تكرار الإيداع، وإجراء التحويلات التقنية أو اللازمة لتيسير الوصول، دون تغيير المضمون العلمي.

كما تأذن لنا بالنشر ضمن الخيار الذي تحدده، مع نسبة العمل إلى أصحابه، وبعد الموافقة عليه. وتسري هذه الأذونات في أنحاء العالم بالقدر اللازم للنشر على الإنترنت والاستعانة بمقدمي الخدمات المبيّنين أدناه. وتستمر ما دمنا نقدّم خدمات المستودع المأذون بها، مع مراعاة أحكام السحب والاحتفاظ الواردة في هذه الاتفاقية. ولا تستحق إتاوة مقابل هذه الأذونات، ولا يُطلب التنازل عن أي حق لا يجوز قانوناً التنازل عنه.

### 4. المواد التي يجوز نشرها

يبقى إيداعك غير متاح للجمهور إلى حين مراجعته. اختر أحد خياري النشر:

* **السجل والملخص فقط:** يجوز نشر العنوان المعتمد وأسماء المؤلفين وجهات انتسابهم والبيانات الببليوغرافية والملخص الذي كتبه المؤلف وبيانات الاستشهاد. ويبقى المستند الكامل غير متاح للجمهور.
* **السجل والملخص والنص الكامل:** يجوز نشر المعلومات نفسها والمستند المعتمد، مع إتاحته للقراءة عبر الإنترنت والتنزيل لأغراض الدراسة والبحث الشخصي.

يتطلب النشر موافقة إدارية، وتوافر الأذونات المناسبة، وأهلية البحث للإدراج في المجموعة المتاحة للجمهور آنذاك. ويجوز لنا طلب تصحيحات، أو تأخير النشر أو رفضه، أو تقييد الوصول إذا اقتضت ذلك الحقوق أو الخصوصية أو جودة السجل أو تشغيل الخدمة. ولا يؤدي إدراج مؤسسة جديدة تلقائياً إلى نشر إيداعاتها.

تشمل هذه الاتفاقية قارئ البحث الذكي والمقالات المراجعة الموضحين في البند 6أ. أما الاستخدامات الجديدة الأخرى والمستندات البديلة فتحتاج إلى التفويض المناسب المسجل.

### 5. القراءة والتنزيل والاستخدام الأكاديمي

يلتزم القرّاء بنسبة العمل إلى مؤلفيه وببيان الحقوق الخاص بكل بحث. ولا تنقل الإتاحة العامة حقوق المؤلف، ولا تمنح تلقائياً ترخيصاً مفتوحاً. ويحتاج النسخ الإضافي أو التعديل أو إعادة التوزيع إلى إذن، ما لم يسمح القانون المنطبق أو ترخيص قائم بذلك.

يمكن حفظ المستندات المعروضة للجمهور أو نسخها. ولا نضمن منع النسخ أو استرجاع النسخ التي حصل عليها الآخرون. فلا تختر نشر النص الكامل إذا تعارضت هذه الإتاحة مع القيود المفروضة على البحث.

يُحظر ادعاء تأليف عمل شخص آخر، وانتحال الهوية، والوصول غير المصرح به إلى مواد خاصة، والاستخدام الآلي المسيء. ولا يُعد إدراج البحث في المستودع تحكيماً علمياً، أو اعتماداً مؤسسياً، أو شهادة بأصالته.

### 6. القراءة الآلية باستخدام Google Gemini (الفئة المجانية)

**الإعداد الافتراضي.** بعد رفع مستندك، ترسل المنصة جزءاً منه إلى واجهة Gemini البرمجية التابعة لشركة Google، وهي خدمة ذكاء اصطناعي خارجية، لاقتراح عنوانه ومؤلفيه والمشرف عليه والمؤسسة والكلية والدرجة العلمية والسنة والملخص. ويمكنك قبل الإرسال أن تختار إدخال هذه التفاصيل يدوياً بدلاً من ذلك، وعندئذ لا يُرسل مستندك إلى Gemini. وإذا تعذرت القراءة الآلية، يمكنك أيضاً الانتقال إلى الإدخال اليدوي دون رفع المستند مرة أخرى.

**ما يُرسل ولماذا.** في ملف PDF، نرسل الصفحات الأولى من المستند في صورة ملف: حتى أول 10 صفحات، وحتى أول 25 صفحة إذا لزمت قراءة ثانية للعثور على تفاصيل ناقصة. ويُرسل ملف PDF الممسوح ضوئياً بالطريقة نفسها. وفي مستند Word، نرسل نصاً مأخوذاً منه: حتى أول 6000 حرف بما في ذلك ترويسات الصفحات، وعند الحاجة حتى 12000 حرف أو مقاطع مختارة يبدو أنها تتضمن التفاصيل الناقصة. وتُرسل مع هذه المواد تعليماتنا التي تبيّن ما يجب البحث عنه. وتتضمن هذه المواد كل ما يرد في تلك الصفحات أو المقاطع، ومن ذلك أسماء المؤلفين والمشرفين وجهات الانتساب وأي معلومات شخصية أخرى مطبوعة فيها، مثل الأسماء الواردة في عبارات الشكر أو التوقيعات أو بيانات الاتصال. ولا يُحذف شيء منها قبل الإرسال. ولا تُرسل بيانات الاتصال التي تدخلها في نموذج الإيداع إلى Gemini. ولا نرسل هذه المواد إلا لاقتراح البيانات الببليوغرافية.

**شروط Google المنطبقة.** تستخدم المنصة واجهة Gemini البرمجية وفق شروط الخدمات غير المدفوعة. وقد تستخدم Google المحتوى المرسل والردود المولّدة لتحسين منتجاتها وتقنيات التعلم الآلي، وقد يطّلع عليها مراجعون بشريون. وقد تُعالج البيانات خارج السودان. ولا نتحكم في احتفاظ Google بالبيانات أو معالجتها، ولا يؤدي حذف الإيداع من المنصة إلى حذف النسخ لدى Google. راجع الشروط الإضافية لخدمة Gemini على https://ai.google.dev/gemini-api/terms وسياسة خصوصية Google على https://policies.google.com/privacy.

**المعلومات الشخصية وخيارك.** تطلب شروط Google للخدمات غير المدفوعة عدم إرسال معلومات حساسة أو سرية أو شخصية. والصفحات المرسلة تتضمن الأسماء عادةً، وقد تتضمن معلومات شخصية أخرى. ولا تغيّر موافقتك شروط Google، ولا تُعد موافقةً نيابةً عن المؤلفين المشاركين أو المشرفين أو أي شخص آخر يرد اسمه في المستند. وإذا كنت لا تريد إرسال مستندك، أو المعلومات المتعلقة بأشخاص آخرين فيه، إلى Google بموجب هذه الشروط، فاختر "أدخل التفاصيل يدوياً"، وعندئذ لا يُرسل أي شيء من مستندك إلى Gemini. واحذف قبل الرفع المعلومات التي لا يلزم ذكرها لوصف البحث، مثل التوقيعات أو أرقام الهوية أو بيانات الاتصال الخاصة.

**راجع كل اقتراح.** قد تكون التفاصيل المقترحة خاطئة أو ناقصة أو منسوبة إلى غير صاحبها. فراجع كل تفصيل وصحّحه قبل التأكيد. وما تؤكده هو ما نسجله. وتبقى قرارات النشر بيد المراجعين المفوّضين.

**سجلّنا لما قُرئ.** نحتفظ بالاقتراحات التي أعادتها Gemini ضمن سجل معالجة إيداعك. ولا تُعرض في أي صفحة عامة؛ ولا يطّلع عليها إلا خادم المنصة، وأنت عبر رابطك الخاص، والمشغّل عبر قاعدة البيانات. ويُحتفظ بها ما دامت سجلات إيداعك محفوظة، وتُحذف معها (البند 8).

**استخدامات أخرى.** لا نبيع المستندات الخاصة أو بيانات الاتصال الشخصية. وقد تقارن الفحوص الآلية الخاصة بالمنصة البياناتِ الببليوغرافية لكشف تكرار الإيداع، ولا تُرسل هذه الفحوص المستندات إلى خارج المنصة. ويخضع استخدام Google للمواد المرسلة إلى Gemini لشروط Google على النحو المبيّن أعلاه. ولا تجيز هذه الاتفاقية استخدام المستندات الخاصة في خدمة لكشف الانتحال بين المؤسسات، أو في خدمة توجّه الطلاب إلى مسارات بحثية بالذكاء الاصطناعي. وتتطلب هذه الاستخدامات إجراءات مستقلة تتعلق بالحقوق والخصوصية قبل طرحها.

### 6أ. قارئ البحث الذكي والمقالات المراجعة

بقبول هذه الاتفاقية، تسمح أيضاً للمنصة بإرسال عنوان البحث وملخصه المعتمدين للنشر العام إلى Google Gemini وفق شروط الخدمات غير المدفوعة، لإنتاج شروح وإجابات ومقارنات مرتبطة بمصادرها وترجمات عربية أو إنجليزية ومقالات مبسطة. لا يشمل هذا الاستخدام المستندات الخاصة أو بيانات التواصل المقدمة في النموذج أو المواد غير المنشورة. ويسري بعد اعتماد البحث وإتاحته للجمهور، في كلا خياري النشر، بما في ذلك عند اختيار إدخال البيانات يدوياً.

قد تستخدم Google المدخلات والمخرجات لتحسين منتجاتها ونماذجها، وقد يطّلع عليها مراجعون بشريون. تظل شروط Google وقيودها على المدخلات سارية؛ ولا تتجاوزها الموافقة ولا تُعد موافقة نيابةً عن الآخرين. ولا تستطيع المنصة حذف المحتوى الذي تحتفظ به Google. وتُرسل أسئلة القراء أيضاً إلى Google.

قد تكون مخرجات الذكاء الاصطناعي خاطئة أو ناقصة. وتتطلب المقالات مراجعة تحريرية واعتماداً، مع نسبة البحث إلى مؤلفيه وربطه بالبحث الأصلي. ولا تمثل هذه الخدمات تحكيماً علمياً أو مشورة مهنية. وتؤكد أن لديك التفويض اللازم من أصحاب الحقوق للسماح بهذه الاستخدامات.

يمكنك لاحقاً سحب إذن القارئ والمقالات من إعدادات بحثك الخاصة أو بالتواصل معنا. ويوقف السحب الطلبات الجديدة للذكاء الاصطناعي ويحجب المقالات المرتبطة بالبحث من العرض العام على المنصة، دون سحب النشر المعتاد للبحث. ولا يسترجع النسخ التي حصل عليها الآخرون أو الطلبات التي أُرسلت بالفعل. ويُحتفظ بسجل الإذن والتاريخ التحريري الخاص ما دام سجل الإيداع محفوظاً.

### 7. الخصوصية

نستخدم بيانات الإيداع والمستندات ومعلومات الاتصال وسجلات الموافقة والمراسلات ومعلومات تقنية ومعلومات استخدام محدودة، لإدارة الإيداعات وتقديم الخدمات المتفق عليها وحماية المنصة ومعالجة الطلبات أو الوفاء بالالتزامات القانونية.

يجوز إتاحة المعلومات البحثية المعتمدة للجمهور ضمن الخيار الذي حددته. أما بيانات الاتصال الخاصة بالإيداع، وروابط الإدارة الخاصة، والملفات غير المنشورة، وملاحظات المراجعة الداخلية، فلا تظهر ضمن بيانات الملف العام. ولا يُعرض رابط LinkedIn الاختياري إلا إذا اخترت إظهاره.

يشمل مقدمو الخدمات Vercel لاستضافة الموقع ووظائفه على الخادم، وSupabase لقاعدة البيانات وتخزين المستندات، وGoogle عبر واجهة Gemini البرمجية للقراءة الآلية على النحو المبيّن في البند 6 ما لم تختر الإدخال اليدوي، ولقارئ البحث والمقالات على النحو المبيّن في البند 6أ. وتعالج خدمة البريد الإلكتروني من Google الرسائل المرسلة إلى عنواننا على Gmail. وتجري معالجة المعلومات ذات الصلة خارج السودان: فقاعدة البيانات وتخزين المستندات مستضافان حالياً في فرانكفورت بألمانيا، وتذكر Google أنها تملك خوادم في أنحاء العالم وأنها قد تعالج المعلومات على خوادم تقع خارج البلد الذي تقيم فيه. ويقتصر وصول مقدم الخدمة على ما تتطلبه الخدمة، وفق الترتيبات التعاقدية المنطبقة، مع إمكان الاحتفاظ بسجلات أمنية أو الإفصاح عما يوجبه القانون.

يجوز للمسؤولين والمتطوعين المفوّضين الاطلاع على المعلومات اللازمة لأداء مهامهم. وتُعرض إحصاءات النشاط العامة بصورة مجمّعة دون الكشف عن هوية القرّاء. ولا تثبت المشاهدة أو عملية التنزيل أو تصدير بيانات الاستشهاد أن البحث قد قُرئ أو استُشهد به. وتتطلب التنبيهات الاختيارية والرسائل الترويجية اختياراً مستقلاً حيثما يلزم.

### 8. الاحتفاظ والتصحيح والسحب

نحتفظ بالسجلات البحثية ما دامت تخدم الغرض المأذون به للمستودع. ونحتفظ بالمعلومات الشخصية الأخرى بالقدر اللازم لإدارة الإيداع أو معالجة الطلبات أو حماية الخدمة أو الوفاء بالالتزامات القانونية. وتُحذف الملفات المؤقتة والسجلات التشغيلية غير اللازمة، أو تُزال منها البيانات المعرِّفة بالهوية. وتُراجع الحاجة إلى الاحتفاظ عند ترك الإيداع دون استكمال، أو رفضه، أو سحبه، أو انتفاء الحاجة إليه لسبب آخر.

لطلب الاطلاع على بياناتك أو تصحيحها أو تقييدها أو سحبها أو حذفها، تواصل عبر sarpcontact2026@gmail.com. وقد نطلب إثباتاً متناسباً للهوية أو الصلاحية. وعند قبول طلب السحب، نوقف الإتاحة العامة المعنية ونزيل المادة من أنظمة البحث النشطة لدينا. وقد يبقى إشعار موجز بالسحب إذا كان ذلك مشروعاً ومناسباً، دون كشف معلومات حساسة.

يجوز الاحتفاظ بسجلات محدودة للموافقة أو الحقوق أو الشكاوى عند وجود مبرر لذلك. وقد تبقى نسخ احتياطية متبقية إلى أن تُستبدل أو تُحذف وفق آلية النسخ الاحتياطي المعمول بها، ولا يجوز استخدامها لإعادة إتاحة مادة سُحبت من العرض العام. ولا نستطيع إزالة النسخ التي يحتفظ بها الآخرون بصورة مستقلة، أو إلغاء حقوق سبق منحها بموجب ترخيص غير قابل للإلغاء.

### 9. الشكاوى وتشغيل الخدمة والتعديلات

تُرسل الشكاوى المتعلقة بحقوق المؤلف أو الخصوصية أو التأليف أو غيرها إلى sarpcontact2026@gmail.com، مع تحديد البحث وصلتك به وموضوع الشكوى. وقد نقيّد الوصول أثناء المراجعة ونطلب رداً مناسباً من المودع. ولا يُعامل الادعاء بوصفه نتيجة ثابتة بوقوع مخالفة.

نبذل العناية المعقولة في تشغيل الخدمة، دون ضمان استمرارها بلا انقطاع، أو الحفظ إلى أجل غير محدد، أو خلو المحتوى من الأخطاء. ولا يستبعد أي حكم في هذه الاتفاقية مسؤولية أو حقاً لا يسمح القانون المنطبق باستبعاده.

تُبيّن التعديلات الجوهرية بإصدار محدد. ولا توسّع الأذونات المتعلقة بإيداعات سابقة دون الحصول على التفويض الجديد اللازم. ويبيّن سجل إيداعك الشروط وخيار النشر اللذين وافقت عليهما.

### الموافقة

**قرأت اتفاقية تقديم البحوث وإيداعها وإشعار الخصوصية وأوافق عليهما، بما يشمل المعالجة باستخدام Gemini ما لم أختر إدخال البيانات يدوياً، والنشر وفق خيار المشاركة المحدد بعد الاعتماد، وقارئ البحث الذكي والمقالات المراجعة باستخدام العنوان والملخص المعتمدين للنشر. وأؤكد أنني مخوّل بمنح هذه الأذونات.**
$v5$);

create function record_bundled_knowledge_permission()
returns trigger language plpgsql security definer set search_path = public, extensions as $fn$
declare n knowledge_notices%rowtype; h text;
begin
  if new.agreement_version_id not in ('submission-terms-2026-11-18-v5-en','submission-terms-2026-11-18-v5-ar') then return new; end if;
  select * into n from knowledge_notices where version='submission-v5-2026-11-18';
  h := encode(digest(case when new.agreement_language='ar' then n.text_ar else n.text_en end,'sha256'),'hex');
  if h is null or h is distinct from new.agreement_sha256
     or new.agreement_version_id <> 'submission-terms-2026-11-18-v5-' || new.agreement_language
     or not exists (select 1 from papers where id=new.paper_id and submission_acceptance_id=new.id) then
    raise exception 'submission:agreement_invalid';
  end if;
  -- Finalization owns the intent row lock. Retries do not transition status
  -- again, and must never undo a later withdrawal.
  insert into knowledge_permissions(paper_id,granted,version,language,text_sha256)
  values(new.paper_id,true,n.version,new.agreement_language,h);
  return new;
end;
$fn$;
revoke all on function record_bundled_knowledge_permission() from public,anon,authenticated,service_role;
create trigger submission_bundled_knowledge
after update of status on submission_acceptances
for each row when (old.status='open' and new.status='finalized')
execute function record_bundled_knowledge_permission();

create or replace function get_paper_for_confirmation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_researchers jsonb;
  v_extraction jsonb;
  v_role text;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'researcher_id', r.id,
      'full_name', r.full_name,
      'linkedin_url', r.linkedin_url,
      'linkedin_public', r.linkedin_public,
      'is_submitter', r.id = v_paper.submitted_by,
      'author_order', pr.author_order
    ) order by pr.author_order nulls last, r.full_name
  ), '[]'::jsonb)
  into v_researchers
  from paper_researchers pr
  join researchers r on r.id = pr.researcher_id
  where pr.paper_id = v_paper.id;

  select ag.result_data into v_extraction
  from ai_generations ag
  where ag.id = v_paper.last_applied_generation_id;

  select claimed_role into v_role from submission_acceptances where id = v_paper.submission_acceptance_id;

  -- Explicit allowlist of fields, not select *.
  return jsonb_build_object(
    'paper_id', v_paper.id,
    'title', v_paper.title,
    'title_ar', v_paper.title_ar,
    'abstract', v_paper.abstract,
    'abstract_ar', v_paper.abstract_ar,
    'supervisor_name', v_paper.supervisor_name,
    'year', v_paper.year,
    'university', v_paper.university,
    'faculty', v_paper.faculty,
    'degree_type', v_paper.degree_type,
    'document_type', v_paper.document_type,
    'failure_code', v_paper.failure_code,
    'publication_scope', v_paper.publication_scope,
    'publication_setting', v_paper.publication_setting,
    'submitter_role', v_role,
    'bundled_knowledge', exists (select 1 from submission_acceptances a where a.id=v_paper.submission_acceptance_id
      and a.status='finalized' and a.paper_id=v_paper.id
      and a.agreement_version_id in ('submission-terms-2026-11-18-v5-en','submission-terms-2026-11-18-v5-ar')),
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    'manual_entry_source', v_paper.manual_entry_source,
    'manual_entry_at', v_paper.manual_entry_at,
    -- Phase 3, 0018: whether this paper may ever be read automatically.
    'automatic_processing', coalesce((external_ai_permission(v_paper.id) ->> 'permitted')::boolean, false),
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

revoke all on function get_paper_for_confirmation(text) from public;
grant execute on function get_paper_for_confirmation(text) to anon;
commit;
