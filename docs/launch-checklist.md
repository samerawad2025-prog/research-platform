# Phase 3 launch checklist

Updated 2026-10-15 (Khartoum). This is the founder's short operating guide. The [release runbook](release-runbook.md) remains authoritative for deployment steps.

## Where we are

| Area | State |
|---|---|
| Phase 1: upload, extraction and confirmation | Complete and live |
| Phase 2: interface, accessibility and bilingual support | Complete and live |
| Phase 3 M1-M3: processing choice, acceptance and researcher details | Complete and live |
| Phase 3 M4: private administrative review | Live; founder sign-in verified |
| Phase 3 M5-M6: public pages, search, citation exports and activity | Built and tested; public flag remains off |
| Stage G: public catalogue launch | Preparing genuine content and publication review |

The founder approved the existing free address, https://research-platform-5zpu.vercel.app, for the initial launch. Keep `PUBLIC_SITE_ORIGIN` unset until a permanent origin is chosen: research pages request no indexing, the sitemap stays empty, and citation exports have no permanent URL. This does not prevent someone with a public URL from sharing it once the catalogue is enabled.

The private request register is ready in the founder's connected Google Drive. It is a manual register, not an email integration. Keep its link, requests and private correspondence out of this public repository.

## 1. Collect a small genuine pilot collection

Start with a few genuine University of Khartoum papers. One fully eligible paper can establish the workflow; three to five gives a more useful first collection. This is a recommendation, not a new approval rule.

Ask an author or authorized depositor to use the live submission form:
https://research-platform-5zpu.vercel.app/submit

They should read the current agreement, choose their publication setting, upload the document, review the suggested metadata and press Confirm. Gemini remains the default; manual entry remains the secondary option.

Keep the private confirmation link private. Do not ask someone to accept on behalf of other authors without authority. Do not create retrospective acceptance records for older uploads.

All repeated test copies are excluded from launch content, including the one retained privately as a reference. Do not reclassify a sample as genuine simply to populate the catalogue. Submissions from other institutions remain welcome and private until their institutional rollout.

## 2. Review each candidate in the admin area

Open https://research-platform-5zpu.vercel.app/admin and work through each candidate:

1. Check the original document and the submitter-confirmed metadata. Minimum publication metadata: a title and abstract in at least one language, at least one author, a valid year, and confirmed status. Administrative review is not academic peer review.
2. Confirm the institution is University of Khartoum and map the faculty or school from the document. Do not guess an unresolved affiliation.
3. Check duplicate suggestions against the records. Similarity is a reason to inspect, not a plagiarism finding.
4. Review the recorded publication permission and any authority concerns. For a legacy submission, record only a determination supported by existing evidence. If evidence is missing, keep it private and seek clarification through the founder.
5. Resolve blocking issues and any embargo. Use a private note to record the basis for the decision.
6. For launch, prepare record-and-abstract publication only. The full-text release restriction stays active. Do not widen the submitter's permission or silently change the original acceptance.
7. Present the candidate and its review outcome to the founder before recording the first publication approval.

"Needs changes" and other admin decisions do not automatically notify the submitter. Any contact is manual and must be explicitly authorized. Request handling belongs in the private register, not a GitHub issue.

## 3. Obtain the public-launch decision

Prepare a concrete candidate list for the founder, with each proposed public title, authors, abstract and permission basis in a private review context. Do not put unpublished research or contact details in this public repository.

The founder's approval of the free address is not permission to publish records or enable the public site. Once the founder approves the reviewed records and launch, follow Stage G of the runbook. Do not activate volunteer access as part of launch; that has a separate confidentiality process.

## 4. Verify the authorized launch

After the approved feature-flag deployment:

- Confirm the deployment commit and production alias.
- Check that an approved record appears in the catalogue, search and its public page in English and Arabic, including a narrow screen.
- Confirm unapproved, withdrawn and ineligible records cannot be retrieved publicly.
- Check citation exports and clearly labelled activity counts. Citation exports are not citations received; there are no citation alerts yet.
- Confirm research pages request no indexing, the sitemap is empty and permanent canonical links are absent while the origin is unset.
- Confirm files remain private and full-text requests are refused.
- Confirm normal submission and founder sign-in still work.
- Record the results in the release runbook without private tokens or research content.

For a record problem, withdraw that record through the admin workflow. For a catalogue-wide problem, disable `PUBLIC_RESEARCH` and redeploy. Never restore the pre-cutover application.

## Optional invitation draft

This is a draft for the founder to send personally. No messages have been sent.

**English**

We are preparing a small pilot collection for SARP, an independent platform for preserving and discovering Sudanese academic research. We welcome genuine University of Khartoum research submitted by an author or authorized depositor. Participation is free. Submit at https://research-platform-5zpu.vercel.app/submit, read the terms and choose how your work may be displayed. You can use automatic extraction or enter the details manually, then review and confirm them. Submission does not publish the work automatically; publication follows administrative and permission review. This invitation does not imply endorsement by the University of Khartoum.

**العربية**

نُعد مجموعة تجريبية صغيرة لمنصة SARP، وهي منصة مستقلة لحفظ الأبحاث الأكاديمية السودانية وتيسير الوصول إليها. نرحب بأبحاث جامعة الخرطوم التي يقدمها أحد مؤلفيها أو شخص مخول بذلك. المشاركة مجانية. يمكن تقديم البحث عبر https://research-platform-5zpu.vercel.app/submit بعد قراءة الشروط واختيار نطاق العرض المسموح به. يمكن استخدام الاستخراج الآلي للبيانات أو إدخالها يدوياً، ثم مراجعتها وتأكيدها. تقديم البحث لا يعني نشره تلقائياً، إذ يسبق النشر فحص البيانات والأذونات. هذه الدعوة لا تعني وجود اعتماد أو تأييد من جامعة الخرطوم.

## After the pilot

First measure review time, incomplete submissions, queue size and request handling. These reflect the founder's and volunteers' capacity, not assumed payroll costs. Universities and researchers are not charged.

The next proposed product phase is "Explore research directions", grounded in reviewed sources and labelled "A possible research direction based on the sources reviewed." It is not built or scheduled yet. Citation alerts, similarity screening and additional AI integrations also remain later work; they do not block this launch.
