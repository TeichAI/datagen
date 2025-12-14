import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type UpdateCache = {
  checkedAt: number;
  latest: string | null;
};

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null
  };
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  if (!l || !c) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return c.prerelease !== null && l.prerelease === null;
}

function getCacheFilePath(packageName: string): string {
  const base =
    (typeof process.env.XDG_CACHE_HOME === "string" && process.env.XDG_CACHE_HOME.trim()) ||
    join(homedir(), ".cache");
  return join(base, "datagen", `${packageName.replaceAll("/", "__")}.update.json`);
}

function getUpgradeCommand(packageName: string): string {
  const entry = process.argv[1] ?? "";
  const isLocalBin = /node_modules[\\/]\.bin[\\/]/.test(entry);
  return isLocalBin ? `npm i ${packageName}@latest` : `npm i -g ${packageName}@latest`;
}

async function readCache(cacheFilePath: string): Promise<UpdateCache | null> {
  try {
    const raw = await fs.readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof parsed.checkedAt !== "number") return null;
    if (typeof parsed.latest !== "string" && parsed.latest !== null) return null;
    return { checkedAt: parsed.checkedAt, latest: parsed.latest ?? null };
  } catch {
    return null;
  }
}

async function writeCache(cacheFilePath: string, cache: UpdateCache): Promise<void> {
  const dir = dirname(cacheFilePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheFilePath, JSON.stringify(cache), "utf8");
}

async function fetchLatestFromNpm(packageName: string, timeoutMs: number): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
      signal: ac.signal,
      headers: {
        accept: "application/vnd.npm.install-v1+json"
      }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const latest = data?.["dist-tags"]?.latest;
    return typeof latest === "string" ? latest : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function maybeNotifyNewVersion(opts: {
  cliName: string;
  packageName: string;
  currentVersion: string;
  timeoutMs?: number;
  cacheMaxAgeMs?: number;
}): Promise<void> {
  if (isTruthyEnv(process.env.DATAGEN_DISABLE_UPDATE_CHECK)) return;
  if (!process.stderr.isTTY) return;

  const timeoutMs = Math.max(50, opts.timeoutMs ?? 800);
  const cacheMaxAgeMs = Math.max(0, opts.cacheMaxAgeMs ?? 12 * 60 * 60 * 1000);

  const cacheFilePath = getCacheFilePath(opts.packageName);
  const cached = await readCache(cacheFilePath);
  const now = Date.now();

  let latest: string | null = null;
  if (cached && now - cached.checkedAt <= cacheMaxAgeMs) {
    latest = cached.latest;
  } else {
    latest = await fetchLatestFromNpm(opts.packageName, timeoutMs);
    try {
      await writeCache(cacheFilePath, { checkedAt: now, latest });
    } catch {
      // best-effort only
    }
  }

  if (!latest) return;
  if (!isNewerVersion(latest, opts.currentVersion)) return;

  const upgrade = getUpgradeCommand(opts.packageName);
  process.stderr.write(
    `\nUpdate available: ${opts.cliName} ${opts.currentVersion} -> ${latest}\nRun: ${upgrade}\n\n`
  );
}
