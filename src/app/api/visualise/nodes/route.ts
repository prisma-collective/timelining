import { NextRequest, NextResponse } from 'next/server';
import { initDriver, isNeo4jAvailable } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import neo4j from 'neo4j-driver';
import { getCorsHeaders } from '@/lib/utils';

const allowedOrigins = [
  'http://localhost:3000',
  'https://evaluate.prisma.events',
];

// Handle OPTIONS preflight requests
export function OPTIONS(_req: NextRequest) {
  const origin = _req.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: {
      'Vary': 'Origin',
      ...getCorsHeaders(origin, allowedOrigins),
    },
  });
}

// Convert Neo4j types into plain JS types
function normalize(value: any): any {
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  if (value?.toStandardDate) {
    return value.toStandardDate().toISOString(); // For DateTime
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = normalize(val);
    }
    return out;
  }

  return value;
}


export async function GET(_req: NextRequest) {
  const origin = _req.headers.get('origin');
  console.log("Request origin:", origin);

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn('Neo4j not available. Cannot stream nodes.');
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

  logger.info('Initializing nodes stream for visualization');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      
      // Streaming a dummy line immediately to keep the connection alive
      const warmupPing = JSON.stringify({ type: "ping", message: "starting stream..." }) + '\n';
      controller.enqueue(encoder.encode(warmupPing));
      console.log("Sent warmup ping");
      
      try {
        logger.info('Running Cypher query to fetch nodes');
        const result = await session.run(`
          MATCH (e:Entry)
          OPTIONAL MATCH (e)--(related)
          WHERE NOT 'VoiceChunk' IN labels(related)
          WITH e, collect({
            id: related.id,
            label: labels(related)[0],
            properties: properties(related)
          }) AS connections
          ORDER BY e.date ASC
          RETURN {
            id: e.id,
            date: e.date,
            connections: connections
          } AS node
        `);

        logger.info(`Fetched ${result.records.length} nodes`);

        let i = 0;

        // Stream nodes
        for (const record of result.records) {
          const rawNode = record.get('node');
          const node = normalize(rawNode);

          // Handle ID selection and casting
          const rawId = node?.id;
          const nodeId = String(rawId); // Ensures consistent string ID for graph use

          const nodeData = {
            id: String(node?.id ?? ''),
            date: node?.date ?? null,
            connections: node?.connections ?? [],
          };
          
          const line = JSON.stringify(nodeData) + '\n';
          controller.enqueue(encoder.encode(line));
          
          // Log first 5 lines to console
          if (i++ < 5) {
            console.log('Streamed line:', line);
            console.log('Raw node:', rawNode);
            console.log('Node:', node);
          }
          
          // Log last 5 lines to console
          if (i > result.records.length - 5) console.log('Streamed line:', line);
        }

        logger.info('Finished streaming nodes');

        controller.close();

        logger.info('Graph streaming completed successfully');
      } catch (error: unknown) {
        logger.error('Failed to stream nodes', { error });
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
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Vary': 'Origin',
      ...getCorsHeaders(origin, allowedOrigins),
    },
  });
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
