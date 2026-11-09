// Smoke-tests the assembled payload: every language server must answer an LSP
// `initialize` request, the debug adapter must start listening.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argPayload = (() => {
  const i = argv.indexOf("--payload");
  return i >= 0 ? argv[i + 1] : null;
})();
const payload = argPayload
  ? path.resolve(argPayload)
  : path.resolve(here, "..", "build", "stage");
const root = payload.endsWith("payload") ? payload : path.join(payload, "payload");

const jdks = (await fs.readdir(path.join(root, "jdks")).catch(() => [])).filter((d) => !d.startsWith("."));
const env = { ...process.env };
if (jdks[0]) env.JAVA_HOME = path.join(root, "jdks", jdks[0]);

const dataDir = await fs.mkdtemp(path.join(path.resolve(here, ".."), "build", "verify-"));
const work = path.join(dataDir, "project");
await fs.mkdir(work, { recursive: true });
await fs.mkdir(path.join(dataDir, "tmp"), { recursive: true });
env.TMP = path.join(dataDir, "tmp");
env.TEMP = path.join(dataDir, "tmp");
await fs.writeFile(path.join(work, "index.ts"), "export const answer: number = 42;\n");
await fs.writeFile(path.join(work, "package.json"), JSON.stringify({ name: "verify", version: "1.0.0" }));
await fs.writeFile(path.join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
await fs.writeFile(path.join(work, "test.py"), "def answer() -> int:\n    return 42\n");
await fs.writeFile(path.join(work, "README.md"), "# verify\n\n[link](./test.py)\n");
await fs.writeFile(path.join(work, "data.json"), '{ "a": 1 }\n');
await fs.writeFile(path.join(work, "config.yaml"), "a: 1\n");
await fs.writeFile(path.join(work, "Cargo.toml"), '[package]\nname = "verify"\n');
await fs.writeFile(path.join(work, "main.go"), 'package main\n\nfunc main() { println("hi") }\n');
await fs.writeFile(path.join(work, "script.groovy"), 'def greet(name) { "hello ${name}" }\nprintln greet("world")\n');
await fs.writeFile(path.join(work, "pom.xml"), '<?xml version="1.0"?><project><modelVersion>4.0.0</modelVersion></project>\n');
await fs.writeFile(path.join(work, "script.sh"), '#!/usr/bin/env bash\nset -euo pipefail\necho hi\n');
await fs.writeFile(path.join(work, "query.sql"), 'SELECT 1 AS one;\n');

const uri = (p) => `file:///${p.replace(/\\/g, "/")}`;
const rootUri = uri(work);

const tests = [
  { name: "vtsls (TypeScript)", exe: "node_modules/.bin/vtsls.cmd", args: ["--stdio"], languageId: "typescript", file: "index.ts", timeout: 90 },
  { name: "vue-language-server", exe: "node_modules/.bin/vue-language-server.cmd", args: ["--stdio"], languageId: "vue", file: "index.ts", timeout: 90 },
  { name: "pyright", exe: "node_modules/.bin/pyright-langserver.cmd", args: ["--stdio"], languageId: "python", file: "test.py", timeout: 90 },
  { name: "JSON", exe: "node_modules/.bin/vscode-json-language-server.cmd", args: ["--stdio"], languageId: "json", file: "data.json", timeout: 60 },
  { name: "CSS", exe: "node_modules/.bin/vscode-css-language-server.cmd", args: ["--stdio"], languageId: "css", file: "index.ts", timeout: 60 },
  { name: "HTML", exe: "node_modules/.bin/vscode-html-language-server.cmd", args: ["--stdio"], languageId: "html", file: "index.ts", timeout: 60 },
  { name: "YAML", exe: "node_modules/.bin/yaml-language-server.cmd", args: ["--stdio"], languageId: "yaml", file: "config.yaml", timeout: 60 },
  { name: "marksman", exe: "marksman/bin/marksman.exe", args: ["server"], languageId: "markdown", file: "README.md", timeout: 60 },
  { name: "taplo", exe: "taplo/bin/taplo.exe", args: ["lsp", "stdio"], languageId: "toml", file: "Cargo.toml", timeout: 60 },
  { name: "ruff", exe: "ruff/bin/ruff.exe", args: ["server"], languageId: "python", file: "test.py", timeout: 60 },
  { name: "gopls (Go)", exe: "gopls/bin/gopls.exe", args: [], languageId: "go", file: "main.go", timeout: 90 },
  { name: "lemminx (XML)", exe: "lemminx/bin/lemminx.exe", args: [], languageId: "xml", file: "pom.xml", timeout: 60 },
  { name: "bash-language-server", exe: "node_modules/.bin/bash-language-server.cmd", args: ["start"], languageId: "shellscript", file: "script.sh", timeout: 60 },
  { name: "sqls (SQL)", exe: "sqls/bin/sqls.exe", args: [], languageId: "sql", file: "query.sql", timeout: 60 },
  { name: "groovy-language-server", exe: "groovy-language-server/bin/groovy-language-server.cmd", args: [], languageId: "groovy", file: "script.groovy", timeout: 120 },
  { name: "jdtls (Java)", exe: "jdtls/bin/jdtls.cmd", args: ["-data", path.join(dataDir, "jdtls-workspace")], languageId: "java", file: "index.ts", timeout: 180 },
];

function client(child) {
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const notifications = [];
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString();
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
      const start = end + 4;
      if (buffer.length < start + length) return;
      const body = buffer.subarray(start, start + length).toString();
      buffer = buffer.subarray(start + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method && message.id !== undefined) {
        // Server -> client request: answer the ones servers block on.
        const result =
          message.method === "workspace/configuration"
            ? (message.params?.items ?? []).map(() => null)
            : null;
        send({ jsonrpc: "2.0", id: message.id, result });
      } else if (message.method) {
        notifications.push(message);
      }
    }
  });
  const send = (message) => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return {
    send,
    request(id, method, params, timeoutMs) {
      const promise = new Promise((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`no response to ${method} within ${timeoutMs}ms`));
        }, timeoutMs);
      });
      send({ jsonrpc: "2.0", id, method, params });
      return promise;
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
    notifications,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** spawn(shell:true) gives us cmd.exe; the server is its child, so kill the tree. */
