import { CHUNK_VECTOR_INDEX_LABEL } from '../../src/lib/db/vectorIndex';
import { createNeo4jDriver } from './env';

async function labelChunks(
  driver: Awaited<ReturnType<typeof createNeo4jDriver>>,
  primaryLabel: 'VoiceChunk' | 'PageChunk'
): Promise<{ labeled: number; total: number }> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const totalResult = await session.run(
      `
      MATCH (c:${primaryLabel})
      WHERE c.embedding IS NOT NULL
      RETURN count(c) AS total
      `
    );
    const total = totalResult.records[0].get('total').toNumber();

    const labelResult = await session.run(
      `
      MATCH (c:${primaryLabel})
      WHERE c.embedding IS NOT NULL AND NOT c:${CHUNK_VECTOR_INDEX_LABEL}
      SET c:${CHUNK_VECTOR_INDEX_LABEL}
      RETURN count(c) AS labeled
      `
    );
    const labeled = labelResult.records[0].get('labeled').toNumber();

    return { labeled, total };
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const driver = await createNeo4jDriver();

  try {
    const voice = await labelChunks(driver, 'VoiceChunk');
    const page = await labelChunks(driver, 'PageChunk');

    console.log('\nBackfill summary');
    console.log('────────────────────────────────────────────');
    console.log(
      `VoiceChunk: ${voice.total} with embedding, ${voice.labeled} newly labeled :${CHUNK_VECTOR_INDEX_LABEL}`
    );
    console.log(
      `PageChunk:  ${page.total} with embedding, ${page.labeled} newly labeled :${CHUNK_VECTOR_INDEX_LABEL}`
    );
    console.log('────────────────────────────────────────────');

    if (voice.labeled + page.labeled === 0) {
      console.log('Nothing to backfill — all chunks already labeled.');
    } else {
      console.log(
        `Labeled ${voice.labeled + page.labeled} chunk(s). Run db:vector-index:create if the index is missing.`
      );
    }
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Backfill failed:', message);
  process.exit(1);
});
