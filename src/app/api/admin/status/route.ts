import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { isNeo4jAvailable } from '@/lib/db/neo4j';

/**
  System status endpoint
  Shows Neo4j availability, Redis queue status, and overall health
 
  Returns:
    - neo4j_available: boolean
    - redis_available: boolean
    - queued_messages: number
    - processed_entries: number
    - mode: "full" | "redis-only"
    - health: "healthy" | "degraded" | "error"
 */
export async function GET() {
  logger.info('Status check requested');

  try {
    // Check Neo4j
    const neo4jReady = await isNeo4jAvailable();

    // Check Redis and get queue lengths
    let redisAvailable = true;
    let queuedMessages = 0;
    let processedEntries = 0;

    try {
      queuedMessages = await redis.llen('telegram_messages');
      processedEntries = await redis.llen('timeline_entry');
    } catch (err) {
      logger.error('Redis check failed', { error: err });
      redisAvailable = false;
    }

    // Determine system health
    let health: 'healthy' | 'degraded' | 'error';
    let mode: 'full' | 'redis-only';

    if (!redisAvailable) {
      health = 'error';
      mode = 'redis-only';
    } else if (!neo4jReady) {
      health = 'degraded';
      mode = 'redis-only';
    } else {
      health = 'healthy';
      mode = 'full';
    }

    const status = {
      health,
      mode,
      services: {
        neo4j: {
          available: neo4jReady,
          configured: !!(
            process.env.NEO4J_URI &&
            process.env.NEO4J_USERNAME &&
            process.env.NEO4J_PASSWORD
          ),
        },
        redis: {
          available: redisAvailable,
          configured: !!(
            process.env.KV_REST_API_URL &&
            process.env.KV_REST_API_TOKEN
          ),
        },
      },
      queues: {
        telegram_messages: queuedMessages,
        timeline_entry: processedEntries,
      },
      messages: {
        queued: queuedMessages,
        processed: processedEntries,
        total: queuedMessages + processedEntries,
      },
    };

    // Return 200 for healthy/degraded, 503 for error
    const statusCode = health === 'error' ? 503 : 200;

    return NextResponse.json(status, { status: statusCode });
  } catch (error: unknown) {
    logger.error('Status check failed', { error });

    if (error instanceof Error) {
      return NextResponse.json(
        {
          health: 'error',
          error: error.message,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        health: 'error',
        error: 'Unknown error occurred',
      },
      { status: 503 }
    );
  }
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
