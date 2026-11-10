const COMPARISON_MESSAGES={
 en:{title:'Compare research',intro:'Read published studies together to decide what to explore next.',browse:'Browse research',
 select:'Add to comparison',count:n=>`${n} of 3 selected`,clear:'Clear selection',choose:'Choose two or three studies from the catalogue to compare.',
 missing:'One or more selected studies are no longer available. Choose your studies again.',unavailable:'The studies could not be checked. Please try again.',
 scope:'This comparison shows approved metadata and abstracts. It does not rank quality or establish a research gap.',
 titleRow:'Study',year:'Year',institution:'Institution',unit:'Faculty or academic unit',type:'Document type',degree:'Degree',abstract:'Abstract',
 absent:'Not reported in the public record',source:'Open research page',thesis:'Thesis',article:'Article',questions:'Questions to take further',
 prompts:['Do these studies address the same question in comparable populations or places?','Which methods and limitations does each source actually report? Check the full paper where available.','Would a replication in Sudan, a follow-up or a different setting be useful and feasible? Discuss with your supervisor.'],
 narrow:'Similar wording or publication dates do not establish agreement, quality or originality.',scroll:'Comparison table; scroll horizontally to see all studies'},
 ar:{title:'مقارنة البحوث',intro:'اقرأ الدراسات معاً لتحديد ما يستحق الاستكشاف لاحقاً.',browse:'تصفح البحوث',
 select:'أضف للمقارنة',count:n=>`تم اختيار ${n} من 3`,clear:'إلغاء الاختيار',choose:'اختر بحثين أو ثلاثة من الفهرس للمقارنة.',
 missing:'لم يعد أحد البحوث المختارة متاحاً. يرجى اختيار البحوث مجدداً.',unavailable:'تعذر التحقق من البحوث. حاول مرة أخرى.',
 scope:'تعرض المقارنة البيانات والملخصات المعتمدة. لا تقيّم جودة البحوث ولا تثبت وجود فجوة بحثية.',
 titleRow:'البحث',year:'السنة',institution:'المؤسسة',unit:'الكلية أو الوحدة الأكاديمية',type:'نوع الوثيقة',degree:'الدرجة',abstract:'الملخص',
 absent:'غير مذكور في السجل العام',source:'افتح صفحة البحث',thesis:'رسالة علمية',article:'مقال علمي',questions:'أسئلة لمواصلة البحث',
 prompts:['هل تتناول هذه الدراسات السؤال نفسه ضمن مجتمعات أو مناطق قابلة للمقارنة؟','ما المناهج والقيود المذكورة فعلياً في كل مصدر؟ راجع النص الكامل عند توفره.','هل تفيد إعادة الدراسة في السودان، أو متابعتها، أو تطبيقها في سياق آخر؟ ناقش الجدوى مع مشرفك.'],
 narrow:'تشابه الصياغة أو تواريخ النشر لا يثبت اتفاق النتائج أو الجودة أو الأصالة.',scroll:'جدول المقارنة؛ مرر أفقياً لعرض جميع البحوث'}
}
module.exports={COMPARISON_MESSAGES}
