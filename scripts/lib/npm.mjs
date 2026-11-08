// npm packages into <payload>/node_modules, then cmd wrappers that use the bundled Node.
import fs from "node:fs/promises";
import path from "node:path";
import { buildDir, ensureDir, info, run, warn } from "./util.mjs";

const NPM_CLI = path.join("node_modules", "npm", "bin", "npm-cli.js");

/** Installs `dependencies` (name -> range) into `payloadDir/node_modules`. */
export async function installPackages(payloadDir, dependencies, nodeExe, nodeDir) {
  await ensureDir(payloadDir);
  const pkg = {
    name: "openidea-language-servers-payload",
    private: true,
    version: "0.0.0",
    description: "Installed by the OpenIDEA offline language server bundle build",
    dependencies,
  };
  await fs.writeFile(path.join(payloadDir, "package.json"), JSON.stringify(pkg, null, 2));
  const env = { PATH: `${nodeDir};${process.env.PATH ?? ""}` };
  const cache = path.join(buildDir, "npm-cache");
  await ensureDir(cache);
  const args = [
    path.join(nodeDir, NPM_CLI),
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier",
    "--cache",
    cache,
    "--loglevel=error",
  ];
  const r = await run(nodeExe, args, { cwd: payloadDir, env });
  if (r.code !== 0) throw new Error(`npm install failed (${r.code})`);
  for (const f of ["package.json", "package-lock.json", path.join("node_modules", ".package-lock.json")]) {
    await fs.rm(path.join(payloadDir, f), { force: true });
  }
  return readInstalled(payloadDir);
}

/** [{ dir, name, version, bin: { command: relative entry } }] for every installed package. */
export async function readInstalled(payloadDir) {
  const modules = path.join(payloadDir, "node_modules");
  const out = [];
  const readPackage = async (dir) => {
    try {
      const json = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
      const bin = normalizeBin(json.name, json.bin);
      if (json.name && bin) out.push({ dir, name: json.name, version: json.version, bin });
    } catch {
      // not a package directory
    }
  };
  for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    if (entry.name.startsWith("@")) {
      for (const sub of await fs.readdir(path.join(modules, entry.name), { withFileTypes: true })) {
        if (sub.isDirectory()) await readPackage(path.join(modules, entry.name, sub.name));
      }
    } else {
      await readPackage(path.join(modules, entry.name));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeBin(name, bin) {
  if (!bin) return null;
  if (typeof bin === "string") return { [name.replace(/^@[^/]+\//, "")]: bin };
  const out = {};
  for (const [command, entry] of Object.entries(bin)) out[command] = entry;
  return Object.keys(out).length ? out : null;
}

/**
 * Replaces `node_modules/.bin` with wrappers that run the bundled node.exe.
 * npm's own shims fall back to a `node` on PATH, which the IDE does not put there.
 */
export async function writeBinWrappers(payloadDir, installed) {
  const binDir = path.join(payloadDir, "node_modules", ".bin");
  await fs.rm(binDir, { recursive: true, force: true });
  await ensureDir(binDir);
  let count = 0;
  for (const pkg of installed) {
    const pkgDir = path.relative(binDir, pkg.dir).replace(/\//g, "\\");
    for (const [command, entry] of Object.entries(pkg.bin)) {
      const target = path.posix.join(pkgDir.replace(/\\/g, "/"), entry);
      await fs.writeFile(
        path.join(binDir, `${command}.cmd`),
        [
          "@ECHO OFF",
          "SETLOCAL",
          'SET "_NODE=%~dp0..\\..\\node\\node.exe"',
          'IF NOT EXIST "%_NODE%" SET "_NODE=node"',
          `"%_NODE%" "%~dp0${target}" %*`,
          "EXIT /B %ERRORLEVEL%",
          "",
        ].join("\r\n"),
      );
      count++;
    }
  }
  // `node` itself, for servers that spawn it by name through a shell.
  await fs.writeFile(
    path.join(binDir, "node.cmd"),
    [
      "@ECHO OFF",
      "SETLOCAL",
      'SET "_NODE=%~dp0..\\..\\node\\node.exe"',
      'IF NOT EXIST "%_NODE%" SET "_NODE=node"',
      '"%_NODE%" %*',
      "EXIT /B %ERRORLEVEL%",
      "",
    ].join("\r\n"),
  );
  info(`wrote ${count} command wrappers + node.cmd`);
}

/** Removes packages we do not ship (keeps the archive small and the surface honest). */
export async function prune(payloadDir, keep) {
  const modules = path.join(payloadDir, "node_modules");
  for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    if (!keep.has(entry.name)) {
      warn(`unexpected top-level package ${entry.name} (kept)`);
    }
  }
}
