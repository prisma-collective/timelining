import { initDriver } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import type {
  CommitHistoryEntry,
  DocsIngestStats,
  DocsPageUpsertInput,
  DocsPageViewEvent,
  PageSnapshotEntry,
} from '@/lib/db/models/page';
import type { Transaction } from 'neo4j-driver';

const DOCS_SOURCE = 'docs';

export async function getDocsPageChecksum(slug: string): Promise<string | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      RETURN p.checksum AS checksum
      `,
      { slug, source: DOCS_SOURCE }
    );

    if (result.records.length === 0) {
      return null;
    }

    const checksum = result.records[0].get('checksum');
    return typeof checksum === 'string' ? checksum : null;
  } finally {
    await session.close();
  }
}

async function upsertDocsPageInTx(tx: Transaction, input: DocsPageUpsertInput): Promise<void> {
  await tx.run(
    `
    MERGE (p:Page { slug: $slug })
    SET p.title = $title,
        p.checksum = $checksum,
        p.created_at = datetime($created_at),
        p.last_modified = datetime($last_modified),
        p.source = $source
    `,
    { ...input, source: DOCS_SOURCE }
  );
}

async function upsertDocsCommitsInTx(
  tx: Transaction,
  slug: string,
  commitHistory: CommitHistoryEntry[]
): Promise<void> {
  for (const commit of commitHistory) {
    await tx.run(
      `
      MERGE (c:Commit { sha: $sha })
      SET c.message = $message,
          c.author_name = $author_name,
          c.author_email = $author_email,
          c.timestamp = datetime($timestamp)
      WITH c
      MATCH (p:Page { slug: $slug, source: $source })
      MERGE (c)-[:MODIFIES]->(p)
      `,
      {
        slug,
        source: DOCS_SOURCE,
        sha: commit.sha,
        message: commit.message,
        author_name: commit.author_name,
        author_email: commit.author_email,
        timestamp: commit.timestamp,
      }
    );
  }
}

async function upsertDocsUnresolvedAuthorInTx(
  tx: Transaction,
  email: string,
  name: string,
  slug: string
): Promise<void> {
  await tx.run(
    `
    MERGE (u:UnresolvedAuthor { email: $email })
    SET u.name = $name
    WITH u
    MATCH (p:Page { slug: $slug, source: $source })
    MERGE (u)-[:CONTRIBUTED_TO]->(p)
    `,
    { email, name, slug, source: DOCS_SOURCE }
  );
}

/** Upsert page metadata, commits, and authors in one transaction. */
export async function syncDocsPageFromSnapshot(entry: PageSnapshotEntry): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await upsertDocsPageInTx(tx, {
        slug: entry.slug,
        title: entry.title,
        checksum: entry.checksum,
        created_at: entry.created_at,
        last_modified: entry.last_modified,
      });
      await upsertDocsCommitsInTx(tx, entry.slug, entry.commit_history);
      for (const author of entry.authors) {
        await upsertDocsUnresolvedAuthorInTx(tx, author.email, author.name, entry.slug);
      }
    });
  } finally {
    await session.close();
  }
}

export async function writeDocsIngestRun(stats: DocsIngestStats): Promise<string> {
  const id = crypto.randomUUID();
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      CREATE (r:IngestRun {
        id: $id,
        timestamp: datetime(),
        pages_checked: $pages_checked,
        pages_updated: $pages_updated,
        pages_created: $pages_created
      })
      `,
      {
        id,
        pages_checked: stats.pages_checked,
        pages_updated: stats.pages_updated,
        pages_created: stats.pages_created,
      }
    );
    return id;
  } finally {
    await session.close();
  }
}

/** Returns true if a docs Page node was updated. */
export async function recordDocsPageView({
  slug,
  timestamp,
}: DocsPageViewEvent): Promise<boolean> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      SET p.viewCount = coalesce(p.viewCount, 0) + 1
      MERGE (t:Timestamp { time: $timestamp })
      MERGE (p)-[:VIEWED_AT]->(t)
      RETURN p.slug AS slug
      `,
      { slug, timestamp, source: DOCS_SOURCE }
    );

    return result.records.length > 0;
  } catch (error) {
    logger.error('recordDocsPageView failed', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await session.close();
  }
}
