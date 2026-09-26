import SubmissionForm from "../../components/SubmissionForm";
import { resolveExtractionMode } from "../../lib/env";

// This page talks to Supabase in the browser, not at build time — don't
// let Next.js try to pre-render it during `next build`, which would
// otherwise fail if environment variables aren't set yet.
export const dynamic = "force-dynamic";

export default function SubmitPage() {
  // Read per request (the page is force-dynamic), from the same rule the
  // extraction route enforces.
  return <SubmissionForm manualMode={resolveExtractionMode().mode === "manual"} />;
}
