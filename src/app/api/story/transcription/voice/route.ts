import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import type { TranscriptionCallback } from '@/lib/transcribe/types';
import { triggerResolve } from '@/services/resolve';
import {
  loadEntryTopicForVoice,
  markTranscribed,
  recordStageFailure,
} from '@/services/vectorise/voice/neo4j';
import { NextRequest, NextResponse } from 'next/server';

function parseCallback(body: unknown): TranscriptionCallback | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (
    record.sourceKind !== 'telegram_voice' ||
    typeof record.nodeId !== 'string' ||
    typeof record.jobId !== 'string' ||
    (record.status !== 'completed' && record.status !== 'failed') ||
    record.transcriptSource !== 'whisper'
  ) {
    return null;
  }

  return {
    jobId: record.jobId,
    sourceKind: 'telegram_voice',
    nodeId: record.nodeId,
    status: record.status,
    transcription: typeof record.transcription === 'string' ? record.transcription : undefined,
    transcriptSource: 'whisper',
    language: typeof record.language === 'string' ? record.language : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  };
}

export async function POST(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = parseCallback(body);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid transcription callback payload' }, { status: 400 });
  }

  const voiceId = payload.nodeId;

  try {
    if (payload.status === 'completed') {
      const transcription = payload.transcription?.trim();
      if (!transcription) {
        return NextResponse.json({ error: 'Empty transcription' }, { status: 400 });
      }

      await markTranscribed(voiceId, transcription);
      logger.info('Voice transcription callback applied', { voiceId, jobId: payload.jobId });

      const entryRef = await loadEntryTopicForVoice(voiceId);
      if (entryRef) {
        await triggerResolve(entryRef.entryId, entryRef.topic, { source: 'voice', voiceId });
      }

      return NextResponse.json({ status: 'ok', voiceId }, { status: 200 });
    }

    await recordStageFailure(voiceId, 'transcribe');
    logger.warn('Voice transcription callback failed', {
      voiceId,
      jobId: payload.jobId,
      error: payload.error,
    });
    return NextResponse.json({ status: 'failed', voiceId }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.error('Voice transcription callback error', { voiceId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
