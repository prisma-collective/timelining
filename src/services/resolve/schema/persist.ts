import { initDriver } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import type { ResolveContext, SchemaResolveResult } from '../types';

function cypherParams(ctx: ResolveContext, result: SchemaResolveResult) {
  return {
    entryId: ctx.entryId,
    schemaChannel: result.schemaChannel,
    schemaCommitSha: result.schemaCommitSha,
    schemaContent: result.schemaContent,
    extractedFieldsJson: JSON.stringify(result.extractedFields),
    sourceKind: result.sourceKind,
  };
}

export async function persistDecision(
  ctx: ResolveContext,
  result: SchemaResolveResult
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      OPTIONAL MATCH (e)-[:RESOLVED_TO]->(d:Decision)
      DETACH DELETE d
      WITH e
      CREATE (d:Decision {
        id: randomUUID(),
        schemaChannel: $schemaChannel,
        schemaCommitSha: $schemaCommitSha,
        schemaContent: $schemaContent,
        extractedFields: $extractedFieldsJson,
        sourceKind: $sourceKind,
        createdAt: datetime()
      })
      MERGE (e)-[:RESOLVED_TO]->(d)
      RETURN d.id AS decisionId
      `,
      cypherParams(ctx, result)
    );

    logger.info('Persisted Decision', {
      entryId: ctx.entryId,
      handler: ctx.handler,
      schemaChannel: result.schemaChannel,
      schemaCommitSha: result.schemaCommitSha,
    });
  } finally {
    await session.close();
  }
}
