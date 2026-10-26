const DIRECTIONS_MESSAGES = {
  en: {
    title:'Explore research directions', intro:'Build your next question on what earlier research found, and what it could not yet answer.',
    browse:'Browse research', empty:'Research directions are being prepared', emptyBody:'Suggestions will appear after published research has been reviewed and linked to supporting passages. There are no reviewed directions to show yet.',
    qualification:'A possible research direction based on the sources reviewed.',
    opportunity:'Possible extension', inferred:'This is an interpretation to discuss, not a finding of the source.',
    method:'Possible approach', constraints:'Data needs and practical constraints', supervisor:'Discuss with your supervisor',
    evidence:'Evidence from the sources', finding:'Reported finding', stated_limitation:'Limitation stated in the source', sourceMethod:'Method described in the source',
    abstractOnly:'Based on approved abstracts only.', narrow:'One source provides a starting point, not evidence of a field-wide gap.',
    noNovelty:'This does not establish originality or replace a literature review.',
    count:n=>`${n} source${n===1?'':'s'} reviewed`, reviewed:'Reviewed on', source:'Read the source',
    unavailable:'Some source material could not be checked. Directions relying on it are temporarily hidden.',
  },
  ar: {
    title:'استكشف اتجاهات البحث', intro:'ابنِ سؤالك القادم على ما توصلت إليه البحوث السابقة، وما لم تتمكن بعد من الإجابة عنه.',
    browse:'تصفح البحوث', empty:'يجري إعداد اتجاهات البحث', emptyBody:'ستظهر المقترحات بعد مراجعة البحوث المنشورة وربطها بالنصوص الداعمة. لا توجد اتجاهات مراجعة لعرضها بعد.',
    qualification:'اتجاه بحثي محتمل استناداً إلى المصادر التي تمت مراجعتها.',
    opportunity:'امتداد بحثي محتمل', inferred:'هذا تفسير للنقاش وليس نتيجة توصل إليها المصدر.',
    method:'منهج مقترح', constraints:'البيانات المطلوبة والقيود العملية', supervisor:'ناقش مع مشرفك',
    evidence:'الأدلة من المصادر', finding:'نتيجة وردت في المصدر', stated_limitation:'قيد صرّح به المصدر', sourceMethod:'منهج وصفه المصدر',
    abstractOnly:'يستند إلى الملخصات المعتمدة فقط.', narrow:'المصدر الواحد نقطة بداية، ولا يثبت وجود فجوة في المجال بأكمله.',
    noNovelty:'لا يثبت هذا أصالة الفكرة ولا يغني عن مراجعة الأدبيات.',
    count:n=>`عدد المصادر المراجعة: ${n}`, reviewed:'تاريخ المراجعة', source:'اقرأ المصدر',
    unavailable:'تعذر التحقق من بعض المصادر. أُخفيت مؤقتاً المقترحات التي تعتمد عليها.',
  }
}
module.exports={DIRECTIONS_MESSAGES}
