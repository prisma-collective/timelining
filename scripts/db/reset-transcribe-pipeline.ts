import { initDriver } from '../../src/lib/db/neo4j';
import { loadDbEnv } from './env';

loadDbEnv();

async function main() {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const failed = await session.run(
      `
      MATCH (r:Resource)
      WHERE r.processingStatus = 'failed' AND r.failedStage = 'transcribe'
      SET r.processingStatus = 'pending',
          r.retryCount = 0,
          r.failedStage = NULL
      RETURN count(r) AS count
      `
    );

    const deferred = await session.run(
      `
      MATCH (v:Voice)
      WHERE coalesce(v.processingStatus, 'pending') = 'deferred_long'
      SET v.processingStatus = 'pending',
          v.retryCount = 0,
          v.failedStage = NULL
      RETURN count(v) AS count
      `
    );

    console.log('Reset failed resource transcriptions:', failed.records[0].get('count').toString());
    console.log('Reset deferred_long voices:', deferred.records[0].get('count').toString());
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
