import { parseRedisJson, redisJsonToString } from '@/lib/redis-json';

describe('redis-json', () => {
  const payload = { message: { message_id: 42, text: 'hello' } };

  it('parses JSON strings', () => {
    const raw = JSON.stringify(payload);
    expect(parseRedisJson<typeof payload>(raw)).toEqual(payload);
  });

  it('returns objects without re-parsing', () => {
    expect(parseRedisJson<typeof payload>(payload)).toEqual(payload);
  });

  it('serializes objects to JSON strings', () => {
    expect(redisJsonToString(payload)).toBe(JSON.stringify(payload));
  });

  it('passes through existing strings', () => {
    const raw = JSON.stringify(payload);
    expect(redisJsonToString(raw)).toBe(raw);
  });
});
