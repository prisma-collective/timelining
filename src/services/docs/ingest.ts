import { isNeo4jAvailable } from '@/lib/db/neo4j';
import type { DocsIngestResult, DocsIngestStats } from '@/lib/db/models/page';
import { logger } from '@/lib/logger';
import { fetchDocsSnapshot } from './client';
import { isDocsChecksumCurrent } from './pageVerify';
import {
  getDocsPageChecksums,
  syncDocsPagesFromSnapshotBatch,
  writeDocsIngestRun,
} from './pageService';
import { initDriver } from '@/lib/db/neo4j';

export interface RunDocsIngestOptions {
  cursor?: number;
  batchSize?: number;
}

interface IngestBatchPlan {
  batch: Awaited<ReturnType<typeof fetchDocsSnapshot>>;
  start: number;
  end: number;
  batchSize: number;
  totalPages: number;
}

const DEFAULT_INGEST_BATCH_SIZE = 20;

function parseBatchSize(batchSize?: number): number {
  if (typeof batchSize === 'number' && Number.isFinite(batchSize) && batchSize > 0) {
    return Math.max(1, Math.floor(batchSize));
  }

  const envBatch = Number.parseInt(process.env.DOCS_INGEST_BATCH_SIZE ?? '', 10);
  if (Number.isFinite(envBatch) && envBatch > 0) {
    return Math.max(1, envBatch);
  }

  return DEFAULT_INGEST_BATCH_SIZE;
}

function planIngestBatch(
  pages: Awaited<ReturnType<typeof fetchDocsSnapshot>>,
  options: RunDocsIngestOptions
): IngestBatchPlan {
  const sortedPages = [...pages].sort((a, b) => a.slug.localeCompare(b.slug));
  const batchSize = parseBatchSize(options.batchSize);
  const totalPages = sortedPages.length;
  const safeCursor =
    typeof options.cursor === 'number' && Number.isFinite(options.cursor) && options.cursor > 0
      ? Math.floor(options.cursor)
      : 0;
  const start = Math.min(safeCursor, totalPages);
  const end = Math.min(start + batchSize, totalPages);

  return {
    batch: sortedPages.slice(start, end),
    start,
    end,
    batchSize,
    totalPages,
  };
}

function createEmptyStats(): DocsIngestStats {
  return {
    pages_checked: 0,
    pages_updated: 0,
    pages_created: 0,
  };
}

export async function runDocsIngest(options: RunDocsIngestOptions = {}): Promise<DocsIngestResult> {
  const emptyStats = createEmptyStats();

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Skipping docs ingest.');
    return {
      status: 'skipped',
      message: 'Neo4j not configured.',
      stats: emptyStats,
    };
  }

  try {
    const batchPlan = planIngestBatch(await fetchDocsSnapshot(), options);
    const { batch, batchSize, end, start, totalPages } = batchPlan;

    const stats: DocsIngestStats = {
      pages_checked: batch.length,
      pages_updated: 0,
      pages_created: 0,
    };

    const driver = await initDriver();
    const session = driver.session({ database: 'neo4j' });

    try {
      const existingChecksums = await getDocsPageChecksums(
        batch.map((page) => page.slug),
        session
      );
      const pagesToSync = [];

      for (const page of batch) {
        const existingChecksum = existingChecksums.get(page.slug) ?? null;

        if (isDocsChecksumCurrent(existingChecksum, page.checksum)) {
          continue;
        }

        const isNew = existingChecksum === null;
        pagesToSync.push(page);

        if (isNew) {
          stats.pages_created += 1;
        } else {
          stats.pages_updated += 1;
        }
      }

      await syncDocsPagesFromSnapshotBatch(pagesToSync, session);
      const ingestRunId = await writeDocsIngestRun(stats, session);
      logger.info('Docs ingest complete', {
        stats,
        ingestRunId,
        batchSize,
        cursor: start,
        pagesSynced: pagesToSync.length,
      });

      const hasMore = end < totalPages;

      return {
        status: 'success',
        stats,
        ingestRunId,
        hasMore,
        nextCursor: hasMore ? end : undefined,
        totalPages,
        processedPages: batch.length,
      };
    } finally {
      await session.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Docs ingest failed', { error: message });
    return {
      status: 'error',
      message,
      stats: emptyStats,
    };
  }
}
