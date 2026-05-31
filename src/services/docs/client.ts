import type { PageSnapshotEntry } from '@/lib/db/models/page';

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

  const res = await fetch(`${docsAppUrl}/api/pages/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`snapshot failed: ${res.status}`);
  }

  const pages = (await res.json()) as PageSnapshotEntry[];
  if (!Array.isArray(pages)) {
    throw new Error('snapshot response is not an array');
  }

  return pages;
}
