import { NextRequest, NextResponse } from 'next/server';
import { TELEGRAM_MESSAGES_QUEUE } from '@organising-config';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { setMessageReaction } from '@/lib/telegram';
import { handleError } from '@/lib/utils';
import {
  forwardToOrganisingWebhook,
  organisingDomainForTopic,
  resolveRedisQueueKey,
  topicFromWebhookPayload,
} from '@/services/webhook/organisingRoute';

const ENROLMENT_TOPIC = '_botEnrolment';

export async function POST(request: NextRequest) {
  if (request.method !== 'POST') {
    logger.info(request.method)
    return new NextResponse('Method Not Allowed', { status: 405 });
  }
  
  logger.info('Webhook triggered.');

  try {
    const data = await request.json();
    const chatId = data.message?.chat?.id;
    const messageId = data.message?.message_id;

    const topicName = topicFromWebhookPayload(data);
    const organisingDomain = organisingDomainForTopic(topicName);

    if (
      data.message?.chat?.type === 'private' ||
      topicName?.includes('_bot') ||
      topicName?.includes('prisma_events_storying')
    ) {
      if (organisingDomain) {
        await forwardToOrganisingWebhook(organisingDomain, data);
      }

      const queueKey = resolveRedisQueueKey(topicName);
      const serialized = JSON.stringify(data);
      await redis.lpush(queueKey, serialized);
      logger.info(`Message queued. chat ID: ${chatId}, message ID: ${messageId}, queue: ${queueKey}`);

      if (topicName === ENROLMENT_TOPIC) {
        await redis.lpush(TELEGRAM_MESSAGES_QUEUE, serialized);
        logger.info(`Message also queued for worker ingest. queue: ${TELEGRAM_MESSAGES_QUEUE}`);
      }

      await setMessageReaction(chatId, messageId);
      logger.info('⚡ Message reacted to.');

      return NextResponse.json({ status: 'ok' });
    } else {
      logger.info('Message ignored.');
      return NextResponse.json({ status: 'ignored' });
    }
  } catch (error) {
    logger.error('Webhook error', { error });
    return handleError(error);
  }
}

export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
