const en={
title:'Find research for your question',intro:'Start with a question. Find studies and see the words and passages that match.',
label:'Your research question',placeholder:'How can industrial SMEs recover in Khartoum?',search:'Find studies',
scope:'Keyword matches in public titles and abstracts, not an AI answer. Try important terms in the language of the research; automatic translation is not included.',
terms:'Searching for',empty:'No matching studies found',emptyHelp:'Try fewer or different terms, or browse the catalogue. No matches does not mean the question is unexplored.',
needed:'Include a topic, place or subject in your question.',unavailable:'Research search is unavailable right now. Please try again.',
browse:'Browse all research',fallback:'Use catalogue search',matched:'Matching words',passage:'Matching passage',open:'Read this research',
limited:'Showing a bounded selection of matches. Narrow your question or use catalogue search to explore further.',
count:n=>n===1?'1 matching study':n+' matching studies',titleOnly:'Your words match the title; no abstract passage matched.',
examples:'Try a question',example1:'How can industrial SMEs recover in Khartoum?',example2:'What affects water use on farms?'
}
const ar={
title:'ابحث عن دراسات لسؤالك',intro:'ابدأ بسؤال، واعثر على دراسات مع الكلمات والمقاطع التي تطابقه.',
label:'سؤالك البحثي',placeholder:'كيف تتعافى المنشآت الصناعية في الخرطوم؟',search:'ابحث عن دراسات',
scope:'مطابقة كلمات في العناوين والملخصات العامة، وليست إجابة بالذكاء الاصطناعي. جرّب الكلمات المهمة بلغة البحث؛ لا تتضمن الميزة ترجمة تلقائية.',
terms:'كلمات البحث',empty:'لم نعثر على دراسات مطابقة',emptyHelp:'جرّب كلمات أقل أو مختلفة، أو تصفّح الدليل. غياب النتائج لا يعني أن السؤال لم يُبحث من قبل.',
needed:'ضمّن سؤالك موضوعاً أو مكاناً أو مجالاً محدداً.',unavailable:'البحث عن الدراسات غير متاح حالياً. يرجى المحاولة مجدداً.',
browse:'تصفّح جميع البحوث',fallback:'استخدم بحث الدليل',matched:'الكلمات المطابقة',passage:'مقطع مطابق',open:'اقرأ هذا البحث',
limited:'تُعرض مجموعة محدودة من النتائج. حدّد سؤالك أكثر أو استخدم بحث الدليل لاستكشاف المزيد.',
count:n=>n===1?'دراسة واحدة مطابقة':n+' دراسات مطابقة',titleOnly:'تطابق كلماتك عنوان البحث؛ لم يطابقها مقطع من الملخص.',
examples:'جرّب سؤالاً',example1:'كيف تتعافى المنشآت الصناعية في الخرطوم؟',example2:'ما العوامل التي تؤثر في استخدام المياه بالمزارع؟'
}
module.exports={DISCOVERY_MESSAGES:{en,ar}}
