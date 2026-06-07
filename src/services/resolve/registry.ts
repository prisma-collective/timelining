import type { ResolveHandlerName } from './types';

/** Telegram forum topic name → resolve handler (schema-driven channels only). */
export const RESOLVE_TOPIC_HANDLERS = {
  _botEnrolment: 'enrolment',
  _botDecidiendo: 'deciding',
} as const satisfies Record<string, ResolveHandlerName>;

export type ResolveTopic = keyof typeof RESOLVE_TOPIC_HANDLERS;

export const RESOLVE_TOPICS = Object.keys(RESOLVE_TOPIC_HANDLERS) as ResolveTopic[];

export function handlerForTopic(topic: string | undefined): ResolveHandlerName | null {
  if (!topic) return null;
  return RESOLVE_TOPIC_HANDLERS[topic as ResolveTopic] ?? null;
}

/** Voice entries are ready when transcribed; text-only entries have no voice node. */
export function entryMeetsVoiceGate(
  voiceStatus: string | null,
  transcription?: string | null
): boolean {
  if (!voiceStatus) return true;
  return !!transcription?.trim();
}
