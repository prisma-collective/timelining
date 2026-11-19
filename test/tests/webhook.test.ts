import { POST } from "@/app/api/story/webhook/route"; 
import { NextRequest, NextResponse } from "next/server";
import { executePipelineActions } from "@/services/pipeline/execute";
import { redis } from "@/lib/redis";
import { setMessageReaction } from "@/lib/telegram";
import { isValidSecretToken } from "@/lib/telegram-webhook-auth";

jest.mock("@/lib/telegram", () => ({
  setMessageReaction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/pipeline/execute", () => ({
  executePipelineActions: jest.fn().mockResolvedValue(undefined),
}));

// Mock Redis client
jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    lpush: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock("@/lib/redis", () => ({
  redis: {
    lpush: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
  },
}));

// Mock Axios for Telegram API and organising webhook forwarding
jest.mock("axios", () => ({
  create: jest.fn(() => ({
    post: jest.fn().mockResolvedValue({ data: { ok: true } })
  })),
  post: jest.fn().mockResolvedValue({ data: { ok: true } }),
}));

// A synthetic secret; Telegram sends the real one in this header.
const SECRET = 'synthetic_webhook_secret-123';

describe("Telegram Webhook API", () => {
  let mockReq: NextRequest;
  let mockRes: NextResponse;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRes = {
      json: jsonMock,
      status: statusMock,
    } as unknown as NextResponse;
  });

  it("should return 405 for non-POST requests", async () => {
    const mockReq = new NextRequest('http://localhost/', { method: "GET" });
    const res = await POST(mockReq);
  
    expect(res.status).toBe(405);
  });

  it("should queue a valid message and return 'ok'", async () => {
    // Create a mock Request
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          chat: { id: 12345, type: 'private' },
          message_id: 1,
          text: "Hello",
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': SECRET,
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(executePipelineActions).toHaveBeenCalledWith([
      { kind: 'dispatch-ingest', origin: 'http://localhost' },
    ]);
    expect(redis.lpush).toHaveBeenCalled();
    expect(setMessageReaction).toHaveBeenCalled();
  });

  it("forwards a reply without ingesting", async () => {
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          chat: { id: 12345, type: 'supergroup' },
          message_id: 3,
          message_thread_id: 10,
          text: 'Reply in thread',
          reply_to_message: {
            message_id: 2,
            text: 'older message',
            reply_to_message: {
              message_id: 10,
              forum_topic_created: { name: '_botEnrolment' },
            },
          },
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': SECRET,
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(executePipelineActions).toHaveBeenCalledWith([
      {
        kind: 'forward-webhook',
        domain: 'register.prisma.events',
        path: '/api/webhook',
        payload: expect.objectContaining({
          message: expect.objectContaining({ message_id: 3 }),
        }),
      },
    ]);
    expect(redis.lpush).not.toHaveBeenCalled();
    expect(setMessageReaction).toHaveBeenCalledWith(12345, 3);
  });

  it("forwards schedule replies to update endpoint without ingesting", async () => {
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          chat: { id: 12345, type: 'supergroup' },
          message_id: 4,
          message_thread_id: 20,
          text: 'Update the schedule',
          reply_to_message: {
            message_id: 2,
            text: 'older message',
            reply_to_message: {
              message_id: 20,
              forum_topic_created: { name: '_botAgendar' },
            },
          },
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': SECRET,
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(executePipelineActions).toHaveBeenCalledWith([
      {
        kind: 'forward-webhook',
        domain: 'enact.prisma.events',
        path: '/api/webhook/resolve/schedule/update',
        payload: expect.objectContaining({
          message: expect.objectContaining({ message_id: 4 }),
        }),
      },
    ]);
    expect(redis.lpush).not.toHaveBeenCalled();
    expect(setMessageReaction).toHaveBeenCalledWith(12345, 4);
  });
});

describe("Telegram webhook secret_token", () => {
  const update = JSON.stringify({ message: { chat: { id: 12345, type: 'private' }, message_id: 1, text: 'forged' } });
  const post = (secret?: string) =>
    POST(new NextRequest('http://localhost/', {
      method: 'POST',
      body: update,
      headers: { 'Content-Type': 'application/json', ...(secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret }) },
    }));

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });

  it('refuses an update with no secret, and does nothing', async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(executePipelineActions).not.toHaveBeenCalled();
    expect(redis.lpush).not.toHaveBeenCalled();
    expect(setMessageReaction).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    expect((await post('synthetic_webhook_secret-124')).status).toBe(401);
    expect((await post(SECRET + 'x')).status).toBe(401);
    expect(executePipelineActions).not.toHaveBeenCalled();
  });

  it('refuses every update when no secret is configured', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await post('')).status).toBe(500);
    expect(executePipelineActions).not.toHaveBeenCalled();
  });
});

describe("isValidSecretToken", () => {
  it("accepts what Telegram accepts, such as propagate's hex tokens", () => {
    expect(isValidSecretToken('a'.repeat(64))).toBe(true);
    expect(isValidSecretToken(SECRET)).toBe(true);
    expect(isValidSecretToken('')).toBe(false);
    expect(isValidSecretToken('has space')).toBe(false);
    expect(isValidSecretToken('base64+/=')).toBe(false);
    expect(isValidSecretToken('a'.repeat(257))).toBe(false);
  });
});
