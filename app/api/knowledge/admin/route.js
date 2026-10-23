import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { handleKnowledgeAdmin } from '../../../../lib/knowledge/core'
import { generate } from '../../../../lib/knowledge/gemini'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 40
export async function POST(request) {
  const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}
  const raw=await request.text()
  if(raw.length>60000)return Response.json({reason:'invalid_request'},{status:413,headers})
  let body;try{body=JSON.parse(raw)}catch{return Response.json({reason:'invalid_request'},{status:400,headers})}
  let supabase;try{supabase=getSupabaseAdmin()}catch{}
  const token=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'')?.[1]
  const r=await handleKnowledgeAdmin({body,token,supabase,generate})
  return Response.json(r.body,{status:r.status,headers})
}
