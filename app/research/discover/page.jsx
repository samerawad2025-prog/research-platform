import { notFound } from 'next/navigation'
import Discovery from '../../../components/research/Discovery'
import { cleanQuestion, discover } from '../../../lib/public/discovery'
import { publicClient, pageLocale } from '../../../lib/public/pageData'
import { isPublicEnabled } from '../../../lib/public/server'
import { DISCOVERY_MESSAGES } from '../../../lib/i18nDiscovery'
export const dynamic='force-dynamic'
export async function generateMetadata(){
 const t=DISCOVERY_MESSAGES[await pageLocale()]
 return {title:t.title,description:t.intro,robots:{index:false,follow:true}}
}
export default async function Page({searchParams}){
 if(!isPublicEnabled())notFound()
 const question=cleanQuestion((await searchParams)?.q)
 const result=await discover(question?publicClient():null,question)
 return <Discovery question={question} result={result}/>
}
