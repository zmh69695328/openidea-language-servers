// Launchers for tools that are not a plain .exe: jdtls, js-debug.
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./util.mjs";

const CRLF = "\r\n";
const write = (file, lines) => fs.writeFile(file, lines.join(CRLF) + CRLF);

/**
 * `jdtls` the IDE launches: Eclipse's launcher on the bundled JDK when the IDE did
 * not set JAVA_HOME (it sets it from the JDKs it discovers).
 * cmd.exe needs one line per command: everything goes on the java line.
 */
export async function writeJdtlsLauncher(payloadDir, { jdkDir, launcherJar }) {
  const bin = path.join(payloadDir, "jdtls", "bin");
  await ensureDir(bin);
  const args = [
    '"-Declipse.application=org.eclipse.jdt.ls.core.id1"',
    '"-Dosgi.bundles.defaultStartLevel=4"',
    '"-Declipse.product=org.eclipse.jdt.ls.core.product"',
    '"-Dosgi.checkConfiguration=true"',
    '"-Dosgi.sharedConfiguration.area=%~dp0..\\config_win"',
    '"-Dosgi.sharedConfiguration.area.readOnly=true"',
    '"-Dosgi.configuration.cascaded=true"',
    '"-Xms1G"',
    '"--add-modules=ALL-SYSTEM"',
    '"--add-opens=java.base/java.util=ALL-UNNAMED"',
    '"--add-opens=java.base/java.lang=ALL-UNNAMED"',
    `-jar "%~dp0..\\plugins\\${launcherJar}"`,
  ];
  await write(path.join(bin, "jdtls.cmd"), [
    "@ECHO OFF",
    "SETLOCAL",
    `IF NOT DEFINED JAVA_HOME SET "JAVA_HOME=%~dp0..\\..\\jdks\\${jdkDir}"`,
    'SET "_JAVA=%JAVA_HOME%\\bin\\java.exe"',
    'IF NOT EXIST "%_JAVA%" SET "_JAVA=java"',
    `"%_JAVA%" ${args.join(" ")} %*`,
    "EXIT /B %ERRORLEVEL%",
  ]);
}

/** `js-debug-adapter` the IDE launches: vscode-js-debug's DAP server on the bundled Node. */
export async function writeJsDebugLauncher(payloadDir) {
  const bin = path.join(payloadDir, "js-debug", "bin");
  await ensureDir(bin);
  await write(path.join(bin, "js-debug-adapter.cmd"), [
    "@ECHO OFF",
    "SETLOCAL",
    'SET "_NODE=%~dp0..\\..\\node\\node.exe"',
    'IF NOT EXIST "%_NODE%" SET "_NODE=node"',
    '"%_NODE%" "%~dp0..\\dapDebugServer.js" %*',
    "EXIT /B %ERRORLEVEL%",
  ]);
}
