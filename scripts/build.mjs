// Builds the Windows x64 offline language-server bundle for OpenIDEA:
// downloads runtimes and servers, assembles a <app-data>/tools mirror with
// per-component ownership, and zips it together with the GUI installer.
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
import {
  debugpy,
  goToolchain,
  goplsVersion,
  groovyServer,
  jdtls,
  javaDebug,
  jsDebug,
  lemminx,
  loadResolvedCache,
  marksman,
  nodeLts,
  openideaHead,
  ruff,
  sqls,
  taplo,
  temurin,
} from "./lib/sources.mjs";
import { installPackages, readInstalled, writeBinWrappers } from "./lib/npm.mjs";
import { writeGroovyLauncher, writeJdtlsLauncher, writeJsDebugLauncher } from "./lib/launchers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse((await fs.readFile(path.join(root, "bundle.config.json"), "utf8")).replace(/^\uFEFF/, ""));
const argv = process.argv.slice(2);
const shouldVerify = argv.includes("--verify");

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const bundleVersion = process.env.BUNDLE_VERSION || stamp;
const folderName = `${config.id}-${config.platform}-${bundleVersion}`;
const stage = path.join(stageRoot, folderName);
const payload = path.join(stage, "payload");
const components = new Map(); // id -> { paths:Set, version, deps }
const components3rd = [];
let nodeVersion = "";
let jdkDirName = "";

const record = (entry) => {
  components3rd.push(entry);
  info(`${entry.name} ${entry.version}`);
};

// ---------------------------------------------------------------------------
// component ownership

const NPM_OWNERS = new Map([
  ["@vtsls/language-server", "ts"],
  ["typescript", "ts"],
  ["@vue/language-server", "vue"],
  ["pyright", "python"],
  ["bash-language-server", "bash"],
  ["vscode-langservers-extracted", "data"],
  ["yaml-language-server", "data"],
]);

const META = {
  "runtime-node": {
    name: "Node.js 运行时",
    category: "运行时",
    desc: "运行 TypeScript、Vue、Bash、Pyright、JSON/YAML 等用 JavaScript 编写的服务器；不装则这些语言全部不可用。",
    deps: [],
  },
  "runtime-jdk": {
    name: "Eclipse Temurin JDK 25",
    category: "运行时",
    desc: "运行 Java（JDT LS）和 Groovy 语言服务器，并为 Java 调试器提供 jdk.jdi。项目本身仍可单独选择 JDK。",
    deps: [],
  },
  ts: {
    name: "TypeScript / JavaScript",
    category: "语言",
    desc: "vtsls 提供补全、跳转、重构、重命名与诊断，TypeScript 6 是它加载的编译器；另含 js-debug 调试适配器。",
    deps: ["runtime-node","npm-shared"],
  },
  vue: {
    name: "Vue",
    category: "语言",
    desc: "Vue 单文件组件（.vue）的模板、脚本与样式智能提示，复用 TypeScript 服务处理脚本部分。",
    deps: ["runtime-node","ts","npm-shared"],
  },
  python: {
    name: "Python",
    category: "语言",
    desc: "Pyright 做类型检查与补全，Ruff 提供 lint 与格式化，debugpy 提供 Python 调试适配器。",
    deps: ["runtime-node","npm-shared"],
  },
  java: {
    name: "Java",
    category: "语言",
    desc: "Eclipse JDT LS 提供完整的 Java 语言功能；Microsoft java-debug 让 IDE 能启动并断点调试 Java 程序。",
    deps: ["runtime-jdk"],
  },
  go: {
    name: "Go",
    category: "语言",
    desc: "gopls 提供补全、跳转、重构与诊断。分析模块仍需本机安装 Go SDK（IDE 里设置 GOROOT 即可）。",
    deps: [],
  },
  groovy: {
    name: "Groovy",
    category: "语言",
    desc: "Prominic Groovy 语言服务器，为 Groovy 脚本、Gradle DSL 和 Jenkinsfile 提供补全与诊断。",
    deps: ["runtime-jdk"],
  },
  xml: {
    name: "XML",
    category: "语言",
    desc: "LemMinX 提供 XML 校验、补全与格式化，支持 XSD/DTD 与 catalogs。",
    deps: [],
  },
  bash: {
    name: "Bash / Shell",
    category: "语言",
    desc: "bash-language-server 提供 shell 脚本的补全、跳转与诊断；配合 shellcheck/shfmt 效果更好。",
    deps: ["runtime-node","npm-shared"],
  },
  sql: {
    name: "SQL",
    category: "语言",
    desc: "sqls 提供 SQL 补全、格式化与跳转，连接信息来自项目的 sqls 配置。",
    deps: [],
  },
  markdown: {
    name: "Markdown",
    category: "语言",
    desc: "Marksman 提供链接补全、文件跳转与重命名，适合文档仓库。",
    deps: [],
  },
  data: {
    name: "JSON / YAML / TOML / CSS / HTML",
    category: "语言",
    desc: "vscode-langservers 处理 JSON、CSS、HTML 的 schema 校验与格式化，yaml-language-server 处理 YAML，Taplo 处理 TOML。",
    deps: ["runtime-node","npm-shared"],
  },
  "npm-shared": {
    name: "npm 公共依赖",
    category: "依赖",
    desc: "上面几个 npm 组件共用的第三方包；安装任一 npm 组件时会自动带上，不需要单独勾选。",
    deps: ["runtime-node"],
  },
};

