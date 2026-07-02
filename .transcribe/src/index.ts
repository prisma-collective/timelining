import http from 'http';
import { parseTranscribeJob, readJsonBody, verifyAuth } from './auth.js';
import { checkYtDlpAvailable } from './audio.js';
import { enqueueTranscribeJob } from './jobs.js';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function handleHealth(_request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const ytDlpAvailable = await checkYtDlpAvailable();
  sendJson(response, ytDlpAvailable ? 200 : 503, {
    status: ytDlpAvailable ? 'ok' : 'degraded',
    ytDlpAvailable,
  });
}

async function handleTranscribe(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  if (!verifyAuth(request)) {
    sendJson(response, 401, { error: 'Unauthorized' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON body' });
    return;
  }

  const job = parseTranscribeJob(body);
  if (!job) {
    sendJson(response, 400, { error: 'Invalid transcribe job payload' });
    return;
  }

  const accepted = enqueueTranscribeJob(job);
  sendJson(response, 202, accepted);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      await handleHealth(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/transcribe') {
      await handleTranscribe(request, response);
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Unhandled server error', error);
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Transcribe service listening on port ${PORT}`);
});
