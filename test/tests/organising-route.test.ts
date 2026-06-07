import {
  organisingDomainForTopic,
  resolveRedisQueueKey,
} from '@/services/webhook/organisingRoute';

describe('organisingRoute', () => {
  it('routes matching topics to organising queue keys', () => {
    expect(resolveRedisQueueKey('_botEnaction')).toBe('timelining::organising::enact');
    expect(resolveRedisQueueKey('_botEvaluation')).toBe('timelining::organising::evaluate');
    expect(resolveRedisQueueKey('_botEnrolment')).toBe('timelining::organising::enrol');
    expect(resolveRedisQueueKey('_botEnvisioning')).toBe('timelining::organising::envision');
  });

  it('falls back to telegram_messages for non-matching topics', () => {
    expect(resolveRedisQueueKey('_botDecidiendo')).toBe('telegram_messages');
    expect(resolveRedisQueueKey(undefined)).toBe('telegram_messages');
    expect(resolveRedisQueueKey(null)).toBe('telegram_messages');
  });

  it('returns organising domains for configured channels', () => {
    expect(organisingDomainForTopic('_botEnaction')).toBe('enact.prisma.events');
    expect(organisingDomainForTopic('_botDecidiendo')).toBeNull();
  });
});
