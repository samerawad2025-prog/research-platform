import { notFound } from 'next/navigation'
import ArticleWorkspace from '../../../../../components/admin/ArticleWorkspace'
export default async function Page({params}) {
  if(process.env.RESEARCH_KNOWLEDGE !== 'enabled') notFound()
  const {id}=await params
  return <ArticleWorkspace paperId={id} />
}
