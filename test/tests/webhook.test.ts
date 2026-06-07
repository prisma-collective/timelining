import { POST } from "@/app/api/story/webhook/route"; 
import { NextRequest, NextResponse } from "next/server";

// Mock Redis client
jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    lpush: jest.fn().mockResolvedValue(1),
  })),
}));

// Mock Axios for Telegram API and organising webhook forwarding
jest.mock("axios", () => ({
  create: jest.fn(() => ({
    post: jest.fn().mockResolvedValue({ data: { ok: true } })
  })),
  post: jest.fn().mockResolvedValue({ data: { ok: true } }),
}));

describe("Telegram Webhook API", () => {
  let mockReq: NextRequest;
  let mockRes: NextResponse;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
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
          chat: { id: 12345 },
          text: "Hello",
        },
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
  });
});
