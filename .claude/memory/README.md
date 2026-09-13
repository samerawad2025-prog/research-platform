# About this folder

**Honest note, verified before this was built:** `.claude/memory/` is not a documented Claude Code auto-loaded special path as of this writing. The project-committed, auto-loaded conventions that actually exist are the root `CLAUDE.md` file and `.claude/rules/*.md`. If Claude Code's memory system has since added first-class support for a project-local `memory/` folder, this note may be outdated — check current docs.

Until/unless that's confirmed, treat this folder as **plain reference material**, wired in explicitly via `@.claude/memory/quick-reference.md`-style imports from the root `CLAUDE.md`, not as something Claude Code scans automatically on its own.

**This folder does not duplicate `BUG_HISTORY.md`, `CLAUDE_CODE_HANDOVER.md`, or `PROJECT_MAP.md`**, which already exist at the repo root and were explicitly asked to be left untouched. `quick-reference.md` here is a genuinely different artifact: a dense symptom → cause lookup table, not a copy of those docs' prose.
