import LegacySubmissionForm from "../../components/LegacySubmissionForm";
import AcceptanceSubmissionForm from "../../components/AcceptanceSubmissionForm";

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
  // The legacy form, kept during the rollout. Its submissions carry no
  // acceptance of an agreement that allows automatic reading, so the
  // extraction route never reads them (migration 0018).
  return <LegacySubmissionForm />;
}
