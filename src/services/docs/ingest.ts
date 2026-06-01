import { isNeo4jAvailable } from '@/lib/db/neo4j';
import type { DocsIngestResult, DocsIngestStats } from '@/lib/db/models/page';
import { logger } from '@/lib/logger';
import { fetchDocsSnapshot } from './client';
import { isDocsChecksumCurrent } from './pageVerify';
import { getDocsPageChecksum, syncDocsPageFromSnapshot, writeDocsIngestRun } from './pageService';

export async function runDocsIngest(): Promise<DocsIngestResult> {
  const emptyStats: DocsIngestStats = {
    pages_checked: 0,
    pages_updated: 0,
    pages_created: 0,
  };

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
    const pages = await fetchDocsSnapshot();
    const stats: DocsIngestStats = {
      pages_checked: pages.length,
      pages_updated: 0,
      pages_created: 0,
    };

    for (const page of pages) {
      const existingChecksum = await getDocsPageChecksum(page.slug);

      if (isDocsChecksumCurrent(existingChecksum, page.checksum)) {
        continue;
      }

      const isNew = existingChecksum === null;
      await syncDocsPageFromSnapshot(page);

      if (isNew) {
        stats.pages_created += 1;
      } else {
        stats.pages_updated += 1;
      }
    }

    const ingestRunId = await writeDocsIngestRun(stats);
    logger.info('Docs ingest complete', { stats, ingestRunId });

    return {
      status: 'success',
      stats,
      ingestRunId,
    };
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
