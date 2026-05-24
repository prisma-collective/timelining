import { NextRequest, NextResponse } from 'next/server';
import { initDriver, isNeo4jAvailable } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import { getCorsHeaders } from '@/lib/utils';

const allowedOrigins = [
  'http://localhost:3000',
  'https://evaluate.prisma.events',
];

export async function GET(_req: NextRequest) {
  const origin = _req.headers.get('origin');

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Cannot stream edges.');
    return new NextResponse(
      JSON.stringify({
        error: 'Database not configured',
        message: 'Neo4j is not available. Please configure Neo4j credentials to access visualization data.'
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Vary': 'Origin',
          ...getCorsHeaders(origin, allowedOrigins),
        }
      }
    );
  }

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  logger.info('Initializing full graph stream for visualization');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      
      controller.enqueue(encoder.encode('{\n"edges": [\n')); // Start fast
      
      try {
        logger.info('Running Cypher query to fetch edges');
        const result = await session.run(`
            MATCH (n)-[r]->(m)
            RETURN collect(DISTINCT {
                id: id(r),
                source: 
                    CASE 
                        WHEN startNode(r).handle IS NOT NULL THEN startNode(r).handle
                        ELSE startNode(r).id
                    END,
                target: 
                    CASE 
                        WHEN endNode(r).handle IS NOT NULL THEN endNode(r).handle
                        ELSE endNode(r).id
                    END,
                type: type(r),
                properties: properties(r)
            }) AS relationships
        `);

        const record = result.records[0];
        const edgesRaw = record.get('relationships');

        logger.info(`Fetched ${edgesRaw.length} relationships`);
        logger.info('First 5 edges:', edgesRaw.slice(0, 5));

        // Stream edges
        for (let i = 0; i < edgesRaw.length; i++) {
          const edge = edgesRaw[i];

          // Defensive: ensure IDs are not null or undefined
          if (
            edge?.id == null ||
            edge?.source == null ||
            edge?.target == null
          ) {
            continue; // Skip broken edge
          }

          // Force all IDs to string
          const edgeId = String(edge.id);
          const sourceId = String(edge.source);
          const targetId = String(edge.target);

          // Remove id, source, target from properties to avoid overwriting
          const {
            id: _removedId,
            source: _removedSource,
            target: _removedTarget,
            ...safeProperties
          } = edge.properties ?? {};

          const edgeData = {
            data: {
              id: edgeId,
              source: sourceId,
              target: targetId,
              label: edge.type || 'REL',
              ...safeProperties,
            },
          };

          controller.enqueue(encoder.encode(JSON.stringify(edgeData)));
          if (i < edgesRaw.length - 1) controller.enqueue(encoder.encode(',\n'));
        }


        logger.info('Finished streaming edges');

        controller.enqueue(encoder.encode('\n]\n}'));
        controller.close();

        logger.info('Graph streaming completed successfully');
      } catch (error: unknown) {
        logger.error('Failed to stream edges', { error });
        controller.enqueue(encoder.encode(JSON.stringify({ error: 'Streaming error', details: String(error) })));
        controller.close();
      } finally {
        await session.close();
        logger.info('Neo4j session closed');
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Vary': 'Origin',
      ...getCorsHeaders(origin, allowedOrigins),
    },
  });
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
