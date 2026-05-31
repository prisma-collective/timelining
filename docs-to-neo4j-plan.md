# Docs-to-Neo4j Ingestion Pipeline — Implementation Plan

## Status

| Workstream | App | Status |
|---|---|---|
| Workstream 1 — Snapshot + Serve | docs | **DONE** |
| Workstream 2 — Phase 1 ingest | timelining | **DONE** |
| Workstream 3 — Phase 2 vectorisation | timelining | **DONE** |
| Workstream 4 — Cron | timelining | **DONE** |
| Workstream 5 — Verify script | timelining | TODO |

---

## Overview

Extends the publishing stack to ingest docs pages into Neo4j, including chunk embeddings, following the same two-phase pattern already established in timelining for voice notes: a lightweight ingest phase writes page nodes and authorship metadata, and a separate post-process phase handles chunking and embedding generation. The docs app exposes both a snapshot endpoint (page metadata + git history) and a serve endpoint (raw page content on demand). UnresolvedAuthor nodes are written for all authors at this stage; participant resolution is handled separately.

---

## Apps in Scope

| App | Platform | Role in this work |
|---|---|---|
| `docs` | Next.js on Vercel | Exposes snapshot and serve endpoints |
| `timelining` | Next.js on Vercel | Fetches from docs, writes to Neo4j, chunk-embeddings post-process, cron trigger |

**Shared auth:** Both apps use the existing infra token pattern. Internal endpoints validate via `Authorization: Bearer <PRIVATE_API_TOKEN>` (`verifyInfraRequest`), returning `401` if absent or incorrect. Docs ingest also accepts Vercel scheduled invocations via `verifyCronOrInfraRequest` (`x-vercel-cron: 1` header) — no separate `CRON_SECRET` env var. Page-vectorise and voice-vectorise cron routes are unauthenticated (matching the existing voice-vectorise pattern).

**Important:** `DOCS_APP_URL` in timelining must point at the **secret docs deployment** (full content + valid token), not the public export artifact.

---

## Timelining code layout

**Phase 1 (ingest)** lives under [`src/services/docs/`](src/services/docs/) — snapshot fetch, page metadata Neo4j, log drain. **Phase 2 (vectorisation)** lives under [`src/services/vectorise/page/`](src/services/vectorise/page/) alongside the refactored voice pipeline (`vectorise/shared`, `vectorise/voice`). Docs pipeline routes under [`src/app/api/docs/`](src/app/api/docs/); vectorisation cron routes under [`src/app/api/story/`](src/app/api/story/).

