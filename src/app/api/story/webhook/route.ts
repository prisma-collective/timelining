import { NextRequest, NextResponse } from 'next/server';
import { INGEST_BACKLOG_QUEUE } from '@organising-config';
import { logger } from '@/lib/logger';
import { originFromRequest } from '@/lib/internal-dispatch';
import { redis } from '@/lib/redis';
import { setMessageReaction } from '@/lib/telegram';
import { handleError } from '@/lib/utils';
import { executePipelineActions } from '@/services/pipeline/execute';
import { pipelineActionsForReceipt } from '@/services/pipeline/routing';
import { topicFromWebhookPayload, isUserReplyMessage } from '@/services/webhook/organisingRoute';

export async function POST(request: NextRequest) {
  if (request.method !== 'POST') {
    logger.info(request.method);
    return new NextResponse('Method Not Allowed', { status: 405 });
  }

  logger.info('Webhook triggered.');

  try {
    const data = await request.json();
    const chatId = data.message?.chat?.id;
    const messageId = data.message?.message_id;

    const topicName = await topicFromWebhookPayload(data);

    if (
      data.message?.chat?.type === 'private' ||
      topicName?.includes('_bot') ||
      topicName?.includes('prisma_events_storying')
    ) {
      const origin = originFromRequest(request);
      const isReply = isUserReplyMessage(data);
      const actions = pipelineActionsForReceipt(topicName, origin, data, { isReply });

      await executePipelineActions(actions);

      if (!isReply) {
        const serialized = JSON.stringify(data);
        await redis.lpush(INGEST_BACKLOG_QUEUE, serialized);
        logger.info(`Message queued for ingest. chat ID: ${chatId}, message ID: ${messageId}, queue: ${INGEST_BACKLOG_QUEUE}`);
      } else {
        logger.info('Reply message received; ingest skipped.', {
          chatId,
          messageId,
          topicName,
        });
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
