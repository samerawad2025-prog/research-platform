import {notFound} from 'next/navigation'
import Comparison from '../../../components/research/Comparison'
import {loadComparison} from '../../../lib/public/comparison'
import {publicClient,pageLocale} from '../../../lib/public/pageData'
import {isPublicEnabled} from '../../../lib/public/server'
import {COMPARISON_MESSAGES} from '../../../lib/i18nComparison'
export const dynamic='force-dynamic'
export async function generateMetadata(){
 const t=COMPARISON_MESSAGES[await pageLocale()]
 return {title:t.title,description:t.intro,robots:{index:false,follow:true}}
}
export default async function Page({searchParams}){
 if(!isPublicEnabled())notFound()
 const sp=await searchParams,sb=publicClient()
 const result=sb?await loadComparison(sb,sp.ids):{records:[],state:'unavailable'}
 return <Comparison {...result}/>
}