| Path | Role |
|------|------|
| [`src/lib/db/models/page.ts`](src/lib/db/models/page.ts) | Docs ingest types (`PageSnapshotEntry`, `DocsIngestStats`, `DocsPageViewEvent`, …) |
| [`src/services/docs/pageService.ts`](src/services/docs/pageService.ts) | Phase 1 Neo4j — `Page` metadata, commits, authors, ingest runs, page views (ingest-only; no chunk Cypher) |
| [`src/services/docs/client.ts`](src/services/docs/client.ts) | Outbound `fetchDocsSnapshot()`, `fetchDocsPageContent(slug)` |
| [`src/services/docs/ingest.ts`](src/services/docs/ingest.ts) | `runDocsIngest()` orchestration |
| [`src/services/docs/logDrain.ts`](src/services/docs/logDrain.ts) | Parse Vercel drain payload → slugs → `recordDocsPageView` |
| [`src/services/docs/index.ts`](src/services/docs/index.ts) | Barrel re-exports for `@/services/docs` |
| [`src/services/vectorise/shared/`](src/services/vectorise/shared/) | Shared chunking + embedding — `chunkText()`, `embedTexts()`, `tickUtils`, batch/timeout constants |
| [`src/services/vectorise/voice/`](src/services/vectorise/voice/) | Voice transcribe + vectorise pipeline (`VoiceChunk` nodes; Cypher unchanged) |
| [`src/services/vectorise/page/`](src/services/vectorise/page/) | Page vectorise pipeline — `vectorisePageStage`, `runPageVectoriseTick`, `PageChunk` Neo4j |
| [`src/services/vectorise/index.ts`](src/services/vectorise/index.ts) | Top-level barrel — re-exports voice (backward compat) + page public API |
| [`src/lib/private-auth.ts`](src/lib/private-auth.ts) | `verifyInfraRequest`, `verifyCronOrInfraRequest` (ingest cron) |
| [`src/app/api/docs/ingest/route.ts`](src/app/api/docs/ingest/route.ts) | `GET` / `POST` `/api/docs/ingest` |
| [`src/app/api/docs/log-drain/route.ts`](src/app/api/docs/log-drain/route.ts) | `POST` `/api/docs/log-drain` — see [Log drain (WS2)](#log-drain-ws2) |
| [`src/app/api/story/page-vectorise/route.ts`](src/app/api/story/page-vectorise/route.ts) | `GET` `/api/story/page-vectorise` — batch tick (mirrors voice-vectorise) |
| [`src/app/api/story/voice-vectorise/route.ts`](src/app/api/story/voice-vectorise/route.ts) | Existing voice transcribe + vectorise cron |

### `:Page` node

All timelining `Page` nodes use **`slug`** (locale-prefixed docs path) and **`source: 'docs'`**. Ingest writes metadata; log-drain increments view counts on existing nodes; vectorisation adds `:PageChunk` children (mirrors `:VoiceChunk` for voice notes).

| Property | Set by |
|----------|--------|
| `slug`, `title`, `checksum`, `created_at`, `last_modified`, `source` | Ingest |
| `viewCount` | Log drain (optional coalesce to 0 on first view) |
| `embeddings_updated_at` | Page vectorise batch (WS3) |

---

## Pipeline Overview

```
[docs content/{en,es,pt}/]
        │
        │  every 6h — Vercel cron
        ▼
[timelining: GET|POST /api/docs/ingest]   ← Phase 1: lightweight ingest
   Calls GET /api/pages/snapshot (docs)
   For each changed page (checksum diff):
     - Upserts Page node
     - Upserts Commit nodes + MODIFIES relationships
     - Upserts UnresolvedAuthor nodes + CONTRIBUTED_TO relationships
   Writes IngestRun node
        │
        │  separate schedule — batch tick (not triggered from ingest)
        ▼
[timelining: GET /api/story/page-vectorise]   ← Phase 2: chunk + embed (batch)
   runPageVectoriseTick() selects docs Page nodes needing vectorisation
   For each slug in batch (up to VECTORISE_BATCH_SIZE):
     - Calls GET /api/serve/{slug} (docs) via fetchDocsPageContent()
     - chunkText() + embedTexts() (shared with voice pipeline)
     - Upserts PageChunk nodes + HAS_CHUNK on Page
     - Sets Page.embeddings_updated_at
```

---

## Workstream 1 — Docs: Two Endpoints (DONE)

Implemented in the docs repo. Key files:

| File | Purpose |
|---|---|
| `lib/page-snapshot.ts` | Walk content, git metadata, checksums, title extraction |
| `scripts/generate-pages-snapshot.ts` | Build-time snapshot for Vercel (no `.git` at runtime); incremental by default |
| `app/api/pages/snapshot/route.ts` | Snapshot API route |
| `app/api/serve/[...path]/route.ts` | Existing serve endpoint (unchanged auth) |
| `data/pages-snapshot.json` | Build artifact (gitignored, generated by `prebuild`) |

### 1a. Page Snapshot Endpoint

```
GET /api/pages/snapshot
Authorization: Bearer <PRIVATE_API_TOKEN>
```

Optional query: `?locale=en|es|pt` to filter by locale.

Walks `content/{en,es,pt}/` recursively. For each public `.md`/`.mdx` file, extracts metadata and git history via `simple-git`. Returns a JSON **array**. Content body is intentionally excluded — the snapshot is metadata only.

**Runtime behaviour:**

- **Local dev** (`.git` present): computes live snapshot with fresh git history.
- **Vercel prod** (no `.git`): serves `data/pages-snapshot.json` generated at build time by `prebuild`.
- **Incremental prebuild:** reuses `data/pages-snapshot.json` when present and only re-runs git indexing for files changed in the latest commit (`HEAD~1..HEAD`, or `HEAD` on shallow clones). First build or `FORCE_FULL_PAGES_SNAPSHOT=1` indexes all pages.

**Excluded from snapshot:** pages with `private: true` frontmatter (same rule as public serve).

#### Response shape (per page)

```json
{
  "slug": "en/concepts/graph-rag",
  "title": "Graph RAG",
  "checksum": "sha256:<hash of raw file bytes>",
  "created_at": "2024-01-15T10:22:00Z",
  "last_modified": "2024-11-03T14:05:00Z",
  "commit_history": [
    {
      "sha": "a1b2c3d",
      "message": "add graph rag overview",
      "author_name": "Alice",
      "author_email": "alice@example.com",
      "timestamp": "2024-01-15T10:22:00Z"
    }
  ],
  "authors": [
    { "name": "Alice", "email": "alice@example.com", "commit_count": 14 },
    { "name": "Alice", "email": "alice@personal.com", "commit_count": 3 }
  ]
}
```

#### Notes

- **Slugs are locale-prefixed:** `en/concepts/foo`, `es/concepts/foo`, `pt/concepts/foo` are separate pages.
- `title` parsed from first `# ` heading in body (after frontmatter strip); falls back to filename.
- `created_at` from first commit touching the file (`git log --follow --diff-filter=A`).
- `last_modified` from most recent commit.
- `authors` deduplicated by email across full file history. Multiple emails per person are expected.
- `checksum` is SHA-256 of **raw on-disk file bytes** (includes frontmatter). Timelining uses this to skip unchanged pages.
- `commit_history` ordered oldest-first.
- Content is excluded. Timelining fetches it separately via the serve endpoint, only for pages that pass the checksum check.
- Snapshot route is **excluded from the public export artifact** (`scripts/public-artifact/export.ts`).

---

### 1b. Page Serve Endpoint (existing)

```
GET /api/serve/{slug}
Authorization: Bearer <PRIVATE_API_TOKEN>
```

Serves page content by slug. Called by timelining's page vectorise stage (`fetchDocsPageContent`) when generating embeddings.

#### Default response (markdown)

Returns the **frontmatter-stripped markdown body** with `Content-Type: text/markdown`. This is what embeddings should consume.

```bash
curl -H "Authorization: Bearer $PRIVATE_API_TOKEN" \
  "$DOCS_APP_URL/api/serve/en/concepts/graph-rag"
```

#### Optional JSON response

```
GET /api/serve/{slug}?format=json
```

```json
{
  "slug": "en/concepts/graph-rag",
  "title": "Graph RAG",
  "content": "# Graph RAG\n\nFull markdown content...",
  "media": [{ "src": "...", "alt": "..." }]
}
```

#### Notes

- Slug maps to file path under `content/`: `en/concepts/graph-rag` → `content/en/concepts/graph-rag.md` (or `.mdx`, or `index.md`).
- Locale-less slugs default to `en/` via `normalizeContentSlugForI18n`.
- Returns `404` for missing files and for raw `private: true` pages.
- No git calls — content only. Lightweight and repeatable.
- Checksum (raw file) vs served content (stripped body) intentionally differ; checksum detects file changes, serve provides embedding input.

---

## Workstream 2 — Timelining: Phase 1 Ingest Endpoint

**Status: DONE.**

### Endpoint

```
GET|POST /api/docs/ingest
Authorization: Bearer <PRIVATE_API_TOKEN>  (GET also accepts x-vercel-cron: 1)
```

Route: [`src/app/api/docs/ingest/route.ts`](src/app/api/docs/ingest/route.ts). GET for Vercel cron (`verifyCronOrInfraRequest`); POST for manual runs (Bearer token).

### Fetch contract (docs snapshot)

```ts
const res = await fetch(`${process.env.DOCS_APP_URL}/api/pages/snapshot`, {
  headers: { Authorization: `Bearer ${process.env.PRIVATE_API_TOKEN}` },
});
if (!res.ok) throw new Error(`snapshot failed: ${res.status}`);
const pages: PageSnapshotEntry[] = await res.json();
```

### Behaviour

1. Calls `GET <DOCS_APP_URL>/api/pages/snapshot`.
2. For each page:
   a. Queries Neo4j for existing `Page` node by `slug`.
   b. Compares `checksum`. If unchanged, skips.
   c. If new or changed: upserts `Page` node (without content — content lives in `PageChunk` nodes after vectorisation).
   d. Upserts `Commit` nodes and `(:Commit)-[:MODIFIES]->(:Page)` relationships.
   e. For each author: upserts `UnresolvedAuthor` node and `(:UnresolvedAuthor)-[:CONTRIBUTED_TO]->(:Page)` relationship. No participant matching at this stage.
3. Writes `IngestRun` node.

Ingest does **not** call the vectorise endpoint. Phase 2 is decoupled and runs on its own cron schedule (see Workstream 4).

No participant resolution logic here. All authors become `UnresolvedAuthor` nodes unconditionally. Resolution is a separate workstream.

### Neo4j Schema

#### Nodes

```
(:Page {
  slug: String,              // MERGE key — locale-prefixed, e.g. "en/concepts/foo"
  title: String,
  checksum: String,
  created_at: DateTime,
  last_modified: DateTime,
  source: "docs",
  viewCount: Integer,        // optional — incremented by log drain
  embeddings_updated_at: DateTime   // set by post-process phase; null until first run
})

(:PageChunk {
  id: String,                // MERGE key — "{slug}::chunk::{index}"
  content: String,
  embedding: List<Float>,
  chunk_index: Integer,
  token_count: Integer
})
```

Voice notes use a separate label `:VoiceChunk` (with `chunk_text` property) — unchanged from the pre-docs pipeline.

```
(:VoiceChunk {
  id: String,                // randomUUID() at write time
  chunk_text: String,
  embedding: List<Float>
})
```

```
(:Commit {
  sha: String,               // MERGE key
  message: String,
  author_name: String,
  author_email: String,
  timestamp: DateTime
})

(:UnresolvedAuthor {
  email: String,             // MERGE key
  name: String
})

(:IngestRun {
  id: String,                // uuid
  timestamp: DateTime,
  pages_checked: Integer,
  pages_updated: Integer,
  pages_created: Integer
})
```

#### Relationships

```
(:Commit)-[:MODIFIES]->(:Page)
(:UnresolvedAuthor)-[:CONTRIBUTED_TO]->(:Page)
(:Page)-[:HAS_CHUNK]->(:PageChunk)
(:Voice)-[:HAS_CHUNK]->(:VoiceChunk)
```

`(:Participant)-[:CONTRIBUTED_TO]->(:Page)` is intentionally absent from this phase. It is added when the registration workstream runs.

#### Key Cypher

**Page upsert** (no content field — content is in PageChunk nodes):
```cypher
MERGE (p:Page { slug: $slug })
SET p.title = $title,
    p.checksum = $checksum,
    p.created_at = datetime($created_at),
    p.last_modified = datetime($last_modified),
    p.source = "docs"
```

**Commit upsert:**
```cypher
MERGE (c:Commit { sha: $sha })
SET c.message = $message,
    c.author_name = $author_name,
    c.author_email = $author_email,
    c.timestamp = datetime($timestamp)
WITH c
MATCH (p:Page { slug: $slug })
MERGE (c)-[:MODIFIES]->(p)
```

**UnresolvedAuthor upsert:**
```cypher
MERGE (u:UnresolvedAuthor { email: $email })
SET u.name = $name
WITH u
MATCH (p:Page { slug: $slug })
MERGE (u)-[:CONTRIBUTED_TO]->(p)
```

### Service layer

**Types:** extend [`src/lib/db/models/page.ts`](src/lib/db/models/page.ts) — snapshot/ingest types plus `DocsPageViewEvent`. **Remove** unused legacy `Page` / `PageView` (`pageUrl` / `url` keys).

**Neo4j (ingest):** [`src/services/docs/pageService.ts`](src/services/docs/pageService.ts) — implemented as `syncDocsPageFromSnapshot` (transactional page + commits + authors). Functions:

- `getDocsPageChecksum(slug)`
- `syncDocsPageFromSnapshot(entry)` — page + commits + authors
- `writeDocsIngestRun(stats)`
- `recordDocsPageView({ slug, timestamp })` — view analytics (see log drain)

**Orchestration:** [`src/services/docs/ingest.ts`](src/services/docs/ingest.ts), [`src/services/docs/logDrain.ts`](src/services/docs/logDrain.ts).

**Routes:** [`src/app/api/docs/ingest/route.ts`](src/app/api/docs/ingest/route.ts), [`src/app/api/docs/log-drain/route.ts`](src/app/api/docs/log-drain/route.ts).

### Log drain (WS2 — DONE)

Vercel log drain for the **docs** deployment. Implemented to align with docs `Page` nodes.

**Endpoint:** `POST /api/docs/log-drain` (path unchanged for Vercel drain config).

**Behaviour:**

1. Handle Vercel drain **verification** challenge (`x-vercel-verify` response header when required).
2. Parse JSON body (array of log entries from Vercel).
3. For each entry, extract a request path (e.g. `message`, `path`, or proxy field — normalize in [`logDrain.ts`](src/services/docs/logDrain.ts)).
4. Map path → docs **slug** (`/en/concepts/foo` → `en/concepts/foo`; skip non-content paths: `_next`, `api`, static assets).
5. Call `recordDocsPageView({ slug, timestamp })` — only updates nodes that already exist from ingest:

```cypher
MATCH (p:Page { slug: $slug, source: 'docs' })
SET p.viewCount = coalesce(p.viewCount, 0) + 1
MERGE (t:Timestamp { time: $timestamp })
MERGE (p)-[:VIEWED_AT]->(t)
```

6. Return `200` with counts (`processed`, `recorded`, `skipped`); `400` on invalid payload; `500` on Neo4j errors. Use [`logger`](src/lib/logger.ts).

**Auth:** If the drain is configured with a Bearer secret, validate via `verifyInfraRequest` (`PRIVATE_API_TOKEN`). Verification handshake may occur without Bearer on first setup.

**Route:** thin handler → `processLogDrain(body)` in `logDrain.ts`.

---

## Workstream 3 — Timelining: Phase 2 Post-Process (batch tick)

**Status: DONE.** Mirrors the voice-note pipeline: a **scheduled batch tick** processes work from Neo4j, not callbacks from ingest. Uses the same chunk size / overlap (`chunkText()` — 500 / 50) and embedding service (`embedTexts()`) as voice notes via [`src/services/vectorise/shared/`](src/services/vectorise/shared/).

### Endpoint

**Cron / batch (primary):**

```
GET /api/story/page-vectorise
```

Runs `runPageVectoriseTick()` ([`src/services/vectorise/page/tick.ts`](src/services/vectorise/page/tick.ts)): selects docs `Page` nodes that need vectorisation, processes up to `VECTORISE_BATCH_SIZE` (3) per invocation with `EXECUTION_TIMEOUT_MS` (8s) guard — same pattern as `runVectoriseTick`.

Route: [`src/app/api/story/page-vectorise/route.ts`](src/app/api/story/page-vectorise/route.ts). Response envelope matches voice-vectorise: `{ status: 'Page vectorise executed', result }`.

**Manual single-page (debug / re-vectorise):** call exported `vectorisePageStage(slug)` from `@/services/vectorise` (script / REPL). No dedicated POST route yet (POST returns 405, matching voice-vectorise).

### Selection query (pages needing work)

Implemented in [`src/services/vectorise/page/neo4j.ts`](src/services/vectorise/page/neo4j.ts) — `pickPagesNeedingVectorisation(limit)`:

```cypher
MATCH (p:Page { source: 'docs' })
WHERE p.embeddings_updated_at IS NULL
   OR p.embeddings_updated_at < p.last_modified
RETURN p.slug AS slug
ORDER BY p.slug
LIMIT $limit
```

### Fetch contract (docs serve)

Implemented as `fetchDocsPageContent(slug)` in [`src/services/docs/client.ts`](src/services/docs/client.ts):

```ts
const res = await fetch(
  `${process.env.DOCS_APP_URL}/api/serve/${encodeURIComponent(slug)}`,
  { headers: { Authorization: `Bearer ${process.env.PRIVATE_API_TOKEN}` } }
);
if (!res.ok) throw new Error(`serve failed for ${slug}: ${res.status}`);
const content = await res.text(); // frontmatter-stripped markdown
```

### Behaviour (per slug processed)

`vectorisePageStage(slug)` in [`src/services/vectorise/page/stage.ts`](src/services/vectorise/page/stage.ts):

1. Calls `fetchDocsPageContent(slug)`.
2. If empty/whitespace: logs warn, sets `embeddings_updated_at`, returns `'skipped'`.
3. `chunkText(content)` → `embedTexts(chunks)` → maps to `PageChunkInput[]`.
4. `upsertPageChunks(slug, inputs)` — orphan cleanup + MERGE; `markPageVectorised(slug)`.
5. On error: logs and returns `'failed'` (page re-selected on next tick via `last_modified` comparison).

Batch tick processes one batch per cron invocation; cron runs every 15 minutes so backlog clears steadily.

### Chunk ID scheme

`"{slug}::chunk::{index}"` — deterministic, idempotent re-runs via MERGE on chunk id. Orphan chunks (from shortened pages) are deleted before upsert.

#### PageChunk upsert:
```cypher
MERGE (c:PageChunk { id: $id })
SET c.content = $content,
    c.embedding = $embedding,
    c.chunk_index = $chunk_index,
    c.token_count = $token_count
WITH c
MATCH (p:Page { slug: $slug, source: 'docs' })
MERGE (p)-[:HAS_CHUNK]->(c)
```

#### Page update after completion:
```cypher
MATCH (p:Page { slug: $slug, source: 'docs' })
SET p.embeddings_updated_at = datetime()
```

### Vectorise module layout (shared / voice / page)

| Layer | Path | Role |
|-------|------|------|
| Shared | `vectorise/shared/` | `chunkText`, `embedTexts`, `tickUtils`, `VectoriseStageResult`, batch constants |
| Voice | `vectorise/voice/` | Transcribe + vectorise voice notes (`VoiceChunk`; existing Cypher unchanged) |
| Page | `vectorise/page/` | Page vectorise (`PageChunk` Neo4j, stage, tick) |

Types: `VoiceChunkInput` (voice), `PageChunkInput` (page) — symmetric write-side interfaces.

### Repeatability

Because the serve endpoint is separately addressable and the chunk id scheme is deterministic, vectorisation can be re-run independently:

- After a model change (re-vectorise all pages by iterating slugs via `vectorisePageStage`)
- After a chunking strategy change
- For a single page during debugging

Same decoupling property as the voice note pipeline.

---

## Workstream 4 — Timelining: Vercel Cron

**Status: DONE.**

### `vercel.json`

Docs ingest and page vectorise crons added alongside existing worker and voice-vectorise:

```json
{
  "crons": [
    { "path": "/api/story/worker", "schedule": "0 0 * * *" },
    { "path": "/api/story/voice-vectorise", "schedule": "*/15 * * * *" },
    { "path": "/api/docs/ingest", "schedule": "0 */6 * * *" },
    { "path": "/api/story/page-vectorise", "schedule": "*/15 * * * *" }
  ]
}
```

Ingest runs every 6 hours. Page vectorisation runs every 15 minutes and batch-processes pages where `embeddings_updated_at` is null or older than `last_modified`.

### Cron auth

- **Ingest:** `verifyCronOrInfraRequest` — accepts `x-vercel-cron: 1` (Vercel scheduled GET) or Bearer `PRIVATE_API_TOKEN` (manual POST/curl).
- **Page-vectorise / voice-vectorise:** no auth (existing voice pattern).

### Manual trigger

- Re-ingest metadata: `POST /api/docs/ingest` with `Authorization: Bearer <PRIVATE_API_TOKEN>`.
- Re-vectorise one page: call `vectorisePageStage(slug)` from `@/services/vectorise` (script).
- Run one vectorise batch tick: `GET /api/story/page-vectorise`.

---

## Environment Variables

| Variable | Docs | Timelining |
|---|---|---|
| `PRIVATE_API_TOKEN` | ✓ (Bearer auth for snapshot + serve) | ✓ (same value, used when calling docs; ingest manual runs) |
| `DOCS_APP_URL` | — | ✓ (secret docs deployment URL) |
| `NEO4J_URI` | — | ✓ (existing) |
| `NEO4J_PASSWORD` | — | ✓ (existing) |
| `OPENAI_API_KEY` | — | ✓ (page + voice vectorisation via `embedTexts`) |

---

## Workstream 5 — Verification Script (CLI)

**Status: TODO.** Next workstream — implement against the completed WS2–WS4 layout below.

A standalone script in timelining at `scripts/verify-page-ingest.ts`, runnable directly via `npx tsx`. Uses the same snapshot and Neo4j query logic as the ingest and vectorise pipelines so verification reflects exactly what those endpoints check.

### Usage

```bash
# before ingest — shows what is missing
npx tsx scripts/verify-page-ingest.ts

# after full pipeline — should show full coverage
npx tsx scripts/verify-page-ingest.ts
```

Requires the same env vars as timelining (`DOCS_APP_URL`, `PRIVATE_API_TOKEN`, `NEO4J_URI`, `NEO4J_PASSWORD`). Reads from `.env.local` if present.

### What it does

1. Calls `fetchDocsSnapshot()` — the same call ingest makes — to get the ground-truth list of slugs and checksums from the docs filesystem.
2. For each slug, queries Neo4j for a matching `Page { source: 'docs' }` node and whether it has at least one `PageChunk` via `HAS_CHUNK`.
3. Compares checksum from the snapshot against `Page.checksum` in Neo4j to detect stale nodes (ingested but not reflecting latest content).
4. Optionally flags pages where `embeddings_updated_at` is null or `< last_modified` (vectorisation backlog — same condition as `pickPagesNeedingVectorisation`).
5. Prints a verbose per-page result, then a summary.

### Verbose output format

```
Verifying 186 pages from docs snapshot...

✓  en/concepts/graph-rag          [node ✓] [chunks: 6] [checksum: current] [vectorised: current]
✓  en/concepts/temporal-graph     [node ✓] [chunks: 4] [checksum: current] [vectorised: current]
⚠  en/guides/quickstart           [node ✓] [chunks: 3] [checksum: STALE — ingest needed]
⚠  en/guides/new-page             [node ✓] [chunks: 0] [checksum: current] [vectorised: PENDING]
✗  en/guides/advanced-rag         [node MISSING]
✗  es/reference/api               [node MISSING]

────────────────────────────────────────────
Total pages in docs:       186
Fully synced:              183
Stale (checksum mismatch): 1
Missing from Neo4j:        2
Pages with no chunks:      1
Pages pending vectorise:   1
────────────────────────────────────────────
Result: INCOMPLETE — 4 pages need attention
```

If all pages are present, checksums match, all have `PageChunk` nodes, and none are pending vectorisation, exit `0` with `Result: OK`.

### Shared logic with ingest and vectorise

Extract checksum comparison and page/chunk lookups into a shared utility (e.g. [`src/services/docs/pageVerify.ts`](src/services/docs/pageVerify.ts)) used by the verify script. Reuse existing functions where possible:

| Check | Reuse from |
|-------|------------|
| Snapshot slugs + checksums | `fetchDocsSnapshot()` — [`client.ts`](src/services/docs/client.ts) |
| Neo4j checksum lookup | `getDocsPageChecksum(slug)` — [`pageService.ts`](src/services/docs/pageService.ts) |
| Chunk count / presence | Query `(:Page)-[:HAS_CHUNK]->(:PageChunk)` (same pattern as [`page/neo4j.ts`](src/services/vectorise/page/neo4j.ts)) |
| Vectorisation pending | Same predicate as `pickPagesNeedingVectorisation` — `embeddings_updated_at IS NULL OR < last_modified` |

This ensures verification cannot drift from what ingest and vectorise actually do.

---

## Timelining-side verification

```bash
# Batch vectorise tick
curl "$TIMELINING_URL/api/story/page-vectorise"

# Re-ingest (manual)
curl -X POST -H "Authorization: Bearer $PRIVATE_API_TOKEN" \
  "$TIMELINING_URL/api/docs/ingest"

# Confirm PageChunk nodes in Neo4j
# MATCH (p:Page {slug: 'en/concepts/foo', source: 'docs'})-[:HAS_CHUNK]->(c:PageChunk) RETURN count(c)
```

## Docs-side verification

```bash
# Generate snapshot locally
pnpm exec tsx scripts/generate-pages-snapshot.ts

# Dev server — page count
curl -H "Authorization: Bearer $PRIVATE_API_TOKEN" \
  http://localhost:3000/api/pages/snapshot | jq length

# Serve a known slug (markdown)
curl -H "Authorization: Bearer $PRIVATE_API_TOKEN" \
  http://localhost:3000/api/serve/en/processes/process-infrastructuring/publishing/timelining/ingest

# Serve JSON (includes slug + title)
curl -H "Authorization: Bearer $PRIVATE_API_TOKEN" \
  "http://localhost:3000/api/serve/en/processes/process-infrastructuring/publishing/timelining/ingest?format=json"
```

---

## Out of Scope (this phase)

- Participant resolution — `UnresolvedAuthor` nodes are the end state here; resolution is a separate workstream
- Registration app changes
- Retrieval / Graph RAG query changes
- `:PageChunk` Neo4j vector index (deferred — write path only for now; voice uses `:VoiceChunk` index via `scripts/createVectorIndex.ts`)
- Federation across hub instances — `source: "docs"` and `IngestRun` nodes are the forward-compatible hooks
- DID-based identity
