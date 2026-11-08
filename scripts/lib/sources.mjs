// Resolve the newest version and download URL of every component.
import fs from "node:fs/promises";
import path from "node:path";
import { cacheDir, warn } from "./util.mjs";

const USER_AGENT = "openidea-language-servers-bundle/1.0";
const ghToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const RESOLVED = path.join(cacheDir, "resolved.json");
const MAX_AGE = 6 * 60 * 60 * 1000;

/** Versions change slowly; cached results keep builds working when the API is rate limited. */
const resolved = new Map();

export async function loadResolvedCache() {
  try {
    const data = JSON.parse(await fs.readFile(RESOLVED, "utf8"));
    for (const [key, entry] of Object.entries(data)) {
      if (Date.now() - entry.at < MAX_AGE) resolved.set(key, entry.value);
    }
  } catch {
    /* no cache */
  }
}

async function saveResolvedCache() {
  const data = {};
  for (const [key, value] of resolved) data[key] = { at: Date.now(), value };
  await fs.mkdir(path.dirname(RESOLVED), { recursive: true });
  await fs.writeFile(RESOLVED, JSON.stringify(data, null, 2));
}

async function cached(key, resolve) {
  if (resolved.has(key)) return resolved.get(key);
  const value = await resolve();
  // A `null` (e.g. the commit lookup behind a rate limit) is not worth caching.
  if (value != null) {
    resolved.set(key, value);
    await saveResolvedCache();
  }
  return value;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...(ghToken() ? { authorization: `Bearer ${ghToken()}` } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function head(url) {
  const res = await fetch(url, { method: "HEAD", headers: { "user-agent": USER_AGENT } });
  return res.status;
}

/** Node.js LTS, win-x64 zip, with the published SHA-256 from SHASUMS256.txt. */
async function nodeLtsResolve() {
  const all = await getJson("https://nodejs.org/dist/index.json");
  const lts = all.find((v) => v.lts && v.files.includes("win-x64-zip"));
  if (!lts) throw new Error("no Node.js LTS with a win-x64 zip found");
  const version = lts.version; // v26.13.0
  const name = `node-${version}-win-x64.zip`;
  const sums = await getText(`https://nodejs.org/dist/${version}/SHASUMS256.txt`);
  const line = sums.split("\n").find((l) => l.trim().endsWith(name));
  const sha256 = line ? line.trim().split(/\s+/)[0] : undefined;
  return {
    name: "Node.js",
    version: version.replace(/^v/, ""),
    url: `https://nodejs.org/dist/${version}/${name}`,
    file: name,
    sha256,
  };
}

/** Eclipse Temurin JDK (full JDK image: jdtls bundles need jdk.jdi). */
async function temurinResolve(feature) {
  const url =
    `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot` +
    `?architecture=x64&image_type=jdk&os=windows&vendor=eclipse`;
  const assets = await getJson(url);
  if (!assets.length) throw new Error(`Temurin ${feature} has no Windows x64 JDK`);
  const pkg = assets[0].binary.package;
  return {
    name: "Eclipse Temurin JDK",
    version: assets[0].version.openjdk_version.split("+")[0],
    url: pkg.link,
    file: pkg.name,
    sha256: pkg.checksum?.toLowerCase(),
    size: pkg.size,
  };
}

/** Newest Eclipse JDT LS milestone (download.eclipse.org), plus its tarball name. */
async function jdtlsResolve() {
  const index = await getText("https://download.eclipse.org/jdtls/milestones/");
  const candidates = [...new Set([...index.matchAll(/\b(1\.\d+\.\d+)\b/g)].map((m) => m[1]))]
    .map((v) => v.split(".").map(Number))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
    .map((p) => p.join("."));
  for (let minor = 90; minor >= 40; minor -= 2) candidates.push(`1.${minor}.0`);
  const tried = new Set();
  for (const version of candidates) {
    if (tried.has(version)) continue;
    tried.add(version);
    const base = `https://download.eclipse.org/jdtls/milestones/${version}`;
    if ((await head(`${base}/latest.txt`)) !== 200) continue;
    const name = (await getText(`${base}/latest.txt`)).trim();
    if (!name.endsWith(".tar.gz") || name.includes("/")) continue;
    const sha = (await getText(`${base}/${name}.sha256`)).trim().split(/\s+/)[0];
    return {
      name: "Eclipse JDT Language Server",
      version,
      url: `${base}/${name}`,
      file: name,
      sha256: /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : undefined,
    };
  }
  throw new Error("no JDT LS milestone found");
}

/** Latest GitHub release asset matching `pattern`. */
async function githubAsset(repo, pattern) {
  return cached(`github:${repo}:${pattern}`, async () => {
    try {
      return await githubAssetApi(repo, pattern);
    } catch (e) {
      warn(`GitHub API for ${repo} failed (${e.message}); reading the release page instead`);
      return await githubAssetWeb(repo, pattern);
    }
  });
}

async function githubAssetApi(repo, pattern) {
  const rel = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const asset = rel.assets.find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`${repo}: no asset matching ${pattern} in ${rel.tag_name}`);
  const checksum = rel.assets.find((a) => a.name === `${asset.name}.sha256`);
  return {
    name: repo,
    version: rel.tag_name.replace(/^v/, ""),
    url: asset.browser_download_url,
    file: asset.name,
    sha256: asset.digest?.startsWith("sha256:") ? asset.digest.slice(7).toLowerCase() : undefined,
    checksumUrl: checksum?.browser_download_url,
    size: asset.size,
  };
}

/** No API call: `/releases/latest` redirects to the tag, `expanded_assets` lists the files. */
async function githubAssetWeb(repo, pattern) {
  const latest = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT },
  });
  const tag = decodeURIComponent(new URL(latest.url).pathname.split("/releases/tag/").pop() ?? "");
  if (!tag) throw new Error(`${repo} has no published release`);
  const html = await (
    await fetch(`https://github.com/${repo}/releases/expanded_assets/${tag}`, { headers: { "user-agent": USER_AGENT } })
  ).text();
  const links = [...new Set([...html.matchAll(/href="([^"]*\/releases\/download\/[^"]+)"/g)].map((m) => m[1]))];
  const found = links
    .map((href) => ({ href, name: decodeURIComponent(href.split("/").pop()) }))
    .find((a) => pattern.test(a.name));
  if (!found) throw new Error(`${repo}: no asset matching ${pattern} in ${tag}`);
  return {
    name: repo,
    version: tag.replace(/^v/, ""),
    url: `https://github.com${found.href}`,
    file: found.name,
  };
}

