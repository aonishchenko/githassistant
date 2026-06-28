import { describe, it, expect } from 'vitest';
import { findUnsummarisedTranscripts } from '../../src/jobs/meetingScan.js';

describe('findUnsummarisedTranscripts', () => {
  it('queues only transcripts (any depth) that lack a summary file', () => {
    const files = [
      // root: transcript without summary -> process
      'docs/meeting_notes/Meeting_transcription_2026_06_26.md',
      // subfolder: transcript WITH a summary -> skip
      'docs/meeting_notes/Empiro_sync/Meeting_transcription_2026_06_24.md',
      'docs/meeting_notes/Empiro_sync/Meeting_summary_2026_06_24.md',
      // deeper subfolder + spaces: transcript without summary -> process
      'docs/meeting_notes/Clients/Paul Hogenbirk/Demo-call-Empiro-Paul_transcription_2026_06_25.md',
    ];
    expect(findUnsummarisedTranscripts(files)).toEqual([
      'docs/meeting_notes/Meeting_transcription_2026_06_26.md',
      'docs/meeting_notes/Clients/Paul Hogenbirk/Demo-call-Empiro-Paul_transcription_2026_06_25.md',
    ]);
  });

  it('returns nothing when every transcript already has a summary', () => {
    const files = [
      'docs/meeting_notes/Empiro_sync/Meeting_transcription_2026_06_24.md',
      'docs/meeting_notes/Empiro_sync/Meeting_summary_2026_06_24.md',
    ];
    expect(findUnsummarisedTranscripts(files)).toEqual([]);
  });

  it('ignores summary files themselves', () => {
    const files = ['docs/meeting_notes/Empiro_sync/Meeting_summary_2026_06_24.md'];
    expect(findUnsummarisedTranscripts(files)).toEqual([]);
  });
});
