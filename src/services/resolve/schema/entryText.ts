import type { EntrySourceKind, ResolveContext } from '../types';

export function getEntrySourceText(ctx: ResolveContext): {
  text: string;
  sourceKind: EntrySourceKind;
} {
  const transcription = ctx.transcription?.trim();
  if (transcription) {
    return { text: transcription, sourceKind: 'voice' };
  }

  const textContent = ctx.textContent?.trim();
  if (textContent) {
    return { text: textContent, sourceKind: 'text' };
  }

  throw new Error('no_entry_text');
}
