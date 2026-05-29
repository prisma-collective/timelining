import { logger } from '@/lib/logger';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import {
  countOutstanding,
  countPipelineByStatus,
  pickVoiceIdsByStatus,
} from './neo4j';
import { transcribeStage } from './transcribe';
import { vectoriseStage } from './vectorise';
import {
  EXECUTION_TIMEOUT_MS,
  VECTORISE_BATCH_SIZE,
  type ScheduleHint,
  type VoiceVectoriseResult,
} from './types';

export async function runVoiceVectorise(): Promise<VoiceVectoriseResult> {
  const startTime = Date.now();
  const pipeline = {
    transcribed: 0,
    vectorised: 0,
    skipped_long: 0,
    failed: 0,
  };

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping voice vectorise.');
    const emptyPipeline = await safePipelineCounts();
    return {
      status: 'skipped',
      message: 'Neo4j not configured.',
      schedule: '15min',
      transcribed: 0,
      vectorised: 0,
      skipped_long: 0,
      failed: 0,
      outstanding: 0,
      pipeline: emptyPipeline,
    };
  }

  try {
    const pendingIds = await pickVoiceIdsByStatus('pending', 1);
    if (pendingIds.length > 0 && hasTimeRemaining(startTime)) {
      const result = await transcribeStage(pendingIds[0]);
      if (result === 'transcribed') pipeline.transcribed++;
      if (result === 'skipped_long') pipeline.skipped_long++;
      if (result === 'failed') pipeline.failed++;
    }

    const transcribedIds = await pickVoiceIdsByStatus('transcribed', VECTORISE_BATCH_SIZE);
    for (const voiceId of transcribedIds) {
      if (!hasTimeRemaining(startTime)) break;

      const result = await vectoriseStage(voiceId);
      if (result === 'vectorised') pipeline.vectorised++;
      if (result === 'failed') pipeline.failed++;
    }

    const outstanding = await countOutstanding();
    const pipelineCounts = await countPipelineByStatus();
    const schedule: ScheduleHint = outstanding > 0 ? '30s' : '15min';

    logger.info('Voice vectorise tick complete', { ...pipeline, outstanding, schedule });

    return {
      status: 'success',
      schedule,
      outstanding,
      pipeline: pipelineCounts,
      ...pipeline,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Voice vectorise execution failed', { error: message });
    const pipelineCounts = await safePipelineCounts();
    const outstanding = await safeOutstandingCount();

    return {
      status: 'error',
      message,
      schedule: outstanding > 0 ? '30s' : '15min',
      outstanding,
      pipeline: pipelineCounts,
      transcribed: pipeline.transcribed,
      vectorised: pipeline.vectorised,
      skipped_long: pipeline.skipped_long,
      failed: pipeline.failed,
    };
  }
}

function hasTimeRemaining(startTime: number): boolean {
  return Date.now() - startTime < EXECUTION_TIMEOUT_MS;
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
