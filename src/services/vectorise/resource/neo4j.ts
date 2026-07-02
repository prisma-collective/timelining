import { initDriver } from '@/lib/db/neo4j';
import neo4j from 'neo4j-driver';
import type {
  ResourceFailedStage,
  ResourceNode,
  ResourceProcessingStatus,
} from '@/lib/db/models/resource';
import { buildStageFailureCypher, MAX_RETRIES } from '../shared/pipelineStatus';
import { YOUTUBE_ELIGIBLE_WHERE } from './eligibility';
import type { ResourcePipelineCounts, ResourceUnvectorisedChunk } from './types';

function mapResourceNode(node: { properties: Record<string, unknown> }): ResourceNode {
  const props = node.properties;
  return {
    id: props.id as string,
    url: props.url as string,
    youtubeVideoId: props.youtubeVideoId as string,
    sourceKind: 'youtube',
    transcription: (props.transcription as string | undefined) ?? undefined,
    processingStatus: (props.processingStatus ?? 'pending') as ResourceProcessingStatus,
    retryCount: Number(props.retryCount ?? 0),
    failedStage: props.failedStage as ResourceFailedStage | undefined,
  };
}

export async function pickResourceIdsByStatus(
  status: ResourceProcessingStatus,
  limit: number
): Promise<string[]> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource)
      WHERE ${YOUTUBE_ELIGIBLE_WHERE}
        AND coalesce(r.processingStatus, 'pending') = $status
      RETURN r.id AS id
      ORDER BY r.id
      LIMIT $limit
      `,
      { status, limit: neo4j.int(limit) }
    );
    return result.records.map((r) => r.get('id') as string);
  } finally {
    await session.close();
  }
}

export async function loadResourceById(resourceId: string): Promise<ResourceNode | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(`MATCH (r:Resource {id: $resourceId}) RETURN r`, {
      resourceId,
    });
    if (result.records.length === 0) return null;
    return mapResourceNode(result.records[0].get('r'));
  } finally {
    await session.close();
  }
}

export async function markChunked(resourceId: string, chunks: string[]): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await tx.run(
        `
        MATCH (r:Resource {id: $resourceId})
        OPTIONAL MATCH (r)-[rel:HAS_CHUNK]->(old:ResourceChunk)
        DELETE rel, old
        WITH r
        UNWIND range(0, size($chunks) - 1) AS i
        CREATE (c:ResourceChunk {
          id: randomUUID(),
          chunk_text: $chunks[i],
          chunk_index: i,
          vectorised: false
        })
        MERGE (r)-[:HAS_CHUNK]->(c)
        SET r.processingStatus = 'chunked',
            r.retryCount = 0,
            r.failedStage = NULL
        `,
        { resourceId, chunks }
      );
    });
  } finally {
    await session.close();
  }
}

export async function pickUnvectorisedChunks(
  resourceId: string,
  limit: number
): Promise<ResourceUnvectorisedChunk[]> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $resourceId})-[:HAS_CHUNK]->(c:ResourceChunk)
      WHERE coalesce(c.vectorised, false) = false
      RETURN c.id AS id, c.chunk_text AS chunk_text, c.chunk_index AS chunk_index
      ORDER BY c.chunk_index
      LIMIT $limit
      `,
      { resourceId, limit: neo4j.int(limit) }
    );

    return result.records.map((record) => ({
      id: record.get('id') as string,
      chunk_text: record.get('chunk_text') as string,
      chunk_index: record.get('chunk_index').toNumber(),
    }));
  } finally {
    await session.close();
  }
}

export async function countUnvectorisedChunks(resourceId: string): Promise<number> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $resourceId})-[:HAS_CHUNK]->(c:ResourceChunk)
      WHERE coalesce(c.vectorised, false) = false
      RETURN count(c) AS count
      `,
      { resourceId }
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function markChunksVectorised(
  chunkIds: string[],
  embeddings: number[][]
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      for (let i = 0; i < chunkIds.length; i += 1) {
        await tx.run(
          `
          MATCH (c:ResourceChunk {id: $chunkId})
          SET c.embedding = $embedding,
              c.vectorised = true
          SET c:IndexedChunk
          `,
          { chunkId: chunkIds[i], embedding: embeddings[i] }
        );
      }
    });
  } finally {
    await session.close();
  }
}

export async function markResourceVectorisedIfComplete(resourceId: string): Promise<boolean> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $resourceId})
      OPTIONAL MATCH (r)-[:HAS_CHUNK]->(c:ResourceChunk)
      WHERE coalesce(c.vectorised, false) = false
      WITH r, count(c) AS pending
      WHERE pending = 0
      SET r.processingStatus = 'vectorised',
          r.retryCount = 0,
          r.failedStage = NULL
      RETURN r.id AS id
      `,
      { resourceId }
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

export async function recordStageFailure(
  resourceId: string,
  stage: ResourceFailedStage
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      buildStageFailureCypher({
        nodeLabel: 'Resource',
        idParam: 'id',
        id: resourceId,
        stage,
      }),
      { id: resourceId, stage, maxRetries: MAX_RETRIES }
    );
  } finally {
    await session.close();
  }
}

export async function countOutstanding(): Promise<number> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource)
      WHERE ${YOUTUBE_ELIGIBLE_WHERE}
        AND coalesce(r.processingStatus, 'pending') IN ['transcribed', 'chunked']
      RETURN count(r) AS count
      `
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function countPipelineByStatus(): Promise<ResourcePipelineCounts> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (r:Resource)
      WHERE ${YOUTUBE_ELIGIBLE_WHERE}
      RETURN coalesce(r.processingStatus, 'pending') AS status, count(r) AS count
      `
    );

    const counts: ResourcePipelineCounts = {
      pending: 0,
      transcribed: 0,
      chunked: 0,
      vectorised: 0,
      failed: 0,
    };

    for (const record of result.records) {
      const status = record.get('status') as keyof ResourcePipelineCounts;
      const count = record.get('count').toNumber();
      if (status in counts) {
        counts[status] = count;
      }
    }

    return counts;
  } finally {
    await session.close();
  }
}
