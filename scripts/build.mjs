// Builds the Windows x64 offline language-server bundle for OpenIDEA:
// downloads runtimes and servers, assembles a <app-data>/tools mirror, and zips it.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  buildDir,
  cacheDir,
  distDir,
  download,
  ensureDir,
  exists,
  extract,
  findDir,
  info,
  mb,
  rimraf,
  root,
  run,
  runToFile,
  sha256File,
  stageRoot,
  step,
  treeSize,
  warn,
  workDir,
} from "./lib/util.mjs";
import { debugpy, jdtls, javaDebug, jsDebug, loadResolvedCache, marksman, nodeLts, openideaHead, ruff, taplo, temurin } from "./lib/sources.mjs";
import { installPackages, readInstalled, writeBinWrappers } from "./lib/npm.mjs";
import { writeJdtlsLauncher, writeJsDebugLauncher } from "./lib/launchers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(root, "bundle.config.json"), "utf8"));
const argv = process.argv.slice(2);
const shouldVerify = argv.includes("--verify");

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const bundleVersion = process.env.BUNDLE_VERSION || stamp;
const folderName = `${config.id}-${config.platform}-${bundleVersion}`;
const stage = path.join(stageRoot, folderName);
const payload = path.join(stage, "payload");
const components = [];
const tools = [];
let nodeVersion = "";
let jdkDirName = "";

const record = (entry) => {
  components.push(entry);
  info(`${entry.name} ${entry.version}`);
};

async function findFile(dir, name, depth = 4) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  }
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findFile(path.join(dir, e.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

async function findFileMatch(dir, pattern, depth = 5) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && pattern.test(e.name)) return path.join(dir, e.name);
  }
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findFileMatch(path.join(dir, e.name), pattern, depth - 1);
    if (found) return found;
  }
  return null;
}

function zipTree(srcDir, zipFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-a", "-cf", zipFile, "-C", path.dirname(srcDir), path.basename(srcDir)], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code === 0) return resolve(zipFile);
      // Fallback for tar builds without -a.
      const ps = await run("powershell", [
        "-NoProfile",
        "-Command",
        `Compress-Archive -LiteralPath '${srcDir.replace(/'/g, "''")}' -DestinationPath '${zipFile.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`,
      ]);
      if (ps.code === 0) return resolve(zipFile);
      reject(new Error("zip failed"));
    });
  });
}

async function installedAppVersion() {
  const exe = path.join(process.env.LOCALAPPDATA ?? "", "OpenIDEA", "openidea.exe");
  if (!(await exists(exe))) return null;
  const out = await runToFile(`(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`, path.join(buildDir, "app-version.txt"));
  return out || null;
}

// ---------------------------------------------------------------------------
step(`Resolving component versions (bundle ${bundleVersion})`);
await loadResolvedCache();
const [node, jdk, eclipseJdtls, jsdbg, javadbg, mark, taploBin, ruffBin, debugpyWheel, head] = await Promise.all([
  nodeLts(),
  temurin(config.jdkFeature),
  jdtls(),
  jsDebug(),
  javaDebug(),
  marksman(),
  taplo(),
  ruff(),
  debugpy(),
  openideaHead(),
]);

await rimraf(stage);
await rimraf(workDir);
await ensureDir(payload);
await ensureDir(cacheDir);
await ensureDir(distDir);

// ---------------------------------------------------------------------------
step("Bundling Node.js");
const nodeZip = await download(node.url, path.join(cacheDir, node.file), { sha256: node.sha256, label: `Node ${node.version}` });
const nodeWork = path.join(workDir, "node");
await extract(nodeZip, nodeWork);
const nodeHome = await findDir(nodeWork, async (d) => exists(path.join(d, "node.exe")));
if (!nodeHome) throw new Error("node.exe not found in the Node archive");
await fs.rename(nodeHome, path.join(payload, "node"));
const nodeExe = path.join(payload, "node", "node.exe");
nodeVersion = node.version;
record({ name: "Node.js", version: nodeVersion, source: node.url });

// ---------------------------------------------------------------------------
step("Installing npm language servers");
const installed = await installPackages(payload, config.npm, nodeExe, path.join(payload, "node"));
await writeBinWrappers(payload, installed);
const npmVersions = new Map(installed.map((p) => [p.name, p.version]));
for (const name of Object.keys(config.npm)) {
  const version = npmVersions.get(name);
  if (!version) throw new Error(`${name} was not installed`);
  info(`${name}@${version}`);
}

// ---------------------------------------------------------------------------
step("Bundling a JDK for jdtls");
const jdkZip = await download(jdk.url, path.join(cacheDir, jdk.file), { sha256: jdk.sha256, label: `Temurin ${jdk.version}` });
const jdkWork = path.join(workDir, "jdk");
await extract(jdkZip, jdkWork);
const isJdkHome = async (d) =>
  (await exists(path.join(d, "release"))) && (await exists(path.join(d, "bin", "java.exe")));
