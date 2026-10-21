import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'
import { handleKnowledge } from '../../../lib/knowledge/core'
import { generate } from '../../../lib/knowledge/gemini'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 40
export async function POST(request) {
  const headers = { 'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer' }
  const raw=await request.text()
  if(raw.length>5000) return Response.json({reason:'invalid_request'},{status:413,headers})
  let body;try{body=JSON.parse(raw)}catch{return Response.json({reason:'invalid_request'},{status:400,headers})}
  let supabase;try{supabase=getSupabaseAdmin()}catch{}
  const result=await handleKnowledge({body,supabase,generate,headers:request.headers,clientKey:request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||''})
  if(result.status===429) headers['Retry-After']='3600'
  return Response.json(result.body,{status:result.status,headers})
}
