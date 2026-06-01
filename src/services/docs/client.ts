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

  const snapshotUrl = `${docsAppUrl}/api/pages/snapshot`;
  const res = await fetch(snapshotUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // #region agent log
  fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'client.ts:fetchDocsSnapshot',message:'docs snapshot response',data:{url:snapshotUrl,status:res.status,ok:res.ok,tokenLen:token.length},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
  // #endregion

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

export async function fetchDocsPageContent(slug: string): Promise<string> {
  const docsAppUrl = requireEnv('DOCS_APP_URL').replace(/\/$/, '');
  const token = requireEnv('PRIVATE_API_TOKEN');

  const serveUrl = `${docsAppUrl}/api/serve/${encodeURIComponent(slug)}`;
  const res = await fetch(serveUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // #region agent log
  fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'client.ts:fetchDocsPageContent',message:'docs serve response',data:{url:serveUrl,slug,status:res.status,ok:res.ok},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  if (!res.ok) {
    throw new Error(`serve failed for ${slug}: ${res.status}`);
  }

  return res.text();
}
