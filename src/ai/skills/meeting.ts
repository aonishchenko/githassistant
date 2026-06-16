import type { AIProvider, UsageContext } from '../../types.js';
import { chunkText } from '../summarise.js';
import { loadSkill } from './loader.js';

// Output cap for the final summary. Kept well below the model's 24k-token context
// so that input + output never exceeds it (avoids AiError 8007 "maximum context").
const MEETING_SUMMARY_MAX_TOKENS = 4096;
// Char budget per chunk / single-call threshold. 40k chars stays under ~16k input
// tokens even for token-dense content, leaving room for the response.
const MEETING_MAX_CHARS = 40_000;
// Total output-token budget shared across all chunk extractions. The consolidation
// call's input is therefore bounded regardless of how many chunks the transcript
// produces, so it cannot overflow the context window.
const CONSOLIDATION_EXTRACT_BUDGET_TOKENS = 12_000;
// Hard guard on the consolidation input length (belt-and-suspenders for huge meetings).
const CONSOLIDATION_MAX_CHARS = 45_000;

const CHUNK_EXTRACT_PROMPT = loadSkill('meeting-chunk-extract');

const MEETING_SKILL = loadSkill('meeting-summary');

export async function summariseMeeting(
  provider: AIProvider,
  transcript: string,
  ctx?: UsageContext,
): Promise<string> {
  if (transcript.length <= MEETING_MAX_CHARS) {
    return provider.summarise(MEETING_SKILL, transcript, MEETING_SUMMARY_MAX_TOKENS, ctx);
  }

  // Transcript too large for a single call — extract from each chunk then consolidate.
  const chunks = chunkText(transcript, MEETING_MAX_CHARS);
  // Distribute a fixed output-token budget across chunks so the joined extractions
  // (the consolidation call's input) stay bounded no matter how many chunks there are.
  const perChunkTokens = Math.min(2048, Math.max(384, Math.floor(CONSOLIDATION_EXTRACT_BUDGET_TOKENS / chunks.length)));
  const extractions = await Promise.all(
    chunks.map(chunk => provider.summarise(CHUNK_EXTRACT_PROMPT, chunk, perChunkTokens, ctx)),
  );
  const consolidated = extractions.join('\n\n---\n\n').slice(0, CONSOLIDATION_MAX_CHARS);
  return provider.summarise(MEETING_SKILL, consolidated, MEETING_SUMMARY_MAX_TOKENS, ctx);
}
