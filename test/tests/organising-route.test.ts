import {
  buildOrganisingResolveUrl,
  channelSpecForTopic,
  forwardRouteForTopic,
  INGEST_BACKLOG_QUEUE,
  INGEST_FAILED_QUEUE,
  organisingDomainForTopic,
  organisingKeyForTopic,
  resolveRouteForTopic,
  resolveTopics,
  shouldForwardToSibling,
} from '@organising-config';
import {
  forwardToOrganisingWebhook,
  forumTopicNameFromMessage,
  isUserReplyMessage,
  organisingDomainForTopic as routeDomainForTopic,
  topicFromWebhookPayload,
} from '@/services/webhook/organisingRoute';

const forumTopicCache: Record<string, string> = {};

jest.mock('@/lib/redis', () => ({
  redis: {
    set: jest.fn(async (key: string, value: string) => {
      forumTopicCache[key] = value;
    }),
    get: jest.fn(async (key: string) => forumTopicCache[key] ?? null),
  },
}));

describe('organising config', () => {
  it('defines the ingest backlog queue name', () => {
    expect(INGEST_BACKLOG_QUEUE).toBe('timelining::ingest::backlog');
    expect(INGEST_FAILED_QUEUE).toBe('timelining::ingest::failed');
  });

  it('lists resolve-enabled topics', () => {
    expect(resolveTopics()).toEqual(
      expect.arrayContaining(['_botEnrolment', '_botDecidir', '_botAgendar'])
    );
  });

  it('builds resolve URLs from config', () => {
    expect(
      buildOrganisingResolveUrl('register.prisma.events', '/api/webhook/resolve', 'entry-1')
    ).toBe('https://register.prisma.events/api/webhook/resolve?entryId=entry-1');

    expect(resolveRouteForTopic('_botDecidir')).toEqual({
      domain: 'enact.prisma.events',
      path: '/api/webhook/resolve/decide',
    });

    expect(resolveRouteForTopic('_botAgendar')).toEqual({
      domain: 'enact.prisma.events',
      path: '/api/webhook/resolve/schedule',
    });

    expect(resolveRouteForTopic('_botEnrolment')).toEqual({
      domain: 'register.prisma.events',
      path: '/api/webhook/resolve',
    });
  });

  it('maps configured channels to organising keys', () => {
    expect(organisingKeyForTopic('_botDecidir')).toBe('enact');
    expect(organisingKeyForTopic('_botAgendar')).toBe('enact');
    expect(organisingKeyForTopic('_botEnrolment')).toBe('enrol');
  });

  it('returns organising domains for configured channels', () => {
    expect(organisingDomainForTopic('_botDecidir')).toBe('enact.prisma.events');
    expect(organisingDomainForTopic('_botEnrolment')).toBe('register.prisma.events');
    expect(organisingDomainForTopic('_botDecidiendo')).toBeNull();
  });

  it('returns per-channel forward routes from config', () => {
    expect(forwardRouteForTopic('_botEnrolment')).toEqual({
      domain: 'register.prisma.events',
      path: '/api/webhook',
      mode: 'all',
    });
    expect(forwardRouteForTopic('_botAgendar')).toEqual({
      domain: 'enact.prisma.events',
      path: '/api/webhook/resolve/schedule/update',
      mode: 'replies_only',
    });
    expect(forwardRouteForTopic('_botDecidir')).toBeNull();
    expect(forwardRouteForTopic('_botHotdog')).toBeNull();
  });

  it('determines forward eligibility by mode', () => {
    expect(shouldForwardToSibling('all', false)).toBe(true);
    expect(shouldForwardToSibling('all', true)).toBe(true);
    expect(shouldForwardToSibling('replies_only', false)).toBe(false);
    expect(shouldForwardToSibling('replies_only', true)).toBe(true);
    expect(shouldForwardToSibling('none', false)).toBe(false);
    expect(shouldForwardToSibling(undefined, false)).toBe(false);
  });

  it('exposes full channel specs with forward and resolve', () => {
    expect(channelSpecForTopic('_botEnrolment')).toEqual(
      expect.objectContaining({
        key: 'enrol',
        channel: '_botEnrolment',
        forward: { mode: 'all', path: '/api/webhook' },
        resolve: { path: '/api/webhook/resolve' },
      })
    );
  });
});

describe('organisingRoute', () => {
  beforeEach(() => {
    Object.keys(forumTopicCache).forEach((key) => delete forumTopicCache[key]);
  });

  it('extracts forum topic from webhook payload', async () => {
    await expect(
      topicFromWebhookPayload({
        message: {
          reply_to_message: {
            forum_topic_created: { name: '_botDecidir' },
          },
        },
      })
    ).resolves.toBe('_botDecidir');
  });

  it('extracts forum topic from nested reply chain', async () => {
    await expect(
      topicFromWebhookPayload({
        message: {
          chat: { id: 100 },
          message_thread_id: 42,
          reply_to_message: {
            message_id: 99,
            text: 'older message',
            reply_to_message: {
              message_id: 42,
              forum_topic_created: { name: '_botEnrolment' },
            },
          },
        },
      })
    ).resolves.toBe('_botEnrolment');
  });

  it('resolves forum topic from cache when reply chain has no topic stub', async () => {
    forumTopicCache['timelining::forum-topic::100::42'] = '_botAgendar';

    await expect(
      topicFromWebhookPayload({
        message: {
          chat: { id: 100 },
          message_thread_id: 42,
          reply_to_message: {
            message_id: 99,
            text: 'standalone topic message',
          },
        },
      })
    ).resolves.toBe('_botAgendar');
  });

  it('walks reply chain synchronously via forumTopicNameFromMessage', () => {
    expect(
      forumTopicNameFromMessage({
        reply_to_message: {
          text: 'older message',
          reply_to_message: {
            forum_topic_created: { name: '_botDecidir' },
          },
        },
      })
    ).toBe('_botDecidir');
  });

  it('detects user replies but not topic-stub replies', () => {
    expect(
      isUserReplyMessage({
        message: {
          reply_to_message: {
            message_id: 2,
            text: 'older message',
          },
        },
      })
    ).toBe(true);

    expect(
      isUserReplyMessage({
        message: {
          reply_to_message: {
            message_id: 10,
            forum_topic_created: { name: '_botEnrolment' },
          },
        },
      })
    ).toBe(false);
  });

  it('returns organising domains via route helper', () => {
    expect(routeDomainForTopic('_botAgendar')).toBe('enact.prisma.events');
    expect(routeDomainForTopic('_botDecidiendo')).toBeNull();
  });
});

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ data: { ok: true } }),
}));

describe('forwardToOrganisingWebhook', () => {
  it('posts to the app base webhook URL', async () => {
    const axios = jest.requireMock('axios');
    await forwardToOrganisingWebhook('register.prisma.events', '/api/webhook', { message: { id: 1 } });
    expect(axios.post).toHaveBeenCalledWith(
      'https://register.prisma.events/api/webhook',
      { message: { id: 1 } },
      expect.objectContaining({ timeout: 5000 })
    );
  });
});