const jdkHome = (await isJdkHome(jdkWork)) ? jdkWork : await findDir(jdkWork, isJdkHome);
if (!jdkHome) throw new Error("no JDK home found in the Temurin archive");
jdkDirName = `temurin-${jdk.version}`;
await ensureDir(path.join(payload, "jdks"));
await fs.rename(jdkHome, path.join(payload, "jdks", jdkDirName));
const releaseFile = await fs.readFile(path.join(payload, "jdks", jdkDirName, "release"), "utf8");
const javaVersion = /JAVA_VERSION="([^"]+)"/.exec(releaseFile)?.[1] ?? jdk.version;
record({ name: "Eclipse Temurin JDK", version: jdk.version, source: jdk.url });
info(`java ${javaVersion}`);

// ---------------------------------------------------------------------------
step("Bundling Eclipse JDT Language Server");
const jdtlsZip = await download(eclipseJdtls.url, path.join(cacheDir, eclipseJdtls.file), {
  sha256: eclipseJdtls.sha256,
  label: `JDT LS ${eclipseJdtls.version}`,
});
const jdtlsWork = path.join(workDir, "jdtls");
await extract(jdtlsZip, jdtlsWork);
const jdtlsRoot = (await exists(path.join(jdtlsWork, "plugins")))
  ? jdtlsWork
  : await findDir(jdtlsWork, async (d) => exists(path.join(d, "plugins")));
