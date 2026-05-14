import { homedir, platform } from 'node:os';
import path from 'node:path';

export interface DataPathOptions {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}

export interface DataPaths {
  dataDir: string;
  dbPath: string;
}

export function resolveDataPaths({ repoRoot, env = process.env }: DataPathOptions): DataPaths {
  const dataDir = resolveDataDir(env.TASKS_DATA_DIR, repoRoot);
  const dbPath = path.join(dataDir, 'karha.sqlite');
  const allowRepoData = env.KARHA_ALLOW_REPO_DATA === '1';

  if (!allowRepoData && isSubPath(dataDir, repoRoot)) {
    throw new Error(
      `TASKS_DATA_DIR points inside the repository: ${dataDir}. Pick a private path outside the repo.`
    );
  }

  return { dataDir, dbPath };
}

function resolveDataDir(configuredDataDir: string | undefined, repoRoot: string): string {
  if (!configuredDataDir) return defaultDataDir();
  return path.isAbsolute(configuredDataDir)
    ? path.resolve(configuredDataDir)
    : path.resolve(repoRoot, configuredDataDir);
}

function defaultDataDir(): string {
  if (platform() === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'karha');
  }

  if (platform() === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'karha');
  }

  return path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'karha');
}

function isSubPath(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
