import SubmissionForm from "../../components/SubmissionForm";

// This page talks to Supabase in the browser, not at build time — don't
// let Next.js try to pre-render it during `next build`, which would
// otherwise fail if environment variables aren't set yet.
export const dynamic = "force-dynamic";

export default function SubmitPage() {
  return <SubmissionForm />;
}
