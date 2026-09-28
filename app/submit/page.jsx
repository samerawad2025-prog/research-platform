import LegacySubmissionForm from "../../components/LegacySubmissionForm";
import AcceptanceSubmissionForm from "../../components/AcceptanceSubmissionForm";
import { resolveExtractionMode } from "../../lib/env";

// This page talks to Supabase in the browser, not at build time — don't
// let Next.js try to pre-render it during `next build`, which would
// otherwise fail if environment variables aren't set yet.
export const dynamic = "force-dynamic";

export default function SubmitPage() {
  // SUBMISSION_ACCEPTANCE_FLOW=enabled selects the acceptance form. If that
  // flow is then unavailable, the form says so; it never falls back to the
  // legacy anonymous path (docs/submission-flow.md, "Cutover").
  if (String(process.env.SUBMISSION_ACCEPTANCE_FLOW || "").trim().toLowerCase() === "enabled") {
    return <AcceptanceSubmissionForm />;
  }
  // Read per request (the page is force-dynamic), from the same rule the
  // extraction route enforces.
  return <LegacySubmissionForm manualMode={resolveExtractionMode().mode === "manual"} />;
}
