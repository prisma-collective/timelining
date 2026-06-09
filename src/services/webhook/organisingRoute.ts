import axios from 'axios';
import { organisingDomainForTopic } from '@organising-config';
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

export { organisingDomainForTopic };

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
