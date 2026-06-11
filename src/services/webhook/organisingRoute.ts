import axios from 'axios';
import { organisingDomainForTopic } from '@organising-config';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

const FORUM_TOPIC_CACHE_PREFIX = 'timelining::forum-topic';

type ForumTopicMessage = {
  forum_topic_created?: {
    name?: string;
  };
  reply_to_message?: ForumTopicMessage;
};

type WebhookMessage = ForumTopicMessage & {
  chat?: { id?: number };
  message_thread_id?: number;
};

type WebhookPayload = {
  message?: WebhookMessage;
};

/** True when the message replies to another message (not the forum topic stub). */
export function isUserReplyMessage(payload: WebhookPayload): boolean {
  const replyTo = payload.message?.reply_to_message;
  return Boolean(replyTo && !replyTo.forum_topic_created);
}

function forumTopicCacheKey(chatId: number, threadId: number): string {
  return `${FORUM_TOPIC_CACHE_PREFIX}::${chatId}::${threadId}`;
}

/** Walk reply_to_message chain to find the forum topic name (sync). */
export function forumTopicNameFromMessage(
  message: ForumTopicMessage | undefined
): string | undefined {
  let current = message?.reply_to_message;
  while (current) {
    const name = current.forum_topic_created?.name;
    if (name) {
      return name;
    }
    current = current.reply_to_message;
  }
  return undefined;
}

async function cacheForumTopicName(
  chatId: number | undefined,
  threadId: number | undefined,
  topicName: string
): Promise<void> {
  if (chatId === undefined || threadId === undefined) {
    return;
  }
  await redis.set(forumTopicCacheKey(chatId, threadId), topicName);
}

async function cachedForumTopicName(
  chatId: number | undefined,
  threadId: number | undefined
): Promise<string | undefined> {
  if (chatId === undefined || threadId === undefined) {
    return undefined;
  }
  const cached = await redis.get<string>(forumTopicCacheKey(chatId, threadId));
  return cached ?? undefined;
}

export async function topicFromWebhookPayload(
  payload: WebhookPayload
): Promise<string | undefined> {
  const message = payload.message;
  const topicName = forumTopicNameFromMessage(message);

  if (topicName) {
    await cacheForumTopicName(message?.chat?.id, message?.message_thread_id, topicName);
    return topicName;
  }

  return cachedForumTopicName(message?.chat?.id, message?.message_thread_id);
}

export { organisingDomainForTopic };

export async function forwardToOrganisingWebhook(
  domain: string,
  path: string,
  payload: unknown
): Promise<void> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `https://${domain}${normalizedPath}`;

  try {
    await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    logger.info('Forwarded message to organising webhook', { domain });
  } catch (error) {
    logger.error('Failed to forward message to organising webhook', { domain, error });
  }
}
