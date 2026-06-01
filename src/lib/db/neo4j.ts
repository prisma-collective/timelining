import neo4j, { Driver } from 'neo4j-driver';
import { logger } from '../logger';

function getNeo4jConfig() {
  return {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'neo4jtesting',
  };
}

// Use the type inferred from neo4j.driver() for best compatibility
let _driver: Driver | null;
let _neo4jAvailable: boolean | null = null; // Track Neo4j availability
let _driverConnectivityVerified = false;

export function getDriver() {
  if (!_driver) {
    const { uri, user, password } = getNeo4jConfig();
    logger.info(`Connecting to Neo4j at ${uri} with user ${user}`);
    _driver = neo4j.driver(
      uri,
      neo4j.auth.basic(user, password), {
        encrypted: 'ENCRYPTION_OFF'
      }
    );
  }
  return _driver;
}

/**
  Check if Neo4j is available and configured
  Returns false if credentials are missing or connection fails
 */
export async function isNeo4jAvailable(): Promise<boolean> {
  if (_neo4jAvailable !== null) {
    return _neo4jAvailable;
  }

  if (!process.env.NEO4J_URI || !process.env.NEO4J_USERNAME || !process.env.NEO4J_PASSWORD) {
    logger.warn('Neo4j credentials not configured. Running in Redis-only mode.');
    _neo4jAvailable = false;
    return false;
  }

  try {
    const driver = getDriver();
    await driver.verifyConnectivity();
    logger.info('Neo4j connection verified successfully');
    _neo4jAvailable = true;
    return true;
  } catch (err) {
    logger.warn(`Neo4j unavailable: ${err instanceof Error ? err.message : 'Unknown error'}. Running in Redis-only mode.`);
    _neo4jAvailable = false;
    return false;
  }
}

export async function initDriver() {
  const driver = getDriver();
  if (_driverConnectivityVerified) {
    return driver;
  }

  try {
    logger.info('Initializing Neo4j connection...');
    logger.info('Verifying connection to Neo4j...');
    const serverInfo = await driver.verifyConnectivity(); 
    logger.info('Server Info:', serverInfo);
    _driverConnectivityVerified = true;
    return driver;
  } catch (err) {
    logger.error(`Failed to initialize Neo4j driver: ${err instanceof Error ? err.message : 'Unknown error'}`);
    await driver.close();  
    _driverConnectivityVerified = false;
    _driver = null;
    throw err;
  }
}

export async function closeDriver() {
  if (_driver) {
    logger.info('Closing Neo4j driver...');
    await _driver.close(); 
    _driver = null;
    _driverConnectivityVerified = false;
  }
}
