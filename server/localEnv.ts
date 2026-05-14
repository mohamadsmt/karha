import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadLocalEnv(repoRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const envPath = path.join(repoRoot, '.env.local');
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (env[key] !== undefined) continue;
    env[key] = parseEnvValue(rawValue.trim());
  }
}

function parseEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
