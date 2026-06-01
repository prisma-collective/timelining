import dotenv from 'dotenv';
import neo4j, { Driver } from 'neo4j-driver';
import path from 'path';

export function loadDbEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
}

export function resolveNeo4jCredentials(): { uri: string; user: string; password: string } {
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

export function formatUriForLog(uri: string): string {
  try {
    const parsed = new URL(uri.replace(/^bolt(\+s)?:\/\//, 'http://'));
    return `${parsed.hostname}:${parsed.port || '7687'}`;
  } catch {
    return uri;
  }
}

export async function createNeo4jDriver(): Promise<Driver> {
  loadDbEnv();
  const { uri, user, password } = resolveNeo4jCredentials();
  console.log(`Connecting to Neo4j at ${formatUriForLog(uri)} as ${user}`);

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    encrypted: 'ENCRYPTION_OFF',
  });
  await driver.verifyConnectivity();
  console.log('Neo4j connection verified.');
  return driver;
}

export function isIndexAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('equivalent index already exists')
  );
}
