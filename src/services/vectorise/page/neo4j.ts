import { initDriver } from '@/lib/db/neo4j';
import neo4j from 'neo4j-driver';
import { PAGE_NEEDS_VECTORISATION_PREDICATE } from './pending';
import type { PageChunkInput, PageVectoriseSkipReason } from './types';

const DOCS_SOURCE = 'docs';

export async function pickPagesNeedingVectorisation(limit: number): Promise<string[]> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { source: $source })
      WHERE ${PAGE_NEEDS_VECTORISATION_PREDICATE}
      RETURN p.slug AS slug
      ORDER BY p.slug
      LIMIT $limit
      `,
      { source: DOCS_SOURCE, limit: neo4j.int(limit) }
    );
    return result.records.map((r) => r.get('slug') as string);
  } finally {
    await session.close();
  }
}

export async function countPagesNeedingVectorisation(): Promise<number> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { source: $source })
      WHERE ${PAGE_NEEDS_VECTORISATION_PREDICATE}
      RETURN count(p) AS count
      `,
      { source: DOCS_SOURCE }
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function markPageVectoriseSkipped(
  slug: string,
  reason: PageVectoriseSkipReason
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      SET p.vectorise_status = 'skipped',
          p.vectorise_skipped_at = datetime(),
          p.vectorise_skip_reason = $reason
      `,
      { slug, source: DOCS_SOURCE, reason }
    );
  } finally {
    await session.close();
  }
}

export async function upsertPageChunks(slug: string, chunks: PageChunkInput[]): Promise<void> {
  const chunkIds = chunks.map((c) => c.id);
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await tx.run(
        `
        MATCH (p:Page { slug: $slug, source: $source })
        OPTIONAL MATCH (p)-[r:HAS_CHUNK]->(old:PageChunk)
        WHERE NOT old.id IN $chunkIds
        DELETE r, old
        `,
        { slug, source: DOCS_SOURCE, chunkIds }
      );

      for (const chunk of chunks) {
        await tx.run(
          `
          MERGE (c:PageChunk:IndexedChunk { id: $id })
          SET c.content = $content,
              c.embedding = $embedding,
              c.chunk_index = $chunk_index,
              c.token_count = $token_count
          WITH c
          MATCH (p:Page { slug: $slug, source: $source })
          MERGE (p)-[:HAS_CHUNK]->(c)
          `,
          {
            slug,
            source: DOCS_SOURCE,
            id: chunk.id,
            content: chunk.content,
            embedding: chunk.embedding,
            chunk_index: chunk.chunk_index,
            token_count: chunk.token_count,
          }
        );
      }
    });
  } finally {
    await session.close();
  }
}

export async function markPageVectorised(slug: string): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      SET p.embeddings_updated_at = datetime()
      REMOVE p.vectorise_status, p.vectorise_skipped_at, p.vectorise_skip_reason
      `,
      { slug, source: DOCS_SOURCE }
    );
  } finally {
    await session.close();
  }
}
