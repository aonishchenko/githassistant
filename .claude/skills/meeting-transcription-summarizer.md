---
name: meeting-transcription-summarizer
description: Analyze meeting transcriptions and generate executive summaries, action items, and detailed discussion topics. Use this skill whenever you need to process meeting notes, call transcripts, or recorded conversations and extract structured insights. Works with any transcription source. LLM-agnostic. Triggers on phrases like "summarize this transcript", "analyze this meeting", "what were the action items", "process these meeting notes".
---

# Meeting Transcription Summary Skill

## Purpose
Transform any meeting transcription into a structured, actionable summary.

---

## Input
A meeting transcription in any format:
- Raw text with or without speaker labels
- Timestamped transcripts
- Auto-generated captions
- Structured exports from Fireflies, Otter, Granola, etc.

---

## Instructions

When given a meeting transcription, perform the following three tasks in this exact order.

---

### TASK 1 — Executive Summary

Write a concise executive summary of the entire meeting.

Rules:
- **Very short but meaningful summary.** First 2-3 sentences should provide high level picture what was the discsussion about.
- **No preamble.** Never start with "This meeting brought together...", "The team discussed...", "Participants gathered to...", or any generic meeting framing. Jump straight to substance.
- **Decisions and confirmed outcomes only.** Include what was actually decided, agreed upon, or confirmed as important. Do NOT mention tangential topics, exploratory ideas, or things briefly mentioned in passing that led to no conclusion.
- **No pricing details, feature specs, or technical specifics.** Those belong in Task 3 (Discussion Topics).
- **One key insight per sentence.** Be direct and crisp.
- **Length: 5-8 sentences is ideal. 15 sentences is the absolute maximum.** Shorter is better if it captures the essence.

Example of a BAD executive summary (too generic, preamble-heavy, too detailed):
> "This meeting brought together the engineering and product teams to discuss Q2 roadmap priorities for a SaaS platform. The team covered many topics including DB migration, incidents, and hiring. Pricing was discussed at length including costs of $0.10 per notification message..."

Example of a GOOD executive summary (direct, decision-focused, no preamble):
> "Q2 engineering priorities confirmed: feature X and Y are the main priority, DB migration is postponed to H2. Three incidents discussed. Hiring freeze lifted — two backend roles to be filled by end of month."

---

### TASK 2 — Action Items

Extract ALL action items from the meeting, scanning every discussion block thoroughly.

Rules:
- **Mine every topic for actions.** Even casual mentions like "we should check X" or "someone needs to decide on Y" are action items if they require a follow-up decision, investigation, or implementation.
- Each action item must be specific and actionable — not vague.
- If no owner is explicitly mentioned, write "TBD" as owner.
- Include: tasks assigned, decisions that need to be made, things to be researched, features to be designed or implemented, and any commitments made.
- Sort by urgency: ASAP items first, then by deadline, then TBD.

Format:
```
## Action Items

| # | Owner | Action | Deadline |
|---|-------|--------|----------|
| 1 | Name  | Do X   | ASAP     |
| 2 | Name  | Do Y   | Date     |
| 3 | TBD   | Do Z   | —        |
```

---

### TASK 3 — Detailed Summary by Discussion Topic

Identify the distinct topics or discussion blocks from the meeting. For each topic, write a detailed summary.

Rules:
- Identify topics organically from the conversation — do not force artificial groupings.
- Each topic gets its own subsection with a clear descriptive title.
- Per topic: summarize what was discussed, what positions or options were raised, and what (if anything) was concluded.
- Include relevant context, numbers, names, or decisions mentioned in that block.
- Aim for 3–8 sentences per topic.
- If a topic was unresolved or left open, note that explicitly.

Format:
```
## Discussion Topics

### [Topic Title]
<detailed summary of this discussion block>

### [Topic Title]
<detailed summary of this discussion block>

... (repeat for each topic)
```

---

## Output Format

Always return all three sections in this exact order:
1. Executive Summary
2. Action Items
3. Discussion Topics

Keep the tone professional and neutral. Do not editorialize or add opinions not present in the transcript.
If the transcript is incomplete or unclear in places, note it briefly in the relevant section.
