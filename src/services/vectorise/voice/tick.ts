import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { VECTORISE_BATCH_SIZE } from '../shared/types';
import { hasTimeRemaining } from '../shared/tickUtils';
import type { ScheduleHint } from '../shared/types';
import {
  countOutstanding,
  countPipelineByStatus,
  pickVoiceIdsByStatus,
} from './neo4j';
import { transcribeStage } from './transcribe';
import { vectoriseStage } from './stage';
import type {
  TranscribeTickResult,
  VectoriseTickResult,
  VoiceVectoriseResult,
} from './types';

export async function runTranscribeTick(): Promise<TranscribeTickResult> {
  const counts = { transcribed: 0, skipped_long: 0, failed: 0 };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping transcribe tick.');
    return { status: 'skipped', message: 'Neo4j not configured.', ...counts };
  }

  try {
    const pendingIds = await pickVoiceIdsByStatus('pending', 1);
    if (pendingIds.length === 0) {
      return { status: 'success', ...counts };
    }

    const startTime = Date.now();
    if (!hasTimeRemaining(startTime)) {
      return { status: 'success', ...counts };
    }

    const result = await transcribeStage(pendingIds[0]);
    if (result === 'transcribed') counts.transcribed++;
    if (result === 'skipped_long') counts.skipped_long++;
    if (result === 'failed') counts.failed++;

    logger.info('Transcribe tick complete', counts);
    return { status: 'success', ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Transcribe tick failed', { error: message });
    return { status: 'error', message, ...counts };
  }
}

export async function runVectoriseTick(): Promise<VectoriseTickResult> {
  const counts = { vectorised: 0, failed: 0 };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping vectorise tick.');
    return { status: 'skipped', message: 'Neo4j not configured.', ...counts };
  }

  try {
    const transcribedIds = await pickVoiceIdsByStatus('transcribed', VECTORISE_BATCH_SIZE);
    if (transcribedIds.length === 0) {
      return { status: 'success', ...counts };
    }

    const startTime = Date.now();
    for (const voiceId of transcribedIds) {
      if (!hasTimeRemaining(startTime)) break;

      const result = await vectoriseStage(voiceId);
      if (result === 'vectorised') counts.vectorised++;
      if (result === 'failed') counts.failed++;
    }

    logger.info('Vectorise tick complete', counts);
    return { status: 'success', ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Vectorise tick failed', { error: message });
    return { status: 'error', message, ...counts };
  }
}

export async function buildVoiceVectoriseResult(
  transcribe: TranscribeTickResult,
  vectorise: VectoriseTickResult
): Promise<VoiceVectoriseResult> {
  const transcribed = transcribe.transcribed;
  const skipped_long = transcribe.skipped_long;
  const vectorised = vectorise.vectorised;
  const failed = transcribe.failed + vectorise.failed;

  const bothSkipped =
    transcribe.status === 'skipped' && vectorise.status === 'skipped';

  if (bothSkipped) {
    const emptyPipeline = await safePipelineCounts();
    return {
      status: 'skipped',
      message: transcribe.message ?? vectorise.message,
      schedule: '15min',
      transcribed,
      vectorised,
      skipped_long,
      failed,
      outstanding: 0,
      pipeline: emptyPipeline,
    };
  }

  const outstanding = await safeOutstandingCount();
  const pipelineCounts = await safePipelineCounts();
  const schedule: ScheduleHint = outstanding > 0 ? '30s' : '15min';

  const hasError = transcribe.status === 'error' || vectorise.status === 'error';
  const errorMessages = [transcribe.message, vectorise.message].filter(Boolean);

  if (hasError) {
    return {
      status: 'error',
      message: errorMessages.join('; ') || 'One or more ticks failed',
      schedule,
      transcribed,
      vectorised,
      skipped_long,
      failed,
      outstanding,
      pipeline: pipelineCounts,
    };
  }

  logger.info('Voice vectorise tick complete', {
    transcribed,
    vectorised,
    skipped_long,
    failed,
    outstanding,
    schedule,
  });

  return {
    status: 'success',
    schedule,
    transcribed,
    vectorised,
    skipped_long,
    failed,
    outstanding,
    pipeline: pipelineCounts,
  };
}

async function safePipelineCounts() {
  try {
    return await countPipelineByStatus();
  } catch {
    return { pending: 0, transcribed: 0, vectorised: 0, failed: 0, deferred_long: 0 };
  }
}

async function safeOutstandingCount() {
  try {
    return await countOutstanding();
  } catch {
    return 0;
  }
}
