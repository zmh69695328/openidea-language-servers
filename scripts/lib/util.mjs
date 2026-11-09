// Small, dependency-free helpers: paths, hashing, downloads, archives, processes.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const root = path.resolve(process.cwd());
export const buildDir = path.join(root, "build");
export const cacheDir = path.join(buildDir, "cache");
export const workDir = path.join(buildDir, "work");
export const stageRoot = path.join(buildDir, "stage");
export const distDir = path.join(root, "dist");

export const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function step(msg) {
  console.log(`\n== ${msg}`);
}
export function info(msg) {
  console.log(`   ${msg}`);
}
export function warn(msg) {
  console.warn(`   ! ${msg}`);
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function rimraf(p) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await fs.rm(p, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch (e) {
      if (attempt === 4) throw e;
      // Windows keeps a directory busy while a test server is still shutting down.
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

const USER_AGENT = "openidea-language-servers-bundle/1.0 (+https://github.com/l0ng-ai/openidea)";

/** Download with cache, retries, progress and optional SHA-256 verification. */
export async function download(url, dest, { sha256, label = path.basename(dest) } = {}) {
  if (await exists(dest)) {
    if (!sha256 || (await sha256File(dest)).toLowerCase() === sha256.toLowerCase()) {
      info(`cached ${label}`);
      return dest;
    }
    warn(`cached ${label} does not match its checksum; downloading again`);
    await fs.rm(dest, { force: true });
  }
  await ensureDir(path.dirname(dest));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        // Decompressed bodies make content-length unreliable; SHA-256 is the real check.
        headers: { "user-agent": USER_AGENT, "accept-encoding": "identity" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      const total = Number(res.headers.get("content-length") || 0);
      const tmp = `${dest}.part`;
      const out = createWriteStream(tmp);
      let received = 0;
      let reported = -20;
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
          received += chunk.length;
          const pct = total ? Math.floor((received / total) * 100) : 0;
          if (pct >= reported + 20) {
            info(`${label} ${total ? `${pct}%` : mb(received)}`);
            reported = pct;
          }
        }
      } finally {
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      }
      if (total && received !== total) warn(`${label}: ${received} bytes (content-length said ${total})`);
      if (sha256 && (await sha256File(tmp)).toLowerCase() !== sha256.toLowerCase()) {
        throw new Error(`checksum mismatch for ${label}`);
      }
      await fs.rename(tmp, dest);
      info(`${label} ${mb(received)}`);
      return dest;
    } catch (e) {
      lastError = e;
      warn(`attempt ${attempt} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}

/** Extract a .zip / .tar.gz with the system tar (bsdtar on Windows handles both). */
export async function extract(archive, dest) {
  await ensureDir(dest);
  const isZip = /\.zip$/i.test(archive);
  const r = await run("tar", ["-xf", archive, "-C", dest]);
  if (r.code === 0) return dest;
  if (isZip) {
    const ps = await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ]);
    if (ps.code === 0) return dest;
  }
  throw new Error(`cannot extract ${archive}`);
}

/**
 * Run a program without pipes (the sandbox denies pipe stdio). Returns the exit code.
 * `stdio: "inherit"` shows output; `"ignore"` keeps it quiet.
 */
export function run(cmd, args, { cwd, env, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: cwd || root,
      env: env ? { ...process.env, ...env } : process.env,
      stdio,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

/** Runs PowerShell and has it write `expression` to `file` (no pipe needed). */
export async function runToFile(expression, file) {
  await ensureDir(path.dirname(file));
  const command = `${expression} | Out-File -FilePath '${file.replace(/'/g, "''")}' -Encoding utf8 -Force`;
  const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "ignore" });
  if (r.code !== 0) return null;
  const text = await fs.readFile(file, "utf8");
  await fs.rm(file, { force: true });
  return text.trim();
}

/** Run a .cmd/.bat through cmd.exe (Node cannot spawn batch files directly). */
export function runBatch(cmd, args, opts = {}) {
  const quote = (s) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const line = `"${cmd}" ${args.map(quote).join(" ")}`;
  return run("cmd.exe", ["/d", "/s", "/c", line], opts);
}

/** First existing directory that looks like `name` inside `dir`. */
export async function findDir(dir, test) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (await test(p)) return p;
  }
  return null;
}

export async function copyDir(src, dest) {
  await fs.cp(src, dest, { recursive: true });
}

/** Bytes of a whole directory tree, for the manifest. */
export async function treeSize(dir) {
  let total = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await treeSize(p) : (await fs.stat(p)).size;
  }
  return total;
}
