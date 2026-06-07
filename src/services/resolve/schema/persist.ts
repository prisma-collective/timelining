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

export async function persistRoleSnapshot(
  ctx: ResolveContext,
  result: SchemaResolveResult
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await tx.run(
        `
        MATCH (e:Entry { id: $entryId })
        OPTIONAL MATCH (snap:RoleSnapshot)-[:FOR_ENTRY]->(e)
        DETACH DELETE snap
        `,
        { entryId: ctx.entryId }
      );

      const roleResult = await tx.run(
        `
        MATCH (e:Entry { id: $entryId })-[:SENT_BY]->(p:Participant)
        MERGE (p)-[:HAS_ROLE]->(r:Role { participantHandle: p.handle })
        ON CREATE SET
          r.id = randomUUID(),
          r.createdAt = datetime(),
          r.updatedAt = datetime()
        ON MATCH SET r.updatedAt = datetime()
        CREATE (snap:RoleSnapshot {
          id: randomUUID(),
          entryId: $entryId,
          recordedAt: datetime(),
          schemaChannel: $schemaChannel,
          schemaCommitSha: $schemaCommitSha,
          schemaContent: $schemaContent,
          extractedFields: $extractedFieldsJson,
          sourceKind: $sourceKind
        })
        MERGE (r)-[:HAS_SNAPSHOT]->(snap)
        MERGE (r)-[:EVOLVED_FROM]->(e)
        MERGE (snap)-[:FOR_ENTRY]->(e)
        RETURN r.id AS roleId, snap.id AS snapshotId
        `,
        cypherParams(ctx, result)
      );

      logger.info('Persisted Role snapshot', {
        entryId: ctx.entryId,
        handler: ctx.handler,
        roleId: roleResult.records[0]?.get('roleId'),
        snapshotId: roleResult.records[0]?.get('snapshotId'),
        schemaChannel: result.schemaChannel,
        schemaCommitSha: result.schemaCommitSha,
      });
    });
  } finally {
    await session.close();
  }
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
