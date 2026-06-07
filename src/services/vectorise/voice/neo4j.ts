import { initDriver } from '@/lib/db/neo4j';
import neo4j from 'neo4j-driver';
import { mapVoiceNode } from '@/lib/db/mappers';
import type {
  VoiceFailedStage,
  VoiceNode,
  VoiceProcessingStatus,
} from '@/lib/db/models/entry';
import type { VoiceChunkInput, VoicePipelineCounts } from './types';
import { MAX_RETRIES } from './types';

export async function pickVoiceIdsByStatus(
  status: VoiceProcessingStatus,
  limit: number
): Promise<string[]> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (v:Voice)
      WHERE coalesce(v.processingStatus, 'pending') = $status
      RETURN v.id AS id
      ORDER BY v.id
      LIMIT $limit
      `,
      { status, limit: neo4j.int(limit) }
    );
    return result.records.map((r) => r.get('id') as string);
  } finally {
    await session.close();
  }
}

export async function loadVoiceById(voiceId: string): Promise<VoiceNode | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `MATCH (v:Voice {id: $voiceId}) RETURN v`,
      { voiceId }
    );
    if (result.records.length === 0) return null;
    return mapVoiceNode(result.records[0].get('v'));
  } finally {
    await session.close();
  }
}

export async function markDeferredLong(voiceId: string): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (v:Voice {id: $voiceId})
      SET v.processingStatus = 'deferred_long',
          v.retryCount = 0,
          v.failedStage = NULL
      `,
      { voiceId }
    );
  } finally {
    await session.close();
  }
}

export async function loadEntryTopicForVoice(
  voiceId: string
): Promise<{ entryId: string; topic: string | null } | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)-[:HAS_VOICE]->(v:Voice {id: $voiceId})
      MATCH (e)-[:FROM_CHAT]->(c:TelegramChat)
      RETURN e.id AS entryId, c.topic AS topic
      `,
      { voiceId }
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    return {
      entryId: record.get('entryId') as string,
      topic: record.get('topic') as string | null,
    };
  } finally {
    await session.close();
  }
}

export async function markTranscribed(voiceId: string, transcription: string): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (v:Voice {id: $voiceId})
      SET v.transcription = $transcription,
          v.processingStatus = 'transcribed',
          v.retryCount = 0,
          v.failedStage = NULL
      `,
      { voiceId, transcription }
    );
  } finally {
    await session.close();
  }
}

export async function markVectorised(
  voiceId: string,
  chunkInputs: VoiceChunkInput[]
): Promise<void> {
  const chunks = chunkInputs.map((c) => c.chunk_text);
  const embeddings = chunkInputs.map((c) => c.embedding);

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await tx.run(
        `
        MATCH (v:Voice {id: $voiceId})
        OPTIONAL MATCH (v)-[r:HAS_CHUNK]->(old:VoiceChunk)
        DELETE r, old
        WITH v
        UNWIND range(0, size($chunks) - 1) AS i
        CREATE (c:VoiceChunk:IndexedChunk {
          id: randomUUID(),
          chunk_text: $chunks[i],
          embedding: $embeddings[i]
        })
        MERGE (v)-[:HAS_CHUNK]->(c)
        SET v.processingStatus = 'vectorised',
            v.retryCount = 0,
            v.failedStage = NULL
        `,
        { voiceId, chunks, embeddings }
      );
    });
  } finally {
    await session.close();
  }
}

export async function recordStageFailure(
  voiceId: string,
  stage: VoiceFailedStage
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (v:Voice {id: $voiceId})
      SET v.retryCount = coalesce(v.retryCount, 0) + 1
      WITH v
      SET v.processingStatus = CASE
            WHEN v.retryCount >= $maxRetries THEN 'failed'
            ELSE v.processingStatus
          END,
          v.failedStage = CASE
            WHEN v.retryCount >= $maxRetries THEN $stage
            ELSE v.failedStage
          END
      `,
      { voiceId, stage, maxRetries: MAX_RETRIES }
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
      MATCH (v:Voice)
      WHERE coalesce(v.processingStatus, 'pending') IN ['pending', 'transcribed']
      RETURN count(v) AS count
      `
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function countPipelineByStatus(): Promise<VoicePipelineCounts> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (v:Voice)
      RETURN coalesce(v.processingStatus, 'pending') AS status, count(v) AS count
      `
    );

    const counts: VoicePipelineCounts = {
      pending: 0,
      transcribed: 0,
      vectorised: 0,
      failed: 0,
      deferred_long: 0,
    };

    for (const record of result.records) {
      const status = record.get('status') as keyof VoicePipelineCounts;
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
