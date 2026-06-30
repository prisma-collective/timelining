import { runDocsPageVerification } from '@/services/docs/pageVerify';
import { redis } from '@/lib/redis';
import { countPagesNeedingVectorisation } from '@/services/vectorise/page/neo4j';
import {
  countOutstanding as countResourceOutstanding,
  countPipelineByStatus as countResourcePipelineByStatus,
} from '@/services/vectorise/resource/neo4j';
import type { ResourcePipelineCounts } from '@/services/vectorise/resource/types';
import {
  countOutstanding as countVoiceOutstanding,
  countPipelineByStatus,
} from '@/services/vectorise/voice/neo4j';
import type { VoicePipelineCounts } from '@/services/vectorise/voice/types';
import {
  INGEST_BACKLOG_QUEUE,
  INGEST_FAILED_QUEUE,
  RESOLVE_FAILED_QUEUE,
  TRANSCRIBE_FAILED_QUEUE,
} from '@organising-config';
import { getFailedQueueCounts } from './failed-queue';

export type PipelineStage = 'ingest' | 'vectorise';

export interface IngestBacklog {
  available: boolean;
  queueName: string;
  queued: number;
  failed: number;
}

export interface VoiceVectoriseBacklog {
  outstanding: number;
  counts: VoicePipelineCounts;
}

export interface PageVectoriseBacklog {
  outstanding: number;
}

export interface ResourceVectoriseBacklog {
  outstanding: number;
  counts: import('@/services/vectorise/resource/types').ResourcePipelineCounts;
}

export interface DocsSyncBacklog {
  totalPages: number;
  fullySynced: number;
  needsAttention: number;
  staleChecksum: number;
  missingFromNeo4j: number;
  noChunks: number;
  pendingVectorise: number;
}

export interface FailedQueuesBacklog {
  ingest: number;
  transcribe: number;
  resolve: number;
}

export interface PipelineBacklogSummary {
  ingest: IngestBacklog;
  voice: VoiceVectoriseBacklog;
  page: PageVectoriseBacklog;
  resource: ResourceVectoriseBacklog;
  docsSync: DocsSyncBacklog | null;
  failedQueues: FailedQueuesBacklog;
}

export interface PipelineBacklogOptions {
  includeDocsSync?: boolean;
}

export async function getIngestBacklog(): Promise<IngestBacklog> {
  try {
    const [queued, failedCounts] = await Promise.all([
      redis.llen(INGEST_BACKLOG_QUEUE),
      getFailedQueueCounts(),
    ]);
    return {
      available: true,
      queueName: INGEST_BACKLOG_QUEUE,
      queued,
      failed: failedCounts.ingest,
    };
  } catch {
    return { available: false, queueName: INGEST_BACKLOG_QUEUE, queued: 0, failed: 0 };
  }
}

export async function getFailedQueuesBacklog(): Promise<FailedQueuesBacklog> {
  try {
    return await getFailedQueueCounts();
  } catch {
    return { ingest: 0, transcribe: 0, resolve: 0 };
  }
}

export async function getVoiceVectoriseBacklog(): Promise<VoiceVectoriseBacklog> {
  const [outstanding, counts] = await Promise.all([
    countVoiceOutstanding(),
    countPipelineByStatus(),
  ]);
  return { outstanding, counts };
}

export async function getPageVectoriseBacklog(): Promise<PageVectoriseBacklog> {
  const outstanding = await countPagesNeedingVectorisation();
  return { outstanding };
}

export async function getResourceVectoriseBacklog(): Promise<ResourceVectoriseBacklog> {
  const [outstanding, counts] = await Promise.all([
    countResourceOutstanding(),
    countResourcePipelineByStatus(),
  ]);
  return { outstanding, counts };
}

export async function getDocsSyncBacklog(): Promise<DocsSyncBacklog | null> {
  if (!process.env.DOCS_APP_URL?.trim()) {
    return null;
  }

  const report = await runDocsPageVerification();
  const { summary } = report;

  return {
    totalPages: summary.totalPages,
    fullySynced: summary.fullySynced,
    needsAttention: summary.needsAttention,
    staleChecksum: summary.staleChecksum,
    missingFromNeo4j: summary.missingFromNeo4j,
    noChunks: summary.noChunks,
    pendingVectorise: summary.pendingVectorise,
  };
}

export async function getPipelineBacklogSummary(
  options: PipelineBacklogOptions = {}
): Promise<PipelineBacklogSummary> {
  const includeDocsSync = options.includeDocsSync ?? true;

  const [ingest, voice, page, resource, docsSync, failedQueues] = await Promise.all([
    getIngestBacklog(),
    getVoiceVectoriseBacklog(),
    getPageVectoriseBacklog(),
    getResourceVectoriseBacklog(),
    includeDocsSync ? getDocsSyncBacklog() : Promise.resolve(null),
    getFailedQueuesBacklog(),
  ]);

  return { ingest, voice, page, resource, docsSync, failedQueues };
}

export function pipelineHasBacklog(summary: PipelineBacklogSummary): boolean {
  if (summary.ingest.available && summary.ingest.queued > 0) return true;
  if (summary.ingest.failed > 0) return true;
  if (summary.failedQueues.transcribe > 0 || summary.failedQueues.resolve > 0) return true;
  if (summary.voice.outstanding > 0) return true;
  if (summary.page.outstanding > 0) return true;
  if (summary.resource.outstanding > 0) return true;
  if (summary.docsSync != null && summary.docsSync.needsAttention > 0) return true;
  return false;
}

export function pipelineHasFailures(summary: PipelineBacklogSummary): boolean {
  if (summary.ingest.failed > 0) return true;
  if (summary.failedQueues.transcribe > 0 || summary.failedQueues.resolve > 0) return true;
  if (summary.voice.counts.failed > 0) return true;
  if (summary.resource.counts.failed > 0) return true;
  return false;
}

export {
  INGEST_FAILED_QUEUE,
  TRANSCRIBE_FAILED_QUEUE,
  RESOLVE_FAILED_QUEUE,
};
