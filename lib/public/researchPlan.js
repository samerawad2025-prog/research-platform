const {RESEARCH_PLAN_MESSAGES}=require('../i18nResearchPlan')
const NOTE_LIMIT=1500
function planDocument({brief,notes,locale}){
 const t=RESEARCH_PLAN_MESSAGES[locale]
 if(!t||typeof brief!=='string'||!brief.trim()||!notes||
    !Object.hasOwn(t.approaches,notes.approach)||
    ['question','foundation','feasibility'].some(k=>typeof notes[k]!=='string'||notes[k].length>NOTE_LIMIT))throw Error('invalid_plan')
 const clean=value=>value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim()
 return [t.documentTitle,'',brief.trim(),'',
  '====================',t.ownNotes,t.notEvidence,'',
  t.question,clean(notes.question)||t.absent,'',
  t.approach,t.approaches[notes.approach],'',
  t.foundation,clean(notes.foundation)||t.absent,'',
  t.feasibility,clean(notes.feasibility)||t.absent,'',t.review,''].join('\n')
}
module.exports={NOTE_LIMIT,planDocument}
