# OpenIDEA 语言服务器离线包（Windows x64）

给 [OpenIDEA](https://github.com/l0ng-ai/openidea) 用的**免联网、开箱即用**语言服务器与调试器合集。
解压后双击 `install.cmd`，所有工具落到 OpenIDEA 自己的托管目录，不需要 npm / pip / JDK / Node，
也不需要改 OpenIDEA 源码。

> 非官方项目，与 OpenIDEA 作者无隶属关系。OpenIDEA 采用 Apache-2.0；本仓库只做打包。

## 包含什么

| 类别 | 组件 | 版本来源 |
| --- | --- | --- |
| 运行时 | Node.js LTS（Windows x64） | nodejs.org |
| 运行时 | Eclipse Temurin JDK（jdtls 用，含 `jdk.jdi`） | Adoptium API |
| Java | Eclipse JDT Language Server | download.eclipse.org 最新 milestone |
| Java | Microsoft java-debug（jdtls bundle） | Open VSX |
| TypeScript/JavaScript | vtsls + TypeScript 6 | npm |
| Vue | @vue/language-server | npm |
| Python | Pyright | npm |
| Python | Ruff | GitHub Releases |
| Markdown | Marksman | GitHub Releases |
| JSON / CSS / HTML | vscode-langservers-extracted | npm |
| YAML | yaml-language-server | npm |
| TOML | Taplo | GitHub Releases |
| 调试器 | js-debug（DAP） | GitHub Releases |
| 调试器 | debugpy（纯 Python wheel） | PyPI |

目标目录是 OpenIDEA 的托管工具目录：

```
%LOCALAPPDATA%\ai.l0ng.openidea\tools\
```

OpenIDEA 启动时会把该目录下的 `node_modules\.bin`、`<tool>\bin` 等前置到 `PATH`，所以包内布局
与 IDE 自己在线安装出来的结果**完全同构**——装完重启即可在
`Settings › Languages & Frameworks › Language Servers` 里看到 `Installed`。

## 安装

1. 退出 OpenIDEA（安装时文件不能被占用）。
2. 解压 zip。
3. 双击 `install.cmd`（或 `powershell -ExecutionPolicy Bypass -File install.ps1`）。

已经存在的同名目录会先移动到 `tools.backup-<时间戳>`，可用来回滚。

参数：

```powershell
install.ps1 -DryRun                 # 只打印计划，不改文件
install.ps1 -ToolsDir D:\tools      # 换目标目录
install.ps1 -Force                  # 忽略「版本低于最低要求」/「IDE 正在运行」
```

## 适配版本

`bundle.json` 里写明：

```json
"openidea": {
  "tested": "0.1.38",
  "minVersion": "0.1.38",
  "commit": "<打包时 openidea main 的提交>"
}
```

工具名和启动命令来自 OpenIDEA 的 `languages/*.toml` 与 `crates/ide-tools/src/registry.rs`，
两者变了就可能需要重新打包。安装脚本会读取已安装 `openidea.exe` 的文件版本，低于
`minVersion` 时给出警告并要求 `-Force`。

## 构建

要求：Windows、Node.js 22+（只用来跑构建脚本；被包进产物的是独立下载的 Node LTS）。

```powershell
node scripts/build.mjs            # 下载 + 组装 + 打包
node scripts/build.mjs --verify   # 额外跑 12 项 LSP/DAP 握手验证
```

产物：

```
dist/openidea-language-servers-windows-x64-<yyyy.MM.dd>.zip
dist/openidea-language-servers-windows-x64-<yyyy.MM.dd>.zip.sha256
dist/index.json                 # 版本、大小、校验和、适配信息
dist/RELEASE_NOTES.md
```

下载缓存在 `build/cache`，重复构建不会重新下载。`build/stage/<bundle>/` 是未压缩的目录，
可直接用来调试。

### 目录结构

```
<bundle>/
  install.cmd / install.ps1 / README.txt
  bundle.json
  licenses/NOTICE.txt
  payload/                 -> %LOCALAPPDATA%\ai.l0ng.openidea\tools\
    node/                  Node.js 运行时
    node_modules/          npm 工具（.bin 下是自写的 .cmd 包装器）
    jdks/temurin-x.y.z/    jdtls 的 JDK
    jdtls/                 含 bin/jdtls.cmd（固定用包内 JDK，除非 JAVA_HOME 已设置）
    java-debug/bin/*.jar
    js-debug/              含 package.json 固定 CommonJS
    debugpy/lib/           PYTHONPATH 用的包
    marksman/bin/ taplo/bin/ ruff/bin/
```

### 为什么自写 `.cmd` 包装器

npm 生成的 `.bin\*.cmd` 会回退到 `PATH` 上的 `node`，而 OpenIDEA 只把 `tools/**/bin` 前置到
`PATH`，不会把 `tools/node` 放进去。包装器改成相对路径直接调用 `tools\node\node.exe`。

### 验证做了什么

`scripts/verify.mjs` 对每个语言服务器发一次真实的 LSP `initialize`（含 `initialized`、
`shutdown`、`exit`），并启动 js-debug 的 DAP 端口等待监听；同时应答服务端反向请求
（`workspace/configuration` 等）。jdtls 用包内 JDK 25 启动，约 2–3 秒就绪。

## 自动发布

`.github/workflows/release.yml`：

- 触发：手动 `workflow_dispatch`、每周一 04:00（CST）、推送 `lsp-v*` 标签。
- 在 `windows-latest` 上构建并验证，然后 `gh release create lsp-v<日期>` 上传
  zip、sha256、`index.json` 和发布说明。

本地没有 `gh` 也能跑构建；发布那一步需要 `GH_TOKEN`。

## 已知限制

- 仅 Windows x64。macOS/Linux 需要各自的运行时与 npm 产物，未包含。
- Python 调试（debugpy）需要项目自己的 Python 解释器——这本来就是被调试进程的运行时；
  包里的 debugpy 只提供适配器代码，装到 `tools/debugpy/lib` 由 IDE 放进 `PYTHONPATH`。
- 体积约 300 MB（JDK 占大头）。这是「开箱即用」的代价；只要服务器、不要运行时的精简包未做。
- 包内 JDK 只有一个大版本（25）。项目若要编译 Java 8/11/17，仍建议在机器上装对应 JDK，
  OpenIDEA 会把它们注册成 `java.configuration.runtimes`。
- 首次启动 jdtls 会建索引，属正常现象。

## 许可证

打包产物内含第三方组件，各自的许可证见 `licenses/NOTICE.txt`、`payload/node/LICENSE`、
`payload/jdks/*/legal/` 以及各 npm 包目录下的 `LICENSE`。JDT LS 为 EPL-2.0，
Temurin 为 GPLv2+CE，Node.js 为 MIT，其余见 NOTICE。
