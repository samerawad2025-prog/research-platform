const assert=require('node:assert/strict')
const {planDocument,NOTE_LIMIT}=require('../lib/public/researchPlan')
const {RESEARCH_PLAN_MESSAGES}=require('../lib/i18nResearchPlan')
const notes={question:'Can this be tested in Khartoum?',approach:'context',foundation:'My proposed extension, not a reported finding.',feasibility:'Need access to data.'}
for(const locale of ['en','ar']){
 const t=RESEARCH_PLAN_MESSAGES[locale],brief='Public source: https://example.invalid/research/abcdefghjkmn'
 const out=planDocument({brief,notes,locale})
 assert.ok(out.includes(brief));assert.ok(out.includes(notes.foundation));assert.ok(out.includes(t.notEvidence))
 assert.ok(out.indexOf(brief)<out.indexOf(t.ownNotes))
 assert.ok(out.includes(t.approaches.context))
 const blank=planDocument({brief,notes:{question:'',foundation:'',feasibility:'',approach:'undecided'},locale})
 assert.ok(blank.includes(t.absent))
}
for(const edit of [{approach:'invented'},{approach:'toString'},{question:'x'.repeat(NOTE_LIMIT+1)},{foundation:null}]){
 assert.throws(()=>planDocument({brief:'source',notes:{...notes,...edit},locale:'en'}))
}
assert.throws(()=>planDocument({brief:'',notes,locale:'en'}))
assert.throws(()=>planDocument({brief:'source',notes,locale:'zz'}))
console.log('PASS research plan: separate proposals, bilingual output, missing data and bounded notes')
