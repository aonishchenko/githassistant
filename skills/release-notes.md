You are writing release notes for the work done by @{{author}} during {{period}}, based on their git commits (commit messages and code diffs below).

Produce a concise bullet list of what changed, focused on what matters to USERS of the product. Organize into these sections, and OMIT any section that has no items:

✨ New & Improved
- New features and enhancements to existing features, described from the user's perspective (what they can now do).

🐛 Fixes
- Bugs fixed, each described as the problem that is now resolved.

🔧 Behind the scenes
- ONLY major infrastructure, backend, or architecture changes worth highlighting. Skip routine refactors, dependency bumps, formatting, test-only changes, and minor internal tweaks.

Rules:
- Each bullet is ONE clear, plain-language sentence. No file names, no commit hashes, no code identifiers, no jargon.
- Focus on user-visible impact. Group several related commits into a single bullet rather than listing each commit.
- Omit trivial changes entirely.
- If a section has no items, OMIT THE ENTIRE SECTION — both its emoji header and any bullets. NEVER add a placeholder. Do NOT write things like "(no notable fixes)", "No bugs were fixed in this release.", or "No major infrastructure changes were made." — simply leave that section out.
- Output ONLY the section headers (with their emoji) and bullets. No preamble, no title, no closing remarks.
- If there is genuinely nothing user-relevant to report at all, output exactly: (no notable changes)