export const jsDebug = () => githubAsset("microsoft/vscode-js-debug", /^js-debug-dap-.*\.tar\.gz$/);
export const marksman = () => githubAsset("artempyanykh/marksman", /^marksman\.exe$/);
export const taplo = () => githubAsset("tamasfe/taplo", /^taplo-windows-x86_64\.zip$/);
export const ruff = () => githubAsset("astral-sh/ruff", /^ruff-x86_64-pc-windows-msvc\.zip$/);

/** Microsoft java-debug (the jdtls bundle) from Open VSX. */
async function javaDebugResolve() {
  const meta = await getJson("https://open-vsx.org/api/vscjava/vscode-java-debug/latest");
  return {
    name: "Microsoft java-debug",
    version: meta.version,
    url: meta.files.download,
    file: path.basename(new URL(meta.files.download).pathname),
    checksumUrl: meta.files.sha256,
  };
}

/** debugpy, the universal wheel (pure Python; runs on the project's interpreter). */
async function debugpyResolve() {
  const meta = await getJson("https://pypi.org/pypi/debugpy/json");
  const version = meta.info.version;
  const files = meta.releases[version].filter((f) => f.filename.endsWith(".whl") && f.filename.includes("none-any"));
  const wheel = files[0];
  if (!wheel) throw new Error(`debugpy ${version} has no universal wheel`);
  return {
    name: "debugpy",
    version,
    url: wheel.url,
    file: wheel.filename,
    sha256: wheel.digests?.sha256,
  };
}

/** The openidea commit the tool names/commands were taken from. */
async function openideaHeadResolve() {
  try {
    const commit = await getJson("https://api.github.com/repos/l0ng-ai/openidea/commits/main");
    return { sha: commit.sha, date: commit.commit?.committer?.date, message: commit.commit?.message?.split("\n")[0] };
  } catch (e) {
    warn(`GitHub API for the openidea commit failed (${e.message}); reading the commits page instead`);
  }
  try {
    // The commits page has the SHA in its links and needs no API quota.
    const html = await getText("https://github.com/l0ng-ai/openidea/commits/main");
    const sha = /\/commit\/([0-9a-f]{40})/.exec(html)?.[1];
    if (sha) return { sha, date: null, message: null };
  } catch (e) {
    warn(`could not read the openidea commit: ${e.message}`);
  }
  return null;
}

export async function liveCheck(url) {
  try {
    const status = await head(url);
    return status === 200;
  } catch {
    return false;
  }
}

// Resolved versions are cached (build/cache/resolved.json) to survive GitHub API rate limits.
export const nodeLts = () => cached("node", nodeLtsResolve);
export const temurin = (feature) => cached(`temurin:${feature}`, () => temurinResolve(feature));
export const jdtls = () => cached("jdtls", jdtlsResolve);
export const javaDebug = () => cached("java-debug", javaDebugResolve);
export const debugpy = () => cached("debugpy", debugpyResolve);
export const openideaHead = () => cached("openidea-head", openideaHeadResolve);