const ORDER = [
  "runtime-node",
  "runtime-jdk",
  "ts",
  "vue",
  "python",
  "java",
  "go",
  "groovy",
  "xml",
  "bash",
  "sql",
  "markdown",
  "data",
  "npm-shared",
];

function own(id) {
  if (!components.has(id)) components.set(id, { paths: new Set(), deps: META[id].deps, version: "" });
  return components.get(id);
}
const addPath = (id, rel) => own(id).paths.add(rel.replace(/\\/g, "/"));

// ---------------------------------------------------------------------------
// helpers

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
  const out = await runToFile(
    `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`,
    path.join(buildDir, "app-version.txt"),
  );
  return out || null;
}

async function installBinary(componentId, name, dl, exeName) {
  const file = await download(dl.url, path.join(cacheDir, dl.file), { sha256: dl.sha256, label: `${name} ${dl.version}` });
  const dir = path.join(payload, name, "bin");
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
  addPath(componentId, `${name}/bin/${exeName}`);
}

// ---------------------------------------------------------------------------
step(`Resolving component versions (bundle ${bundleVersion})`);
await loadResolvedCache();

const [node, jdk, eclipseJdtls, jsdbg, javadbg, mark, taploBin, ruffBin, debugpyWheel, lemminxBin, sqlsBin, groovy, go, gopls, head] =
  await Promise.all([
    nodeLts(),
    temurin(config.jdkFeature),
    jdtls(),
    jsDebug(),
    javaDebug(),
    marksman(),
    taplo(),
    ruff(),
    debugpy(),
    lemminx(),
    sqls(),
    groovyServer(),
    goToolchain(),
    goplsVersion(),
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
own("runtime-node").version = `Node ${nodeVersion}`;
addPath("runtime-node", "node");

// ---------------------------------------------------------------------------
step("Installing npm language servers");
const installed = await installPackages(payload, config.npm, nodeExe, path.join(payload, "node"));
await writeBinWrappers(payload, installed);
const npmVersions = new Map(installed.map((p) => [p.name, p.version]));
for (const name of Object.keys(config.npm)) {
  if (!npmVersions.get(name)) throw new Error(`${name} was not installed`);
  info(`${name}@${npmVersions.get(name)}`);
}
addPath("runtime-node", "node_modules/.bin/node.cmd");
for (const pkg of installed) {
  const owner = NPM_OWNERS.get(pkg.name) ?? "npm-shared";
  addPath(owner, path.relative(payload, pkg.dir));
  for (const command of Object.keys(pkg.bin ?? {})) addPath(owner, `node_modules/.bin/${command}.cmd`);
}

// ---------------------------------------------------------------------------
step("Bundling a JDK for jdtls and Groovy");
const jdkZip = await download(jdk.url, path.join(cacheDir, jdk.file), { sha256: jdk.sha256, label: `Temurin ${jdk.version}` });
const jdkWork = path.join(workDir, "jdk");
await extract(jdkZip, jdkWork);
const isJdkHome = async (d) => (await exists(path.join(d, "release"))) && (await exists(path.join(d, "bin", "java.exe")));
const jdkHome = (await isJdkHome(jdkWork)) ? jdkWork : await findDir(jdkWork, isJdkHome);
if (!jdkHome) throw new Error("no JDK home found in the Temurin archive");
jdkDirName = `temurin-${jdk.version}`;
await ensureDir(path.join(payload, "jdks"));
await fs.rename(jdkHome, path.join(payload, "jdks", jdkDirName));
const releaseFile = await fs.readFile(path.join(payload, "jdks", jdkDirName, "release"), "utf8");
record({ name: "Eclipse Temurin JDK", version: (releaseFile.match(/JAVA_VERSION="([^"]+)"/) ?? [])[1] ?? jdk.version, source: jdk.url });
own("runtime-jdk").version = `Temurin ${jdk.version}`;
addPath("runtime-jdk", `jdks/${jdkDirName}`);

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
const launcherJar = (await fs.readdir(path.join(payload, "jdtls", "plugins")))
  .filter((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
  .sort()
  .pop();
if (!launcherJar) throw new Error("jdtls launcher jar not found");
await writeJdtlsLauncher(payload, { jdkDir: jdkDirName, launcherJar });
record({ name: "Eclipse JDT LS", version: eclipseJdtls.version, source: eclipseJdtls.url });
addPath("java", "jdtls");

// ---------------------------------------------------------------------------
step("Bundling Microsoft java-debug");
const vsix = await download(javadbg.url, path.join(cacheDir, javadbg.file), {
  sha256: javadbg.sha256,
  label: `java-debug ${javadbg.version}`,
});
const vsixWork = path.join(workDir, "java-debug");
await extract(vsix, vsixWork);
const debugJar = await findFileMatch(vsixWork, /^com\.microsoft\.java\.debug\.plugin-.*\.jar$/);
if (!debugJar) throw new Error("java-debug jar not found in the VSIX");
await ensureDir(path.join(payload, "java-debug", "bin"));
await fs.copyFile(debugJar, path.join(payload, "java-debug", "bin", "com.microsoft.java.debug.plugin.jar"));
record({ name: "Microsoft java-debug", version: javadbg.version, source: javadbg.url });
addPath("java", "java-debug");

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
await fs.rename(path.dirname(jsdbgRoot), path.join(payload, "js-debug"));
await fs.writeFile(
  path.join(payload, "js-debug", "package.json"),
  JSON.stringify({ name: "js-debug-bundle", private: true, type: "commonjs" }, null, 2),
);
await writeJsDebugLauncher(payload);
record({ name: "vscode-js-debug", version: jsdbg.version, source: jsdbg.url });
addPath("ts", "js-debug");

// ---------------------------------------------------------------------------
step("Bundling debugpy");
const wheel = await download(debugpyWheel.url, path.join(cacheDir, debugpyWheel.file), {
  sha256: debugpyWheel.sha256,
  label: `debugpy ${debugpyWheel.version}`,
});
await extract(wheel, path.join(payload, "debugpy", "lib"));
record({ name: "debugpy", version: debugpyWheel.version, source: debugpyWheel.url });
addPath("python", "debugpy");

// ---------------------------------------------------------------------------
step("Bundling single-binary servers (marksman, taplo, ruff, lemminx, sqls)");
await installBinary("markdown", "marksman", mark, "marksman.exe");
await installBinary("data", "taplo", taploBin, "taplo.exe");
await installBinary("python", "ruff", ruffBin, "ruff.exe");
await installBinary("sql", "sqls", sqlsBin, "sqls.exe");

// LemMinX is a single native exe inside a zip.
const lemminxFile = await download(lemminxBin.url, path.join(cacheDir, lemminxBin.file), {
  sha256: lemminxBin.sha256,
  label: `lemminx ${lemminxBin.version}`,
});
const lemminxTmp = path.join(workDir, "lemminx");
await extract(lemminxFile, lemminxTmp);
const lemminxExe = (await findFile(lemminxTmp, "lemminx-win32.exe", 3)) ?? (await findFile(lemminxTmp, "lemminx.exe", 3));
if (!lemminxExe) throw new Error("lemminx exe not found in the archive");
await ensureDir(path.join(payload, "lemminx", "bin"));
await fs.copyFile(lemminxExe, path.join(payload, "lemminx", "bin", "lemminx.exe"));
record({ name: "LemMinX", version: lemminxBin.version, source: lemminxBin.url });
addPath("xml", "lemminx/bin/lemminx.exe");

// ---------------------------------------------------------------------------
step("Bundling Groovy language server");
const groovyFile = await download(groovy.url, path.join(cacheDir, groovy.file), {
  label: `groovy ${groovy.version}`,
});
const groovyTmp = path.join(workDir, "groovy");
await extract(groovyFile, groovyTmp);
const groovyJar = await findFileMatch(groovyTmp, /^groovy-language-server-all\.jar$/);
if (!groovyJar) throw new Error("groovy-language-server-all.jar not found in the VSIX");
await ensureDir(path.join(payload, "groovy-language-server", "bin"));
await fs.copyFile(groovyJar, path.join(payload, "groovy-language-server", "bin", "groovy-language-server-all.jar"));
await writeGroovyLauncher(payload, { jdkDir: jdkDirName, jarName: "groovy-language-server-all.jar" });
record({ name: "Groovy Language Server", version: groovy.version, source: groovy.url });
addPath("groovy", "groovy-language-server");

// ---------------------------------------------------------------------------
step(`Building gopls v${gopls} with Go ${go.version}`);
const goZip = await download(go.url, path.join(cacheDir, go.file), { sha256: go.sha256, label: `Go ${go.version}` });
const goWork = path.join(workDir, "go");
await extract(goZip, goWork);
const goHome = await findDir(goWork, async (d) => exists(path.join(d, "bin", "go.exe")));
if (!goHome) throw new Error("go.exe not found in the toolchain archive");
const goplsOut = path.join(workDir, "gopls");
const goEnv = {
  GOBIN: path.join(goplsOut, "bin"),
  GOPATH: path.join(goplsOut, "gopath"),
  GOCACHE: path.join(goplsOut, "cache"),
  GOTMPDIR: path.join(goplsOut, "tmp"),
  GOENV: "off",
  GOFLAGS: "",
};
for (const d of Object.values(goEnv)) if (d) await ensureDir(d);
const goRun = await run(path.join(goHome, "bin", "go.exe"), ["install", `golang.org/x/tools/gopls@v${gopls}`], {
  env: goEnv,
  cwd: goplsOut,
});
if (goRun.code !== 0) throw new Error("go install gopls failed");
await ensureDir(path.join(payload, "gopls", "bin"));
await fs.copyFile(path.join(goplsOut, "bin", "gopls.exe"), path.join(payload, "gopls", "bin", "gopls.exe"));
record({ name: "gopls", version: gopls, source: `go install golang.org/x/tools/gopls@v${gopls}` });
addPath("go", "gopls");

// ---------------------------------------------------------------------------
step("Writing components and manifest");
const versions = {
  ts: `TypeScript ${npmVersions.get("typescript")} · vtsls ${npmVersions.get("@vtsls/language-server")} · js-debug ${jsdbg.version}`,
  vue: `vue-language-server ${npmVersions.get("@vue/language-server")}`,
  python: `Pyright ${npmVersions.get("pyright")} · Ruff ${ruffBin.version} · debugpy ${debugpyWheel.version}`,
  java: `JDT LS ${eclipseJdtls.version} · java-debug ${javadbg.version}`,
  bash: `bash-language-server ${npmVersions.get("bash-language-server")}`,
  data: `vscode-langservers ${npmVersions.get("vscode-langservers-extracted")} · YAML ${npmVersions.get("yaml-language-server")} · Taplo ${taploBin.version}`,
  go: `gopls ${gopls}`,
  groovy: `Groovy LSP ${groovy.version}`,
  xml: `LemMinX ${lemminxBin.version}`,
  sql: `sqls ${sqlsBin.version}`,
  markdown: `Marksman ${mark.version}`,
  "npm-shared": "随 npm 组件",
};
for (const [id, version] of Object.entries(versions)) own(id).version = version;

const componentList = [];
for (const id of ORDER) {
  const c = components.get(id);
  if (!c) continue;
  let size = 0;
  for (const rel of c.paths) {
    const p = path.join(payload, rel);
    try {
      const st = await fs.stat(p);
      size += st.isFile() ? st.size : await treeSize(p);
    } catch {
      warn(`component ${id}: missing ${rel}`);
    }
  }
  componentList.push({
    id,
    name: META[id].name,
    category: META[id].category,
    description: META[id].desc,
    version: c.version,
    deps: c.deps,
    paths: [...c.paths].sort(),
    sizeBytes: size,
  });
}

const licenses = path.join(stage, "licenses");
await ensureDir(licenses);
await fs.writeFile(
  path.join(licenses, "NOTICE.txt"),
  [
    `${config.id} ${bundleVersion}`,
    "",
    "Bundled third-party components:",
    ...components3rd.map((c) => `- ${c.name} ${c.version}: ${c.source}`),
    "",
    "Each npm package keeps its own LICENSE file under payload/node_modules/<package>/.",
    "The JDK's licenses are in payload/jdks/<jdk>/legal/.",
    "Node.js's LICENSE is in payload/node/LICENSE.",
    "",
    "This bundle is not affiliated with JetBrains. IntelliJ IDEA is a trademark of JetBrains s.r.o.",
    "",
  ].join("\n"),
);
for (const [from, to] of [
  [path.join(payload, "node", "LICENSE"), "node-LICENSE.txt"],
  [path.join(payload, "jdtls", "LICENSE"), "jdtls-LICENSE.txt"],
  [path.join(payload, "js-debug", "LICENSE"), "js-debug-LICENSE.txt"],
]) {
  if (await exists(from)) await fs.copyFile(from, path.join(licenses, to));
}

const appVersion = await installedAppVersion();
const manifest = {
  schema: 2,
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
  components: componentList,
  licenses: "licenses/NOTICE.txt",
};
await fs.writeFile(path.join(stage, "bundle.json"), JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
step("Writing installer files");
const readme = `OpenIDEA 语言服务器离线包（Windows x64）

版本: ${bundleVersion}
适配: OpenIDEA >= ${manifest.openidea.minVersion}（在 ${manifest.openidea.testedVersions.join(", ")} 上验证）
内置运行时: Node.js ${nodeVersion}，Eclipse Temurin JDK ${jdk.version}

使用:
  1. 退出 OpenIDEA。
  2. 双击 Start.cmd —— 打开图形安装界面，可勾选安装/卸载单个组件并查看版本。
     也可以双击 install.cmd 一次性全部安装（无界面）。
  3. 重启 OpenIDEA，在 Settings › Languages & Frameworks › Language Servers 查看状态。

包含: ${componentList
  .filter((c) => c.id !== "npm-shared")
  .map((c) => c.name)
  .join("、")}

所有文件只写入 %LOCALAPPDATA%\\ai.l0ng.openidea\\tools\\（OpenIDEA 自己的托管目录），
不需要管理员权限，不写注册表、不改系统设置。卸载组件只会删除该组件自己的文件。

注意: 安装前请退出 OpenIDEA，否则文件可能被占用。
`;
await fs.writeFile(path.join(stage, "README.txt"), readme);
for (const file of ["engine.ps1", "cli.ps1", "gui.ps1"]) {
  const text = await fs.readFile(path.join(here, "..", "installer", file), "utf8");
  // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI; the Chinese text needs the BOM.
  await fs.writeFile(path.join(stage, file), `\uFEFF${text}`);
}
await fs.copyFile(path.join(here, "..", "installer", "Start.cmd"), path.join(stage, "Start.cmd"));
await fs.copyFile(path.join(here, "..", "installer", "install.cmd"), path.join(stage, "install.cmd"));

// ---------------------------------------------------------------------------
step("Verifying the payload");
if (shouldVerify) {
  const r = await run(nodeExe, [path.join(here, "verify.mjs"), "--payload", payload]);
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
  components: componentList.map((c) => ({ id: c.id, name: c.name, version: c.version, sizeBytes: c.sizeBytes })),
});
index.bundles.sort((a, b) => String(b.version).localeCompare(String(a.version)));
index.latest = index.bundles[0].version;
await fs.writeFile(indexFile, JSON.stringify(index, null, 2));

const notes = `## OpenIDEA 语言服务器离线包 ${bundleVersion}（Windows x64）

适配 **OpenIDEA >= ${manifest.openidea.minVersion}**${appVersion ? `（本机检测到 ${appVersion}）` : ""}${
  head?.sha ? `，openidea 提交 \`${head.sha.slice(0, 7)}\`` : ""
}。

**图形化安装**：解压后双击 \`Start.cmd\`，可勾选组件、查看已装/包内版本、单独卸载。

| 组件 | 版本 |
| --- | --- |
${componentList.filter((c) => c.id !== "npm-shared").map((c) => `| ${c.name} | ${c.version} |`).join("\n")}

- 下载 \`${zipName}\`（${mb(size)}）。
- 校验：\`${sha}\`。
- 需要 OpenIDEA 已安装（默认路径 \`%LOCALAPPDATA%\\OpenIDEA\`）。
`;
await fs.writeFile(path.join(distDir, "RELEASE_NOTES.md"), notes);
await fs.writeFile(path.join(distDir, "lsp-version.txt"), bundleVersion);

console.log("");
info(`payload ${mb(await treeSize(payload))}  ->  ${zipName} ${mb(size)}`);
info(`sha256 ${sha}`);
console.log(`\nVERSION=${bundleVersion}`);
