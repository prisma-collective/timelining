import { parseSourceTokens } from '@/lib/external-auth';
import { parseExternalEnvelope } from '@/services/external/envelope';

const valid = {
  source: 'github',
  externalId: 'abc123:D13',
  topic: '_botDecidir',
  occurredAt: '2026-10-28T12:00:00Z',
  sourceRef: 'prisma-collective/at-tap',
  participant: { handle: 'jikaidoko' },
  text: 'D13 is now Proposed',
  data: { decision: 'D13', status: 'Proposed', reviewers: ['tbsfchnr'] },
};

describe('External entry envelope', () => {
  it('accepts a valid envelope and normalises the date', () => {
    const result = parseExternalEnvelope(valid, 'github');
    expect(result).toEqual({ ok: true, envelope: { ...valid, occurredAt: '2026-10-28T12:00:00.000Z' } });
  });

  it("rejects a source that isn't the token's", () => {
    const result = parseExternalEnvelope({ ...valid, source: 'enrol' }, 'github');
    expect(result).toEqual({ ok: false, error: "source must be 'github' for this token" });
  });

  it('rejects a topic that no organising channel uses', () => {
    expect(parseExternalEnvelope({ ...valid, topic: '_botNope' }, 'github').ok).toBe(false);
  });

  it.each([
    ['externalId', { externalId: '' }],
    ['occurredAt', { occurredAt: 'yesterday' }],
    ['sourceRef', { sourceRef: undefined }],
    ['participant', { participant: { handle: '' } }],
    ['text', { text: 'x'.repeat(10_001) }],
    ['data', { data: ['not', 'an', 'object'] }],
    ['data size', { data: { blob: 'x'.repeat(20_000) } }],
  ])('rejects a bad %s', (_name, change) => {
    expect(parseExternalEnvelope({ ...valid, ...change }, 'github').ok).toBe(false);
  });

  it('drops blank text and keeps an envelope without data', () => {
    const { text: _text, data: _data, ...bare } = valid;
    const result = parseExternalEnvelope({ ...bare, text: '   ' }, 'github');
    expect(result.ok && result.envelope).toEqual({ ...bare, occurredAt: '2026-10-28T12:00:00.000Z' });
  });

  it('rejects a body that is not an object', () => {
    expect(parseExternalEnvelope('hello', 'github').ok).toBe(false);
  });
});

describe('Source tokens', () => {
  it('reads one token per known source and ignores the rest', () => {
    const tokens = parseSourceTokens('github=s3cret, enrol=other ,nope=x,=y,github2');
    expect([...tokens]).toEqual([['github', 's3cret']]);
  });

  it('is empty when unset', () => {
    expect(parseSourceTokens(undefined).size).toBe(0);
  });
});
