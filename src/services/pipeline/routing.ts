import { forwardRouteForTopic, resolveRouteForTopic, shouldForwardToSibling } from '@organising-config';
import { MAX_VOICE_DURATION_SEC } from '@/services/vectorise/voice/types';
import type { FullEntryData, FullEntryInputData } from '@/lib/db/models/entry';

export type PipelineAction =
  | { kind: 'forward-webhook'; domain: string; path: string; payload: unknown }
  | { kind: 'dispatch-ingest'; origin: string }
  | { kind: 'trigger-resolve'; entryId: string; topic: string }
  | { kind: 'dispatch-transcribe'; origin: string; voiceId: string }
  | {
      kind: 'dispatch-transcribe-service';
      voiceId: string;
      telegramFileId: string;
    }
  | { kind: 'none' };

export interface ReceiptOptions {
  isReply?: boolean;
}

function hasTextContent(entryInput: FullEntryInputData): boolean {
  return Boolean(entryInput.textContent?.text?.trim());
}

function hasVoiceOnly(entryInput: FullEntryInputData): boolean {
  return Boolean(entryInput.voice) && !hasTextContent(entryInput);
}

function isDeferredLongVoice(entryInput: FullEntryInputData): boolean {
  return Boolean(
    entryInput.voice && entryInput.voice.duration > MAX_VOICE_DURATION_SEC
  );
}

export function pipelineActionsForReceipt(
  topic: string | null | undefined,
  origin: string,
  payload: unknown,
  options: ReceiptOptions = {}
): PipelineAction[] {
  const isReply = options.isReply ?? false;
  const actions: PipelineAction[] = [];

  const forwardRoute = forwardRouteForTopic(topic);
  if (forwardRoute && shouldForwardToSibling(forwardRoute.mode, isReply)) {
    actions.push({
      kind: 'forward-webhook',
      domain: forwardRoute.domain,
      path: forwardRoute.path,
      payload,
    });
  }

  if (!isReply) {
    actions.push({ kind: 'dispatch-ingest', origin });
  }

  return actions;
}

export function pipelineActionsAfterIngest(
  topic: string | null | undefined,
  entryInput: FullEntryInputData,
  entry: FullEntryData,
  origin: string | undefined
): PipelineAction[] {
  const resolveRoute = resolveRouteForTopic(topic);

  if (hasTextContent(entryInput)) {
    if (resolveRoute && topic) {
      return [{ kind: 'trigger-resolve', entryId: entry.entry.id, topic }];
    }
    return [{ kind: 'none' }];
  }

  if (hasVoiceOnly(entryInput)) {
    const voiceId = entry.voice?.id;
    const telegramFileId = entry.voice?.fileId ?? entryInput.voice?.fileId;

    if (isDeferredLongVoice(entryInput)) {
      if (!voiceId || !telegramFileId) {
        return [{ kind: 'none' }];
      }
      return [{ kind: 'dispatch-transcribe-service', voiceId, telegramFileId }];
    }

    if (!voiceId || !origin) {
      return [{ kind: 'none' }];
    }

    return [{ kind: 'dispatch-transcribe', origin, voiceId }];
  }

  return [{ kind: 'none' }];
}
