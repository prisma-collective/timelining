import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class CodemodFs {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
  }

  readFile(relPath) {
    return fs.readFileSync(path.join(this.repoRoot, relPath), 'utf8');
  }

  writeFile(relPath, content) {
    const full = path.join(this.repoRoot, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  readJson(relPath) {
    return JSON.parse(this.readFile(relPath));
  }

  writeJson(relPath, value, indent = 2) {
    this.writeFile(relPath, `${JSON.stringify(value, null, indent)}\n`);
  }
}

function runGit(args) {
  execSync(['git', ...args].join(' '), { stdio: 'inherit' });
}

const repoRoot = process.cwd();
const codemods = (process.env.PROPAGATE_CODEMODS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (codemods.length === 0) {
  console.log('No codemods configured');
  process.exit(0);
}

const ctx = {
  deployment: { slug: process.env.PROPAGATE_DEPLOYMENT_SLUG ?? '' },
  stack: {
    metadata: JSON.parse(process.env.PROPAGATE_METADATA_JSON ?? '{}'),
    dns: { eventCode: process.env.PROPAGATE_EVENT_CODE ?? '' },
  },
  app: {
    slug: process.env.PROPAGATE_APP_SLUG ?? '',
    url: process.env.PROPAGATE_APP_URL ?? '',
    env: {},
  },
  provider: {
    vercel: { plan: process.env.PROPAGATE_VERCEL_PLAN === 'pro' ? 'pro' : 'hobby' },
  },
};

const fsApi = new CodemodFs(repoRoot);

for (const relPath of codemods) {
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Codemod not found: ${relPath}`);
  }

  const mod = await import(pathToFileURL(absPath).href);
  if (typeof mod.default !== 'function') {
    throw new Error(`Codemod ${relPath} must export a default async function`);
  }

  await mod.default(ctx, fsApi);
}

console.log(`Ran ${codemods.length} codemod(s)`);

try {
  execSync('git diff --quiet', { stdio: 'ignore' });
  console.log('No codemod changes to commit');
  process.exit(0);
} catch {
  // dirty tree — commit below
}

runGit(['config', 'user.name', 'propagate[bot]']);
runGit(['config', 'user.email', 'propagate[bot]@users.noreply.github.com']);
runGit(['add', '-A']);
runGit(['commit', '-m', 'propagate: apply deployment codemods']);
runGit(['push']);
