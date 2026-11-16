const SYNTHESIS_MESSAGES={
 en:{title:'Ask about these studies',scope:'Pilot: answers use the selected approved abstracts only. This is not a systematic review.',
 ask:'Explain this comparison',needQuestion:'Enter a question above and update the comparison to ask about it.',
 privacy:'Your question and the selected approved titles and abstracts are sent to Google Gemini under its free-tier terms. Do not enter personal or confidential information.',
 unavailable:'AI comparison is unavailable for this selection. You can still compare the public abstracts.',
 study:'What a study reports',comparison:'Across studies',insufficient:'The selected abstracts do not support an answer using at least two studies.',
 coverage:(n,total)=>'Cited '+n+' of '+total+' selected studies. Uncited studies do not support this answer.',
 caution:'AI explanations can be wrong. Matching quotations do not guarantee a correct interpretation. Check every linked passage.',
 evidence:'Supporting passages',changed:'The source or its permission changed. Reload the comparison.',large:'These abstracts are too long for this comparison. Try another selection.'},
 ar:{title:'اسأل عن هذه الدراسات',scope:'ميزة تجريبية: تستند الإجابات إلى الملخصات المعتمدة المختارة فقط. ليست مراجعة منهجية.',
 ask:'اشرح هذه المقارنة',needQuestion:'أدخل سؤالاً أعلاه وحدّث المقارنة لتسأل عنه.',
 privacy:'يُرسل سؤالك والعناوين والملخصات المعتمدة المختارة إلى Google Gemini وفق شروط الخدمة المجانية. لا تدخل معلومات شخصية أو سرية.',
 unavailable:'المقارنة بالذكاء الاصطناعي غير متاحة لهذه المجموعة. يمكنك مقارنة الملخصات العامة.',
 study:'ما تذكره الدراسة',comparison:'بين الدراسات',insufficient:'لا تدعم الملخصات المختارة إجابة تستند إلى دراستين على الأقل.',
 coverage:(n,total)=>'استُشهد بـ '+n+' من '+total+' دراسات مختارة. الدراسات غير المستشهد بها لا تدعم هذه الإجابة.',
 caution:'قد تخطئ الشروح الآلية. تطابق الاقتباسات لا يضمن صحة التفسير. راجع كل نص مرتبط بمصدره.',
 evidence:'النصوص الداعمة',changed:'تغيّر المصدر أو الإذن الخاص به. أعد تحميل المقارنة.',large:'هذه الملخصات أطول من الحد المتاح للمقارنة. جرّب مجموعة أخرى.'}
}
module.exports={SYNTHESIS_MESSAGES}
