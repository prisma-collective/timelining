import axios from 'axios';
import {
  ORGANISING_CONFIG,
  TELEGRAM_MESSAGES_QUEUE,
  organisingQueueKey,
  type OrganisingKey,
} from '@organising-config';
import { logger } from '@/lib/logger';

type WebhookPayload = {
  message?: {
    reply_to_message?: {
      forum_topic_created?: {
        name?: string;
      };
    };
  };
};

export function topicFromWebhookPayload(payload: WebhookPayload): string | undefined {
  return payload.message?.reply_to_message?.forum_topic_created?.name;
}

export function resolveRedisQueueKey(topic: string | null | undefined): string {
  if (!topic) {
    return TELEGRAM_MESSAGES_QUEUE;
  }

  for (const key of Object.keys(ORGANISING_CONFIG) as OrganisingKey[]) {
    if (topic === ORGANISING_CONFIG[key].channel) {
      return organisingQueueKey(key);
    }
  }

  return TELEGRAM_MESSAGES_QUEUE;
}

export function organisingDomainForTopic(topic: string | null | undefined): string | null {
  if (!topic) {
    return null;
  }

  for (const key of Object.keys(ORGANISING_CONFIG) as OrganisingKey[]) {
    if (topic === ORGANISING_CONFIG[key].channel) {
      return ORGANISING_CONFIG[key].domain;
    }
  }

  return null;
}

export async function forwardToOrganisingWebhook(
  domain: string,
  payload: unknown
): Promise<void> {
  const url = `https://${domain}/webhook`;

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
