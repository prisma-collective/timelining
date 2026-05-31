import dotenv from 'dotenv';
import neo4j, { Driver } from 'neo4j-driver';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const INDEX_NAME = 'voice-vector-index';
const NODE_LABEL = 'VoiceChunk';
const PROPERTY_NAME = 'embedding';
const DIMENSIONS = 3072;
const SIMILARITY_FUNCTION = 'cosine';

const argv = yargs(hideBin(process.argv))
  .option('recreate', {
    type: 'boolean',
    default: false,
    describe: 'Drop the index first, then create it (notebook flow)',
  })
  .help()
  .parseSync();

function resolveCredentials() {
  const uri = process.env.NEO4J_URI ?? process.env.RAILWAY_NEO4J_ENDPOINT;
  const user = process.env.NEO4J_USERNAME ?? process.env.NEO4J_USER ?? 'neo4j';
  const password =
    process.env.NEO4J_PASSWORD ?? process.env.RAILWAY_NEO4J_DB_PASSWORD;

  if (!uri) {
    throw new Error(
      'Missing Neo4j URI. Set NEO4J_URI or RAILWAY_NEO4J_ENDPOINT in .env.local'
    );
  }
  if (!password) {
    throw new Error(
      'Missing Neo4j password. Set NEO4J_PASSWORD or RAILWAY_NEO4J_DB_PASSWORD in .env.local'
    );
  }

  return { uri, user, password };
}

function formatUriForLog(uri: string): string {
  try {
    const parsed = new URL(uri.replace(/^bolt(\+s)?:\/\//, 'http://'));
    return `${parsed.hostname}:${parsed.port || '7687'}`;
  } catch {
    return uri;
  }
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('equivalent index already exists')
  );
}

async function dropVectorIndex(driver: Driver): Promise<void> {
  const session = driver.session({ database: 'neo4j' });
  try {
    await session.run(`DROP INDEX \`${INDEX_NAME}\` IF EXISTS`);
    console.log(`Dropped vector index: ${INDEX_NAME}`);
  } finally {
    await session.close();
  }
}

async function createVectorIndex(driver: Driver): Promise<void> {
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
        indexName: INDEX_NAME,
        nodeLabel: NODE_LABEL,
        propertyName: PROPERTY_NAME,
        dimensions: neo4j.int(DIMENSIONS),
        similarityFunction: SIMILARITY_FUNCTION,
      }
    );
    console.log(`Vector index '${INDEX_NAME}' created successfully.`);
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
      { indexName: INDEX_NAME }
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

async function main() {
  const { uri, user, password } = resolveCredentials();
  console.log(`Connecting to Neo4j at ${formatUriForLog(uri)} as ${user}`);

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    encrypted: 'ENCRYPTION_OFF',
  });

  try {
    await driver.verifyConnectivity();
    console.log('Neo4j connection verified.');

    if (argv.recreate) {
      await dropVectorIndex(driver);
    }

    try {
      await createVectorIndex(driver);
    } catch (error) {
      if (!argv.recreate && isIndexAlreadyExistsError(error)) {
        console.log(`Vector index '${INDEX_NAME}' already exists. No changes made.`);
      } else {
        throw error;
      }
    }

    const exists = await verifyIndex(driver);
    if (exists) {
      console.log(`Verified index '${INDEX_NAME}' is present.`);
    } else {
      console.warn(`Index '${INDEX_NAME}' was not found after creation.`);
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
