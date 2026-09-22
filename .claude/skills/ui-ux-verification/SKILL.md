---
name: UI/UX Verification
description: Project-specific UI/UX quality standard for the Research Center Platform. Use whenever designing, changing, reviewing, or verifying user-facing pages, components, forms, responsive behavior, Arabic/English presentation, accessibility, loading/error states, or Playwright/browser checks.
when_to_use: Use for work in app/, components/, CSS modules, global styles, layouts, navigation, submission/confirmation screens, landing pages, bilingual content, responsive behavior, accessibility, and browser verification.
model: inherit
effort: high
paths:
  - "app/**"
  - "components/**"
  - "**/*.css"
  - "**/*.module.css"
---

# UI/UX verification — Research Center Platform

Apply this skill to all user-facing work. The target is a credible, calm, fast, bilingual research product for Sudanese students and readers — not a generic AI demo.

## Grounding

Before changing UI, read the smallest relevant set of:
- `docs/vision.md`
- `CURRENT_STATUS.md`
- `PROJECT_MAP.md`
- the page/component being changed and its styles

Do not reopen Phase 1 extraction work unless the UI task exposes a real production defect.

## Product experience standard

Optimize for:
- trust and academic credibility
- very low friction for a non-technical student
- mobile-first use on ordinary phones and imperfect networks
- equally intentional Arabic RTL and English LTR experiences
- clear hierarchy and restrained visual polish
- predictable controls and understandable system states
- minimal dependency and bundle growth

Avoid generic “AI product” styling, decorative complexity, gratuitous gradients, excessive cards, weak contrast, tiny text, dense forms, and motion without purpose.

Prefer a small coherent design system over page-specific styling:
- shared CSS variables/tokens for color, spacing, radii, typography, shadows, and focus
- consistent control heights, field spacing, button hierarchy, feedback patterns, and content widths
- semantic HTML before custom ARIA
- existing dependencies before new UI libraries

If a new package is genuinely useful, state the user benefit, bundle/maintenance cost, and simpler alternative before adding it.

## Bilingual and RTL requirements

Arabic is a first-class interface, not a mirrored afterthought.

When a page is Arabic:
- set semantic `lang` and `dir` in markup; do not fake base direction with CSS
- use CSS logical properties (`margin-inline`, `padding-inline`, `inset-inline`, `text-align: start/end`) instead of hard-coded left/right where direction matters
- use `dir="auto"` for user-entered or database text whose script may vary
- isolate mixed-direction inline text when needed so Arabic text, Latin names, numbers, URLs, years, emails, and phone numbers remain readable
- mirror only icons whose meaning is directional; do not mirror neutral icons
- verify punctuation, input alignment, dropdowns, validation messages, breadcrumbs/navigation, and icon placement in both directions
- do not mechanically translate copy when Arabic wording needs a more natural formulation

English and Arabic layouts should feel intentionally designed at the same visual quality.

## Accessibility baseline

Target WCAG 2.2 AA for all new or changed UI.

At minimum verify:
- every interactive control works by keyboard
- focus is visible and not hidden by sticky/fixed UI
- labels are programmatically associated with form controls
- validation identifies the field and explains how to fix it
- status changes that matter are announced appropriately without noisy live regions
- color is never the only carrier of meaning
- text and control contrast are sufficient
- zoom/reflow does not create horizontal scrolling for normal content
- pointer targets meet WCAG minimums; prefer approximately 44×44 CSS px for primary touch controls where practical
- reduced-motion preferences are respected for non-essential animation
- headings and landmarks form a sensible hierarchy
- disabled controls remain understandable and are not the only explanation for what is required

Do not add ARIA when native HTML already provides the correct semantics.

## Forms and flow quality

Submission and confirmation flows are high-trust moments.

For forms:
- ask only for information that is necessary
- group related fields; avoid long undifferentiated stacks
- show required/optional status clearly
- preserve entered values after recoverable errors
- validate at the right time: avoid aggressive errors before the user has had a chance to act
- place errors close to the relevant field and provide a useful summary if several errors occur
- prevent accidental duplicate submissions
- make primary and secondary actions visually unambiguous
- ensure country/phone controls remain usable with keyboard, touch, Arabic, and narrow screens

For extraction/processing states:
- never imply progress the system cannot actually know
- use stable skeleton/loading layouts to minimize layout shift
- clearly distinguish waiting, processing, partial success, retryable error, terminal error, and success
- preserve specific error messages already established in Phase 1; do not collapse them into a generic failure

## Responsive standard

At minimum inspect representative widths around:
- 360 px
- 390 px
- 768 px
- 1280 px
- 1440 px

Verify:
- no accidental horizontal scrolling
- important actions remain reachable without precision tapping
- no clipped Arabic text or dropdowns
- forms do not become visually overwhelming on narrow screens
- readable line length on desktop
- fixed/sticky elements do not cover focused fields or important content
- touch and keyboard behavior remain correct

Use breakpoints because the layout needs them, not because a device name was assumed.

## Performance standard

Keep the experience lightweight.

Prefer:
- server rendering/static rendering where already appropriate
- CSS for simple transitions rather than adding animation libraries
- optimized images and explicit dimensions
- no unnecessary client components
- no new heavy dependency for a small interaction
- no blocking work on initial render that can be deferred safely

Treat these as field targets when measurable, not synthetic promises:
- LCP ≤ 2.5 s
- INP ≤ 200 ms
- CLS ≤ 0.1
at the 75th percentile on both mobile and desktop.

If current tooling cannot measure field performance, report that limitation instead of claiming compliance.

## Browser verification

Use the existing script-driven Playwright/Chromium capability for meaningful UI changes. Do not add Playwright to `package.json` merely to perform an ad-hoc verification unless the task explicitly decides to establish permanent E2E tests.

Prefer preview/local for interactions that create data. Production browser checks are read-only unless the user explicitly authorizes a production test submission.

For changed flows, verify the smallest relevant matrix:
- English LTR
- Arabic RTL
- narrow mobile
- desktop
- keyboard-only path
- console errors
- failed network/request state when practical
- loading/success/error visual states

Capture screenshots when they help compare layout or document a visual regression. DOM assertions alone are not sufficient for layout quality; screenshots alone are not sufficient for behavior.

## Visual acceptance gate

Before declaring UI work complete, inspect the actual rendered result and ask:

1. Does it look like a trustworthy research/publication product rather than a prototype?
2. Is the main task obvious within a few seconds?
3. Is Arabic as polished as English?
4. Can a student complete it comfortably on a phone?
5. Are error and loading states calm, specific, and recoverable?
6. Is any element present only because it “looks modern” rather than helping the user?
7. Did this change introduce visual inconsistency elsewhere?

Fix clear problems within the requested scope. Do not turn a focused task into a site-wide redesign.

## Completion report

For UI work, report only evidence that matters:
- pages/components changed
- English/Arabic coverage
- mobile/desktop coverage
- accessibility checks performed
- Playwright/browser checks performed
- screenshots or failures worth reviewing
- any remaining limitation or decision requiring the founder
