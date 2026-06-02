import type { AIProvider, UsageContext } from '../../types.js';
import { chunkText } from '../summarise.js';

const MEETING_SUMMARY_MAX_TOKENS = 8192;
// ~12500 tokens of transcript per chunk, safe for 24k-token context models
const MEETING_MAX_CHARS = 50_000;

const CHUNK_EXTRACT_PROMPT = `Extract the key points, decisions, and action items from this portion of a meeting transcript. Be concise but thorough — do not omit any decision or action item.`;

const MEETING_SKILL = `# Meeting Transcription Summary Skill

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
- **Owner must always be the person's FULL name (first AND last name), exactly as named in the transcript.** Never use a first name alone, a nickname, initials, or a partial name. If a person is referred to by first name in one place but their full name appears anywhere in the transcript, always use the full name. Only fall back to a first name if no full name is ever available. Use the identical full-name spelling consistently across every action item.
- If no owner is explicitly mentioned, write "TBD" as owner.
- Include: tasks assigned, decisions that need to be made, things to be researched, features to be designed or implemented, and any commitments made.
- Sort by urgency: ASAP items first, then by deadline, then TBD.

Format (Owner column always uses the full name, e.g. "Amanda Pousette", never "Amanda"):
\`\`\`
## Action Items

| # | Owner          | Action | Deadline |
|---|----------------|--------|----------|
| 1 | Firstname Lastname | Do X | ASAP   |
| 2 | Firstname Lastname | Do Y | Date   |
| 3 | TBD            | Do Z   | —        |
\`\`\`

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
\`\`\`
## Discussion Topics

### [Topic Title]
<detailed summary of this discussion block>

### [Topic Title]
<detailed summary of this discussion block>

... (repeat for each topic)
\`\`\`

---

## Output Format

Always return all three sections in this exact order:
1. Executive Summary
2. Action Items
3. Discussion Topics

Keep the tone professional and neutral. Do not editorialize or add opinions not present in the transcript.
If the transcript is incomplete or unclear in places, note it briefly in the relevant section.`;

export async function summariseMeeting(
  provider: AIProvider,
  transcript: string,
  ctx?: UsageContext,
): Promise<string> {
  if (transcript.length <= MEETING_MAX_CHARS) {
    return provider.summarise(MEETING_SKILL, transcript, MEETING_SUMMARY_MAX_TOKENS, ctx);
  }

  // Transcript too large for a single call — extract from each chunk then consolidate
  const chunks = chunkText(transcript, MEETING_MAX_CHARS);
  const extractions = await Promise.all(
    chunks.map(chunk => provider.summarise(CHUNK_EXTRACT_PROMPT, chunk, 2048, ctx)),
  );
  return provider.summarise(MEETING_SKILL, extractions.join('\n\n---\n\n'), MEETING_SUMMARY_MAX_TOKENS, ctx);
}
