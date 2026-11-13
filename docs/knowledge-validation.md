# Reader and article validation

The server validates provider output before returning an answer or saving an article draft. It requires an explicit boolean insufficient flag, an empty claim list when evidence is insufficient, and one to four sourced claims otherwise. Both article languages are validated independently.

Each abstract is normalized once per response using Unicode NFC and collapsed whitespace. Compatibility normalization is deliberately avoided: a quoted m² must not be accepted as m2. Every quote must occur in its named abstract. No extra provider request, dependency or persistent cache is introduced.

Quotation presence does not prove that a claim follows from it. Model instructions require supported meaning, and article publication still requires editorial review. Live Gemini smoke checks passed on 13 November 2026 (Khartoum): English methods/sample extraction, refusal of unsupported numerical effects, Arabic distinction between proposal and tested outcome, and one saved bilingual article draft. The draft was checked against the abstract and its Arabic business-ecosystem translation corrected. It remains unpublished. Automated regression tests use invented source text and simulated outputs; these checks do not establish general answer reliability.

Study comparison was released through PR #34 on 10 November 2026 (production merge 2cc0d10ec7f27d271b32b78e7b43ac91a46cd167). Phase 4 remains in progress.
