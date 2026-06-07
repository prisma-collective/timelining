import type { PageSnapshotEntry } from '@/lib/db/models/page';
import type { ProtocolSchemaResponse } from '@/lib/db/models/protocol';
import { logger } from '@/lib/logger';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function fetchDocsSnapshot(): Promise<PageSnapshotEntry[]> {
  const docsAppUrl = requireEnv('DOCS_APP_URL').replace(/\/$/, '');
  const token = requireEnv('PRIVATE_API_TOKEN');

  const snapshotUrl = `${docsAppUrl}/api/pages/snapshot`;
  const res = await fetch(snapshotUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    logger.warn('Docs snapshot request failed', { url: snapshotUrl, status: res.status, tokenLen: token.length });
    throw new Error(`snapshot failed: ${res.status}`);
  }

  const pages = (await res.json()) as PageSnapshotEntry[];
  if (!Array.isArray(pages)) {
    throw new Error('snapshot response is not an array');
  }

  return pages;
}

/** Page body text, or null when docs has no content for this slug (404). */
export async function fetchDocsPageContent(slug: string): Promise<string | null> {
  const docsAppUrl = requireEnv('DOCS_APP_URL').replace(/\/$/, '');
  const token = requireEnv('PRIVATE_API_TOKEN');

  const serveUrl = `${docsAppUrl}/api/serve/${encodeURIComponent(slug)}`;
  const res = await fetch(serveUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`serve failed for ${slug}: ${res.status}`);
  }

  return res.text();
}

/** Protocol schema for a resolve channel (deciding). */
export async function fetchProtocolSchema(channel: string): Promise<ProtocolSchemaResponse> {
  const docsAppUrl = requireEnv('DOCS_APP_URL').replace(/\/$/, '');
  const token = requireEnv('PRIVATE_API_TOKEN');

  const url = `${docsAppUrl}/api/protocol/${encodeURIComponent(channel)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    throw new Error(`schema_not_found: ${channel}`);
  }

  if (!res.ok) {
    throw new Error(`protocol schema failed for ${channel}: ${res.status}`);
  }

  const body = (await res.json()) as ProtocolSchemaResponse;
  if (!body.content?.trim()) {
    throw new Error(`schema_not_found: ${channel}`);
  }
  if (!body.commitSha?.trim()) {
    throw new Error(`protocol schema missing commitSha for ${channel}`);
  }

  return {
    content: body.content,
    commitSha: body.commitSha,
  };
}