function killTree(pid) {
  return new Promise((resolve) => {
    const p = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
    p.on("close", resolve);
    p.on("error", resolve);
  });
}

function quote(s) {
  return /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function runLsp(test) {
  const exe = path.join(root, ...test.exe.split("/"));
  const child = spawn(exe, test.args, {
    cwd: work,
    env,
    windowsHide: true,
    shell: true,
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const errors = [];
  const api = client(child);

  try {
    const init = await api.request(
      1,
      "initialize",
      {
        processId: process.pid,
        clientInfo: { name: "openidea-bundle-verify", version: "1.0.0" },
        rootPath: work,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "verify" }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: true } },
          textDocument: {
            synchronization: { dynamicRegistration: true },
            completion: { completionItem: { snippetSupport: true } },
            hover: { contentFormat: ["markdown", "plaintext"] },
          },
          window: { workDoneProgress: true },
        },
        initializationOptions: {},
      },
      test.timeout * 1000,
    );
    if (!init.result?.capabilities) errors.push("initialize returned no capabilities");
    api.notify("initialized", {});
    await sleep(500);
    const shutdown = await api.request(2, "shutdown", null, 10_000).catch(() => null);
    if (!shutdown) errors.push("shutdown did not answer");
    api.notify("exit", {});
    await sleep(200);
  } finally {
    await killTree(child.pid);
    if (!child.killed) child.kill();
  }
  return { errors, stderr: stderr.trim().split("\n").filter(Boolean).slice(-6) };
}

async function runDap() {
  const exe = path.join(root, "js-debug", "bin", "js-debug-adapter.cmd");
  const child = spawn(exe, ["0", "127.0.0.1"], { cwd: work, env, windowsHide: true, shell: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (/listening on|Debug server|port/i.test(out)) break;
    await sleep(200);
  }
  const ok = /listening|port\s*\d+/i.test(out);
  await killTree(child.pid);
  child.kill();
  return { errors: ok ? [] : [`no listening message; output: ${out.trim().slice(0, 300)}`], stderr: [] };
}

let failed = 0;
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const selected = only ? tests.filter((t) => t.name.toLowerCase().includes(only.toLowerCase())) : tests;
console.log(`payload: ${root}\n`);
for (const test of selected) {
  const started = Date.now();
  let result;
  try {
    result = await runLsp(test);
  } catch (e) {
    result = { errors: [e.message], stderr: [] };
  }
  const ms = Date.now() - started;
  if (result.errors.length) {
    failed++;
    console.log(`FAIL ${test.name} (${ms}ms)`);
    for (const e of result.errors) console.log(`     ${e}`);
    for (const l of result.stderr) console.log(`     | ${l}`);
  } else {
    console.log(`ok   ${test.name} (${ms}ms)`);
  }
}

const dap = only ? { errors: [] } : await runDap();
if (dap.errors.length) {
  failed++;
  console.log(`FAIL js-debug (DAP)`);
  for (const e of dap.errors) console.log(`     ${e}`);
} else {
  console.log("ok   js-debug (DAP)");
}

await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
const total = selected.length + (only ? 0 : 1);
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
