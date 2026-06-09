import { NextResponse } from 'next/server';
import { INGEST_BACKLOG_QUEUE } from '@organising-config';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { isNeo4jAvailable } from '@/lib/db/neo4j';
import { countPipelineByStatus } from '@/services/vectorise';

export async function GET() {
  logger.info('Status check requested');

  try {
    const neo4jReady = await isNeo4jAvailable();

    let redisAvailable = true;
    let queuedMessages = 0;
    let voicePipeline = {
      pending: 0,
      transcribed: 0,
      vectorised: 0,
      failed: 0,
      deferred_long: 0,
    };

    try {
      queuedMessages = await redis.llen(INGEST_BACKLOG_QUEUE);
    } catch (err) {
      logger.error('Redis check failed', { error: err });
      redisAvailable = false;
    }

    if (neo4jReady) {
      try {
        voicePipeline = await countPipelineByStatus();
      } catch (err) {
        logger.error('Voice pipeline status check failed', { error: err });
      }
    }

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

    const voiceOutstanding = voicePipeline.pending + voicePipeline.transcribed;

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
        [INGEST_BACKLOG_QUEUE]: queuedMessages,
      },
      voice_pipeline: voicePipeline,
      messages: {
        queued: queuedMessages,
        voice_outstanding: voiceOutstanding,
      },
    };

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
