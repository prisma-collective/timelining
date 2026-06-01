import { initDriver } from '@/lib/db/neo4j';
import type { PageSnapshotEntry } from '@/lib/db/models/page';
import type { DateTime, Integer } from 'neo4j-driver';
import { fetchDocsSnapshot } from './client';

const DOCS_SOURCE = 'docs';

export interface DocsPageNeo4jState {
  slug: string;
  checksum: string | null;
  chunkCount: number;
  embeddingsUpdatedAt: DateTime | null;
  lastModified: DateTime | null;
}

export type PageVerifyLineStatus = 'ok' | 'warn' | 'fail';

export interface PageVerifyLine {
  slug: string;
  status: PageVerifyLineStatus;
  nodePresent: boolean;
  checksumCurrent: boolean;
  chunkCount: number;
  vectorisePending: boolean;
}

export interface PageVerifySummary {
  totalPages: number;
  fullySynced: number;
  staleChecksum: number;
  missingFromNeo4j: number;
  noChunks: number;
  pendingVectorise: number;
  needsAttention: number;
}

export interface PageVerifyReport {
  lines: PageVerifyLine[];
  summary: PageVerifySummary;
}

/** Same skip condition as docs ingest when comparing stored vs snapshot checksum. */
export function isDocsChecksumCurrent(
  neo4jChecksum: string | null,
  snapshotChecksum: string
): boolean {
  return neo4jChecksum === snapshotChecksum;
}

/** Same predicate as pickPagesNeedingVectorisation in vectorise/page/neo4j.ts. */
export function isVectorisePending(
  embeddingsUpdatedAt: DateTime | null,
  lastModified: DateTime | null
): boolean {
  if (embeddingsUpdatedAt == null) return true;
  if (lastModified == null) return false;
  return embeddingsUpdatedAt < lastModified;
}

function toDateTime(value: unknown): DateTime | null {
  if (value == null) return null;
  if (typeof value === 'object' && value !== null && 'year' in value) {
    return value as DateTime;
  }
  return null;
}

export async function fetchDocsPagesNeo4jState(): Promise<Map<string, DocsPageNeo4jState>> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { source: $source })
      OPTIONAL MATCH (p)-[:HAS_CHUNK]->(c:PageChunk)
      RETURN p.slug AS slug,
             p.checksum AS checksum,
             p.last_modified AS last_modified,
             p.embeddings_updated_at AS embeddings_updated_at,
             count(c) AS chunk_count
      `,
      { source: DOCS_SOURCE }
    );

    const map = new Map<string, DocsPageNeo4jState>();
    for (const record of result.records) {
      const slug = record.get('slug') as string;
      const checksum = record.get('checksum');
      const chunkCountRaw = record.get('chunk_count') as Integer;
      map.set(slug, {
        slug,
        checksum: typeof checksum === 'string' ? checksum : null,
        chunkCount: chunkCountRaw.toNumber(),
        embeddingsUpdatedAt: toDateTime(record.get('embeddings_updated_at')),
        lastModified: toDateTime(record.get('last_modified')),
      });
    }
    return map;
  } finally {
    await session.close();
  }
}

function evaluatePage(
  entry: PageSnapshotEntry,
  neo4jState: DocsPageNeo4jState | undefined
): PageVerifyLine {
  if (!neo4jState) {
    return {
      slug: entry.slug,
      status: 'fail',
      nodePresent: false,
      checksumCurrent: false,
      chunkCount: 0,
      vectorisePending: false,
    };
  }

  const checksumCurrent = isDocsChecksumCurrent(neo4jState.checksum, entry.checksum);
  const vectorisePending = isVectorisePending(
    neo4jState.embeddingsUpdatedAt,
    neo4jState.lastModified
  );
  const chunkCount = neo4jState.chunkCount;

  const fullySynced = checksumCurrent && chunkCount > 0 && !vectorisePending;

  return {
    slug: entry.slug,
    status: fullySynced ? 'ok' : 'warn',
    nodePresent: true,
    checksumCurrent,
    chunkCount,
    vectorisePending,
  };
}

export async function runDocsPageVerification(): Promise<PageVerifyReport> {
  const snapshot = await fetchDocsSnapshot();
  const neo4jStates = await fetchDocsPagesNeo4jState();

  const sorted = [...snapshot].sort((a, b) => a.slug.localeCompare(b.slug));
  const lines: PageVerifyLine[] = [];

  let fullySynced = 0;
  let staleChecksum = 0;
  let missingFromNeo4j = 0;
  let noChunks = 0;
  let pendingVectorise = 0;

  for (const entry of sorted) {
    const line = evaluatePage(entry, neo4jStates.get(entry.slug));
    lines.push(line);

    if (!line.nodePresent) {
      missingFromNeo4j++;
    } else {
      if (!line.checksumCurrent) staleChecksum++;
      if (line.chunkCount === 0) noChunks++;
      if (line.vectorisePending) pendingVectorise++;
      if (line.status === 'ok') fullySynced++;
    }
  }

  const totalPages = sorted.length;

  return {
    lines,
    summary: {
      totalPages,
      fullySynced,
      staleChecksum,
      missingFromNeo4j,
      noChunks,
      pendingVectorise,
      needsAttention: totalPages - fullySynced,
    },
  };
}
