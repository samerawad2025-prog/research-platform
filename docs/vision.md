# Vision

This document captures *why* the platform exists and what it's ultimately trying to become — the founding brief, not the current build status. For what's actually built, see `architecture.md`, `database.md`, and `extraction-pipeline.md`. For what's planned next, see `CLAUDE_CODE_HANDOVER.md`'s roadmap section.

## What this is

A digital platform that preserves, organises, publishes, and communicates undergraduate research produced by students and graduates of the School of Management Studies at the University of Khartoum, with the intent to expand later to other faculties and eventually other Sudanese universities.

Undergraduate research contains real findings about Sudanese businesses, institutions, communities, markets, management practices, development challenges, and economic conditions — but it's typically inaccessible after graduation (personal files, departmental archives, printed copies) and, even where available, written in a format inaccessible to non-specialist audiences.

The founder is one person, initially with limited technical and financial resources (an initial budget on the order of USD 50). The first version prioritises validation, usefulness, and reliability over scale or technical sophistication.

## Core vision

Build a trusted digital home for Sudanese undergraduate research, and transform academic work into accessible public knowledge:

- Preserve student research
- Make it searchable and discoverable
- Recognise and properly attribute student researchers
- Convert academic studies into accessible research articles
- Generate accurate Arabic and English communication materials
- Connect research findings with real-world discussion
- Help researchers build visible academic profiles
- Increase the social and professional value of undergraduate research
- Create a foundation for a larger Sudanese research and knowledge platform

## Who it's for

**Student researchers and graduates** — most are not pursuing long-term research careers and have limited interest in academic publishing itself. The primary incentive is not researcher profiles or citation tooling; it's simple, immediate, public recognition with minimal effort: a credible public achievement they can repost to classmates, employers, and scholarship networks. The submission process should ask only for the document, basic author information, a LinkedIn profile where available, publication permission, and approval of the final content — the administrator handles extraction, writing, editing, and publication.

**Readers** — university students, researchers, lecturers, entrepreneurs, businesses, journalists, policymakers, development organisations, civil society, and the Sudanese diaspora. They need simple explanations, search and filtering, credible summaries, transparent sourcing, and access to the original research where permitted.

**The platform administrator** (currently the founder, alone) — needs a manageable submission process, clear consent records, AI-assisted processing, a review workflow, easy editing, and low operating cost.

**University stakeholders** (future) — departments, supervisors, alumni bodies, administrators — care about institutional reputation, research visibility, academic standards, and intellectual-property rights.

## Non-negotiable academic standards

These apply to every AI-generated output, present and future, not only metadata extraction:

- Never present AI-generated interpretation as if it were an original research finding.
- Preserve the meaning of the source; distinguish findings from interpretations, and correlation from causation.
- Retain limitations the original research states.
- Never invent numbers, quotations, sources, variables, locations, methods, or conclusions.
- Never strengthen a weak or uncertain conclusion, or remove a qualification that materially affects meaning.
- Never claim national representativeness when the study used a limited sample.
- Never imply peer review unless the work was actually peer reviewed.
- Flag missing, contradictory, or unclear information rather than filling the gap creatively.
- Cite the relevant section, page, table, or figure whenever technically possible.
- Human approval is required before public publication — always.

This is the standard the current metadata-extraction pipeline was built against (see `prompts/metadata-extraction.md`), and the standard any future article-generation or validation step must also meet (see `prompts/article-generation.md`, `prompts/validation.md`).

## Product principles

- **Start narrow** — one school, a small number of papers, a limited publication workflow.
- **Human approval before publication** — AI accelerates the work, it doesn't replace academic review and researcher consent.
- **Researcher ownership** — researchers stay visible, credited, and able to correct their own profiles and publications.
- **Accessibility without dishonesty** — academic work becomes easier to understand without becoming intellectually dishonest.
- **Bilingual relevance** — English and Arabic outputs are adapted to their audiences, not mechanically translated.
- **Low cost** — avoid paid infrastructure unless it resolves a demonstrated bottleneck.
- **Operational simplicity** — a system one person can reliably run beats a sophisticated system that becomes unsustainable.
- **Evidence before expansion** — expansion follows measured adoption, engagement, and institutional interest.
- **Trust before traffic** — accuracy, transparency, and credibility matter more than viral reach.

## Where the current build sits against this vision

The platform today implements the **submission → AI extraction → human confirmation** loop (referred to elsewhere as "Step 3"). Turning confirmed metadata into a public, accessible article; generating social-media communication assets; and public search/discovery are all future work — see `prompts/article-generation.md` for the closest thing to a starting point on the first of these, and `CLAUDE_CODE_HANDOVER.md` for the fuller roadmap.
