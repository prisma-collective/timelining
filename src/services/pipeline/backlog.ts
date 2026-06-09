import { runDocsPageVerification } from '@/services/docs/pageVerify';
import { initDriver } from '@/lib/db/neo4j';
import type { ResolveStatus } from '@/lib/db/models/entry';
import { redis } from '@/lib/redis';
import {
  countEntriesPendingResolve,
  countResolveStatusByStatus,
} from '@/services/resolve/neo4j';
import type { ResolveStatusCounts } from '@/services/resolve/types';
import { countPagesNeedingVectorisation } from '@/services/vectorise/page/neo4j';
import {
  countOutstanding as countVoiceOutstanding,
  countPipelineByStatus,
} from '@/services/vectorise/voice/neo4j';
import type { VoicePipelineCounts } from '@/services/vectorise/voice/types';
import { INGEST_BACKLOG_QUEUE } from '@organising-config';

export type PipelineStage = 'ingest' | 'vectorise' | 'resolve';

export interface IngestBacklog {
  available: boolean;
  queueName: string;
  queued: number;
}

export interface VoiceVectoriseBacklog {
  outstanding: number;
  counts: VoicePipelineCounts;
}

export interface PageVectoriseBacklog {
  outstanding: number;
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

export interface AllEntryResolveCounts extends ResolveStatusCounts {
  total: number;
}

export interface ResolveBacklog {
  /** Entries on schema topics ready for the resolve tick (`resolveStatus = pending`, voice gate passed). */
  outstanding: number;
  /** Same counts the resolve tick reports after each run. */
  schemaTopics: ResolveStatusCounts;
  /** All Entry nodes regardless of chat topic. */
  allEntries: AllEntryResolveCounts;
}

export interface PipelineBacklogSummary {
  ingest: IngestBacklog;
  voice: VoiceVectoriseBacklog;
  page: PageVectoriseBacklog;
  docsSync: DocsSyncBacklog | null;
  resolve: ResolveBacklog;
}

export interface PipelineBacklogOptions {
  includeDocsSync?: boolean;
}

async function countAllEntriesByResolveStatus(): Promise<AllEntryResolveCounts> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)
      RETURN e.resolveStatus AS status, count(e) AS count
      `
    );

    const counts: AllEntryResolveCounts = {
      unset: 0,
      pending: 0,
      attempted: 0,
      successful: 0,
      failed: 0,
      total: 0,
    };

    for (const record of result.records) {
      const status = record.get('status') as ResolveStatus | null;
      const count = record.get('count').toNumber();
      counts.total += count;

      if (status == null) {
        counts.unset += count;
      } else if (status in counts) {
        counts[status] += count;
      }
    }

    return counts;
  } finally {
    await session.close();
  }
}

export async function getIngestBacklog(): Promise<IngestBacklog> {
  try {
    const queued = await redis.llen(INGEST_BACKLOG_QUEUE);
    return { available: true, queueName: INGEST_BACKLOG_QUEUE, queued };
  } catch {
    return { available: false, queueName: INGEST_BACKLOG_QUEUE, queued: 0 };
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

export async function getResolveBacklog(): Promise<ResolveBacklog> {
  const [outstanding, schemaTopics, allEntries] = await Promise.all([
    countEntriesPendingResolve(),
    countResolveStatusByStatus(),
    countAllEntriesByResolveStatus(),
  ]);

  return { outstanding, schemaTopics, allEntries };
}

export async function getPipelineBacklogSummary(
  options: PipelineBacklogOptions = {}
): Promise<PipelineBacklogSummary> {
  const includeDocsSync = options.includeDocsSync ?? true;

  const [ingest, voice, page, resolve, docsSync] = await Promise.all([
    getIngestBacklog(),
    getVoiceVectoriseBacklog(),
    getPageVectoriseBacklog(),
    getResolveBacklog(),
    includeDocsSync ? getDocsSyncBacklog() : Promise.resolve(null),
  ]);

  return { ingest, voice, page, docsSync, resolve };
}

export function pipelineHasBacklog(summary: PipelineBacklogSummary): boolean {
  if (summary.ingest.available && summary.ingest.queued > 0) return true;
  if (summary.voice.outstanding > 0) return true;
  if (summary.page.outstanding > 0) return true;
  if (summary.docsSync != null && summary.docsSync.needsAttention > 0) return true;
  if (summary.resolve.outstanding > 0) return true;
  if (summary.resolve.schemaTopics.attempted > 0) return true;
  if (summary.resolve.schemaTopics.unset > 0) return true;
  return false;
}

export function pipelineHasFailures(summary: PipelineBacklogSummary): boolean {
  if (summary.voice.counts.failed > 0) return true;
  if (summary.resolve.schemaTopics.failed > 0) return true;
  if (summary.resolve.allEntries.failed > 0) return true;
  return false;
}
