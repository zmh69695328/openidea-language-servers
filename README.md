# OpenIDEA 语言服务器离线包（Windows x64）

[![Release](https://github.com/zmh69695328/openidea-language-servers/actions/workflows/release.yml/badge.svg)](https://github.com/zmh69695328/openidea-language-servers/actions/workflows/release.yml)
[**↓ 下载最新离线包**](https://github.com/zmh69695328/openidea-language-servers/releases/latest)

给 [OpenIDEA](https://github.com/l0ng-ai/openidea) 用的**免联网、开箱即用**语言服务器与调试器合集。
自带图形安装界面，可勾选安装/卸载单个组件、查看已装版本与包内版本；不需要管理员权限，
不写注册表，所有文件只落在 OpenIDEA 自己的 `tools` 目录。

> 非官方项目，与 OpenIDEA 作者无隶属关系。OpenIDEA 采用 Apache-2.0；本仓库只做打包。

## 图形安装界面

解压后双击 **`Start.cmd`**：

- 按「运行时 / 语言 / 依赖」分组列出所有组件，每个组件有一句作用说明和体积；
- 每行显示 **已安装版本** 与 **离线包版本**，版本不同会标成橙色（可覆盖更新）；
- 勾选后点「安装选中」或「卸载选中」，只动该组件自己的文件；
- 选中 Vue 会自动勾上 TypeScript，取消 TypeScript 会连带取消 Vue（依赖关系）；
- 安装过程有实时日志，失败时保留完整输出。

界面是 WPF（系统自带），整个安装器只有三个 `.ps1` + 两个 `.cmd`，**没有额外运行时、没有安装程序、没有服务**。

无界面用法（CI/脚本）：

```powershell
.\cli.ps1 -List                       # 列出组件与安装状态
.\cli.ps1 -Install ts,python -Force   # 只装这两组
.\cli.ps1 -Uninstall ts -Force        # 只卸载这一组
.\cli.ps1 -All -Force                 # 全量安装
```

## 组件

| 分组 | 组件 | 内容 |
| --- | --- | --- |
| 运行时 | Node.js | TypeScript、Vue、Bash、Pyright、数据格式服务器的运行环境 |
| 运行时 | Temurin JDK 25 | Java（JDT LS）与 Groovy 的运行环境，含 `jdk.jdi` |
| 语言 | TypeScript / JavaScript | vtsls + TypeScript 6 + js-debug |
| 语言 | Vue | vue-language-server（复用 TypeScript 服务） |
| 语言 | Python | Pyright + Ruff + debugpy |
| 语言 | Java | Eclipse JDT LS + Microsoft java-debug |
| 语言 | Go | gopls（分析模块仍需本机 Go SDK） |
| 语言 | Groovy | Prominic Groovy LSP |
| 语言 | XML | LemMinX |
| 语言 | Bash / Shell | bash-language-server |
| 语言 | SQL | sqls |
| 语言 | Markdown | Marksman |
| 语言 | JSON / YAML / TOML / CSS / HTML | vscode-langservers + yaml-language-server + Taplo |
| 依赖 | npm 公共依赖 | 上面 npm 组件共用的第三方包，自动跟随 |

安装目标是 OpenIDEA 的托管工具目录：

```
%LOCALAPPDATA%\ai.l0ng.openidea\tools\
```

OpenIDEA 启动时会把该目录下的 `node_modules\.bin`、`<tool>\bin` 前置到 `PATH`，所以包内布局
与 IDE 自己在线安装出来的结果**同构**——装完重启即可在
`Settings › Languages & Frameworks › Language Servers` 里看到 `Installed`。

## 适配版本

`bundle.json` 里写明：

```json
"openidea": { "tested": "0.1.38", "minVersion": "0.1.38", "commit": "<打包时的 openidea 提交>" }
```

工具名和启动命令来自 OpenIDEA 的 `languages/*.toml` 与 `crates/ide-tools/src/registry.rs`，
两者变了就可能需要重新打包。安装器会读取已安装 `openidea.exe` 的文件版本并与
`minVersion` 比较。

## 构建

要求：Windows、Node.js 22+（只用来跑构建脚本；产物里的 Node 是另外下载的 LTS）。
构建过程会额外下载 Go 工具链来编译 gopls（不进入产物）。

```powershell
node scripts/build.mjs            # 下载 + 组装 + 打包
node scripts/build.mjs --verify   # 额外跑 17 项 LSP/DAP 握手验证
```

产物：

```
dist/openidea-language-servers-windows-x64-<yyyy.MM.dd>.zip
dist/openidea-language-servers-windows-x64-<yyyy.MM.dd>.zip.sha256
dist/index.json                 # 版本、大小、校验和、组件清单、适配信息
dist/RELEASE_NOTES.md
```

下载缓存位于 `build/cache`，重复构建不会重新下载。`build/stage/<bundle>/` 是未压缩目录，
可直接用来调试。

### 目录结构

```
<bundle>/
  Start.cmd              图形安装界面
  install.cmd            无界面全量安装
  gui.ps1 / cli.ps1 / engine.ps1
  bundle.json            组件、版本、依赖、路径、适配信息
  README.txt
  licenses/
  payload/               -> %LOCALAPPDATA%\ai.l0ng.openidea\tools\
    node/  node_modules/  jdks/temurin-x.y.z/
    jdtls/ java-debug/ js-debug/ groovy-language-server/
    gopls/ lemminx/ sqls/ marksman/ taplo/ ruff/ debugpy/
```

每个组件在 `bundle.json` 里声明自己拥有的 `paths`；安装就是复制这些路径，卸载就是删除
它们，互不影响。npm 组件的直接依赖归该组件，其余传递依赖归「npm 公共依赖」。

### 为什么自写 `.cmd` 包装器

npm 生成的 `.bin\*.cmd` 会回退到 `PATH` 上的 `node`，而 OpenIDEA 只把 `tools/**/bin` 前置到
`PATH`，不会把 `tools/node` 放进去。包装器改成相对路径直接调用 `tools\node\node.exe`。
jdtls 和 Groovy 使用包内 JDK（`JAVA_HOME` 未设置时）。

## 自动发布

`.github/workflows/release.yml`：手动触发 / 每周一 04:00（CST）/ 推送 `lsp-v*` 标签，
在 `windows-latest` 上构建并验证，然后 `gh release create` 上传 zip、sha256、`index.json`
和发布说明。

## 已知限制

- 仅 Windows x64；macOS/Linux 需要各自的运行时与 npm 产物。
- Go 语言服务器需要本机安装 Go SDK 才能分析模块（gopls 本身已内置）。
- Python 调试（debugpy）使用项目自己的 Python 解释器——这本来就是被调试进程的运行时。
- 包内 JDK 只有 25；Java 8/11/17 项目建议本机装对应 JDK，OpenIDEA 会注册为
  `java.configuration.runtimes`。
- 整体约 386 MB，JDK 占大头；可按组件只装需要的部分。

## 许可证

打包产物内含第三方组件，各自的许可证见 `licenses/NOTICE.txt`、`payload/node/LICENSE`、
`payload/jdks/*/legal/` 以及各 npm 包目录下的 `LICENSE`。JDT LS 为 EPL-2.0，
Temurin 为 GPLv2+CE，Node.js 为 MIT，其余见 NOTICE。