if (!jdtlsRoot) throw new Error("no jdtls distribution found");
await fs.rename(jdtlsRoot, path.join(payload, "jdtls"));
const pluginDir = path.join(payload, "jdtls", "plugins");
const launcherJar = (await fs.readdir(pluginDir))
  .filter((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
  .sort()
  .pop();
if (!launcherJar) throw new Error("jdtls launcher jar not found");
if (!(await exists(path.join(payload, "jdtls", "config_win")))) throw new Error("jdtls config_win not found");
await writeJdtlsLauncher(payload, { jdkDir: jdkDirName, launcherJar });
record({ name: "Eclipse JDT LS", version: eclipseJdtls.version, source: eclipseJdtls.url });
tools.push({ name: "jdtls", version: eclipseJdtls.version, command: "jdtls", path: "jdtls/bin/jdtls.cmd" });

// ---------------------------------------------------------------------------
step("Bundling Microsoft java-debug");
const vsix = await download(javadbg.url, path.join(cacheDir, javadbg.file), {
  sha256: javadbg.sha256,
  label: `java-debug ${javadbg.version}`,
  checksumUrl: javadbg.checksumUrl,
});
const vsixWork = path.join(workDir, "java-debug");
await extract(vsix, vsixWork);
const debugJar = await findFileMatch(vsixWork, /^com\.microsoft\.java\.debug\.plugin-.*\.jar$/);
if (!debugJar) throw new Error("java-debug jar not found in the VSIX");
await ensureDir(path.join(payload, "java-debug", "bin"));
await fs.copyFile(debugJar, path.join(payload, "java-debug", "bin", "com.microsoft.java.debug.plugin.jar"));
record({ name: "Microsoft java-debug", version: javadbg.version, source: javadbg.url });
tools.push({
  name: "java-debug",
  version: javadbg.version,
  command: "com.microsoft.java.debug.plugin.jar",
  path: "java-debug/bin/com.microsoft.java.debug.plugin.jar",
});

// ---------------------------------------------------------------------------
step("Bundling vscode-js-debug");
const jsdbgTar = await download(jsdbg.url, path.join(cacheDir, jsdbg.file), {
  sha256: jsdbg.sha256,
  label: `js-debug ${jsdbg.version}`,
});
const jsdbgWork = path.join(workDir, "js-debug");
await extract(jsdbgTar, jsdbgWork);
const jsdbgRoot = await findFile(jsdbgWork, "dapDebugServer.js", 4);
if (!jsdbgRoot) throw new Error("dapDebugServer.js not found in the js-debug archive");
const jsdbgDir = path.dirname(jsdbgRoot);
await fs.rename(jsdbgDir, path.join(payload, "js-debug"));
// Node 23+ detects module syntax; dapDebugServer.js is a CommonJS bundle, so pin it.
await fs.writeFile(
  path.join(payload, "js-debug", "package.json"),
  JSON.stringify({ name: "js-debug-bundle", private: true, type: "commonjs" }, null, 2),
);
await writeJsDebugLauncher(payload);
record({ name: "vscode-js-debug", version: jsdbg.version, source: jsdbg.url });
tools.push({ name: "js-debug", version: jsdbg.version, command: "js-debug-adapter", path: "js-debug/bin/js-debug-adapter.cmd" });

// ---------------------------------------------------------------------------
step("Bundling debugpy");
const wheel = await download(debugpyWheel.url, path.join(cacheDir, debugpyWheel.file), {
  sha256: debugpyWheel.sha256,
  label: `debugpy ${debugpyWheel.version}`,
});
await extract(wheel, path.join(payload, "debugpy", "lib"));
record({ name: "debugpy", version: debugpyWheel.version, source: debugpyWheel.url });
tools.push({ name: "debugpy", version: debugpyWheel.version, command: "python3", path: "debugpy/lib" });

// ---------------------------------------------------------------------------
step("Bundling single-binary servers (marksman, taplo, ruff)");
async function installBinary(name, dl, exeName, sub = "bin") {
  const file = await download(dl.url, path.join(cacheDir, dl.file), { sha256: dl.sha256, label: `${name} ${dl.version}` });
  const dir = path.join(payload, name, sub);
  await ensureDir(dir);
  if (/\.zip$/i.test(dl.file)) {
    const tmp = path.join(workDir, name);
    await extract(file, tmp);
    const exe = await findFile(tmp, exeName, 3);
    if (!exe) throw new Error(`${exeName} not found in ${dl.file}`);
    await fs.copyFile(exe, path.join(dir, exeName));
  } else {
    await fs.copyFile(file, path.join(dir, exeName));
  }
  record({ name, version: dl.version, source: dl.url });
  tools.push({ name, version: dl.version, command: exeName.replace(/\.exe$/i, ""), path: `${name}/${sub}/${exeName}` });
}

await installBinary("marksman", mark, "marksman.exe");
await installBinary("taplo", taploBin, "taplo.exe");
await installBinary("ruff", ruffBin, "ruff.exe");

// ---------------------------------------------------------------------------
step("Recording npm tools");
const npmTools = [
  ["vtsls", "@vtsls/language-server", "vtsls", "node_modules/.bin/vtsls.cmd"],
  ["vue-language-server", "@vue/language-server", "vue-language-server", "node_modules/.bin/vue-language-server.cmd"],
  ["pyright", "pyright", "pyright-langserver", "node_modules/.bin/pyright-langserver.cmd"],
  ["vscode-json-language-server", "vscode-langservers-extracted", "vscode-json-language-server", "node_modules/.bin/vscode-json-language-server.cmd"],
  ["vscode-css-language-server", "vscode-langservers-extracted", "vscode-css-language-server", "node_modules/.bin/vscode-css-language-server.cmd"],
  ["vscode-html-language-server", "vscode-langservers-extracted", "vscode-html-language-server", "node_modules/.bin/vscode-html-language-server.cmd"],
  ["yaml-language-server", "yaml-language-server", "yaml-language-server", "node_modules/.bin/yaml-language-server.cmd"],
];
for (const [name, pkg, command, rel] of npmTools) {
  const version = npmVersions.get(pkg);
  if (!version) throw new Error(`${pkg} missing`);
  tools.push({ name, version, command, path: rel });
}

// ---------------------------------------------------------------------------
step("Writing licenses and manifest");
const licenses = path.join(stage, "licenses");
await ensureDir(licenses);
const notice = [
  `${config.id} ${bundleVersion}`,
  "",
  "Bundled third-party components:",
  ...components.map((c) => `- ${c.name} ${c.version}: ${c.source}`),
  "",
  "Each npm package keeps its own LICENSE file under payload/node_modules/<package>/.",
  "The JDK's licenses are in payload/jdks/<jdk>/legal/.",
  "Node.js's LICENSE is in payload/node/LICENSE.",
  "",
  "This bundle is not affiliated with JetBrains. IntelliJ IDEA is a trademark of JetBrains s.r.o.",
  "",
].join("\n");
await fs.writeFile(path.join(licenses, "NOTICE.txt"), notice);
for (const [from, to] of [
  [path.join(payload, "node", "LICENSE"), "node-LICENSE.txt"],
  [path.join(payload, "jdtls", "LICENSE"), "jdtls-LICENSE.txt"],
  [path.join(payload, "js-debug", "LICENSE"), "js-debug-LICENSE.txt"],
]) {
  if (await exists(from)) await fs.copyFile(from, path.join(licenses, to));
}

const appVersion = await installedAppVersion();
const manifest = {
  schema: 1,
  id: config.id,
  platform: config.platform,
  flavor: config.flavor,
  version: bundleVersion,
  createdAt: new Date().toISOString(),
  openidea: {
    tested: appVersion ?? config.compat.testedAppVersions[0],
    testedVersions: [...new Set([...(config.compat.testedAppVersions ?? []), ...(appVersion ? [appVersion] : [])])],
    minVersion: config.compat.minAppVersion,
    commit: head?.sha ?? null,
    commitDate: head?.date ?? null,
    note: config.compat.note,
  },
  runtimes: { node: nodeVersion, jdk: jdkDirName },
  tools,
  licenses: "licenses/NOTICE.txt",
};
await fs.writeFile(path.join(stage, "bundle.json"), JSON.stringify(manifest, null, 2));

const readme = `OpenIDEA 语言服务器离线包（Windows x64 / 全量）

版本: ${bundleVersion}
适配: OpenIDEA >= ${manifest.openidea.minVersion}（在 ${manifest.openidea.testedVersions.join(", ")} 上验证）
内置运行时: Node.js ${nodeVersion}，Eclipse Temurin JDK ${jdk.version}

包含:
  语言服务器  Java (jdtls)、TypeScript/JavaScript (vtsls)、Vue (vue-language-server)、
              Python (pyright)、Markdown (marksman)、JSON/CSS/HTML (vscode-langservers-extracted)、
              YAML (yaml-language-server)、TOML (taplo)、Ruff
  调试器      Java (java-debug)、JavaScript (js-debug)、Python (debugpy)

安装（二选一）:
  1. 双击 install.cmd（推荐；会先备份同名目录）
  2. 手动把 payload\\ 下的所有文件夹复制到:
     %LOCALAPPDATA%\\ai.l0ng.openidea\\tools\\
     然后重启 OpenIDEA，在 Settings › Languages & Frameworks › Language Servers 里确认状态。

注意: 安装前请退出 OpenIDEA，否则文件会被占用。
`;
await fs.writeFile(path.join(stage, "README.txt"), readme);
// Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI; the Chinese text needs the BOM.
const installer = await fs.readFile(path.join(here, "install.ps1"), "utf8");
await fs.writeFile(path.join(stage, "install.ps1"), `\uFEFF${installer}`);
await fs.copyFile(path.join(here, "install.cmd"), path.join(stage, "install.cmd"));

// ---------------------------------------------------------------------------
step("Verifying the payload");
if (shouldVerify) {
  const r = await run(nodeExe, [path.join(here, "verify.mjs"), "--payload", payload], {});
  if (r.code !== 0) throw new Error("verification failed");
} else {
  warn("skipped (pass --verify to run the LSP handshake tests)");
}

// ---------------------------------------------------------------------------
step("Packing");
const zipName = `${folderName}.zip`;
const zipFile = path.join(distDir, zipName);
await rimraf(zipFile);
await zipTree(stage, zipFile);
const sha = await sha256File(zipFile);
const size = (await fs.stat(zipFile)).size;
await fs.writeFile(`${zipFile}.sha256`, `${sha}  ${zipName}\n`);

const indexFile = path.join(distDir, "index.json");
let index = { schema: 1, bundles: [] };
if (await exists(indexFile)) {
  try {
    index = JSON.parse(await fs.readFile(indexFile, "utf8"));
  } catch {
    /* rebuild */
  }
}
index.bundles = (index.bundles ?? []).filter((b) => !(b.platform === config.platform && b.version === bundleVersion));
index.bundles.unshift({
  version: bundleVersion,
  platform: config.platform,
  flavor: config.flavor,
  file: zipName,
  sha256: sha,
  size,
  minAppVersion: manifest.openidea.minVersion,
  testedAppVersions: manifest.openidea.testedVersions,
  runtimes: manifest.runtimes,
});
index.bundles.sort((a, b) => String(b.version).localeCompare(String(a.version)));
index.latest = index.bundles[0].version;
await fs.writeFile(indexFile, JSON.stringify(index, null, 2));

const notes = `## OpenIDEA 语言服务器离线包 ${bundleVersion}（Windows x64）

适配 **OpenIDEA >= ${manifest.openidea.minVersion}**${appVersion ? `（本机检测到 ${appVersion}）` : ""}${
  head?.sha ? `，openidea 提交 \`${head.sha.slice(0, 7)}\`` : ""
}。

| 组件 | 版本 |
| --- | --- |
${components.map((c) => `| ${c.name} | ${c.version} |`).join("\n")}

- 下载 \`${zipName}\`（${mb(size)}），解压后双击 \`install.cmd\`。
- 校验：\`${sha}\`。
- 需要 OpenIDEA 已安装（默认路径 \`%LOCALAPPDATA%\\OpenIDEA\`）。
`;
await fs.writeFile(path.join(distDir, "RELEASE_NOTES.md"), notes);
await fs.writeFile(path.join(distDir, "lsp-version.txt"), bundleVersion);

const payloadSize = await treeSize(payload);
console.log("");
info(`payload ${mb(payloadSize)}  ->  ${zipName} ${mb(size)}`);
info(`sha256 ${sha}`);
info(`manifest ${path.relative(root, path.join(stage, "bundle.json"))}`);
console.log(`\nVERSION=${bundleVersion}`);
