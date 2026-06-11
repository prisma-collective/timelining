import { internalDispatchHeaders } from '@/lib/internal-dispatch';

describe('internalDispatchHeaders', () => {
  const originalToken = process.env.PRIVATE_API_TOKEN;
  const originalBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  beforeEach(() => {
    process.env.PRIVATE_API_TOKEN = 'test-token';
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  });

  afterAll(() => {
    process.env.PRIVATE_API_TOKEN = originalToken;
    if (originalBypass !== undefined) {
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = originalBypass;
    } else {
      delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
  });

  it('includes Bearer auth', () => {
    expect(internalDispatchHeaders()).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(internalDispatchHeaders()['x-vercel-protection-bypass']).toBeUndefined();
  });

  it('adds protection bypass when VERCEL_AUTOMATION_BYPASS_SECRET is set', () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret';
    expect(internalDispatchHeaders()['x-vercel-protection-bypass']).toBe('bypass-secret');
  });
});
