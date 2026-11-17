import {readingBrief} from '../../../../lib/public/readingBrief'
import {publicClient} from '../../../../lib/public/pageData'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function GET(request){
 const result=await readingBrief({sb:publicClient(),params:new URL(request.url).searchParams})
 return new Response(result.body,{status:result.status,headers:result.headers})
}
