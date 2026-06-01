import neo4j, { Driver } from 'neo4j-driver';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  CHUNK_VECTOR_DIMENSIONS,
  CHUNK_VECTOR_INDEX_LABEL,
  CHUNK_VECTOR_INDEX_NAME,
  CHUNK_VECTOR_PROPERTY,
  CHUNK_VECTOR_SIMILARITY,
  LEGACY_VOICE_VECTOR_INDEX_NAME,
} from '../../src/lib/db/vectorIndex';
import {
  createNeo4jDriver,
  isIndexAlreadyExistsError,
} from './env';

const rawArgv = hideBin(process.argv);
const argv = yargs(rawArgv)
  .option('recreate', {
    type: 'boolean',
    default: false,
    describe: 'Drop legacy and unified indexes, then create the unified index',
  })
  .help()
  .parseSync();
const recreate = argv.recreate || rawArgv.includes('--recreate');

// #region agent log
fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '9f51fa' },
  body: JSON.stringify({
    sessionId: '9f51fa',
    location: 'vector-index-create.ts:argv',
    message: 'parsed create argv',
    data: { rawArgv, recreateFlag: argv.recreate, recreateEffective: recreate },
    timestamp: Date.now(),
    hypothesisId: 'A',
  }),
}).catch(() => {});
// #endregion

async function dropIndex(driver: Driver, indexName: string): Promise<void> {
  const session = driver.session({ database: 'neo4j' });
  try {
    await session.run(`DROP INDEX \`${indexName}\` IF EXISTS`);
    console.log(`Dropped vector index: ${indexName}`);
  } finally {
    await session.close();
  }
}

async function createChunkVectorIndex(driver: Driver): Promise<void> {
  const session = driver.session({ database: 'neo4j' });
  try {
    await session.run(
      `
      CALL db.index.vector.createNodeIndex(
        $indexName,
        $nodeLabel,
        $propertyName,
        $dimensions,
        $similarityFunction
      )
      `,
      {
        indexName: CHUNK_VECTOR_INDEX_NAME,
        nodeLabel: CHUNK_VECTOR_INDEX_LABEL,
        propertyName: CHUNK_VECTOR_PROPERTY,
        dimensions: neo4j.int(CHUNK_VECTOR_DIMENSIONS),
        similarityFunction: CHUNK_VECTOR_SIMILARITY,
      }
    );
    console.log(`Vector index '${CHUNK_VECTOR_INDEX_NAME}' created successfully.`);
  } finally {
    await session.close();
  }
}

async function verifyIndex(driver: Driver): Promise<boolean> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const result = await session.run(
      `
      SHOW INDEXES
      YIELD name, type, labelsOrTypes, properties
      WHERE name = $indexName
      RETURN name, type, labelsOrTypes, properties
      `,
      { indexName: CHUNK_VECTOR_INDEX_NAME }
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const driver = await createNeo4jDriver();

  try {
    if (recreate) {
      await dropIndex(driver, LEGACY_VOICE_VECTOR_INDEX_NAME);
      await dropIndex(driver, CHUNK_VECTOR_INDEX_NAME);
    }

    try {
      await createChunkVectorIndex(driver);
    } catch (error) {
      if (!recreate && isIndexAlreadyExistsError(error)) {
        console.log(
          `Vector index '${CHUNK_VECTOR_INDEX_NAME}' already exists. No changes made.`
        );
      } else {
        throw error;
      }
    }

    const exists = await verifyIndex(driver);
    if (exists) {
      console.log(`Verified index '${CHUNK_VECTOR_INDEX_NAME}' is present.`);
    } else {
      console.warn(`Index '${CHUNK_VECTOR_INDEX_NAME}' was not found after creation.`);
      process.exit(1);
    }
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Failed to create vector index:', message);
  process.exit(1);
});
