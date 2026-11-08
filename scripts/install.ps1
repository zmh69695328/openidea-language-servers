# Installs the OpenIDEA language server bundle into the app's managed tools directory.
[CmdletBinding()]
param(
    [string]$ToolsDir,
    [string]$AppExe,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundle = Get-Content -LiteralPath (Join-Path $root "bundle.json") -Raw | ConvertFrom-Json

if (-not $ToolsDir) {
    # The app's local data directory (tools/ lives next to EBWebView, its WebView2 profile).
    $base = Join-Path $env:LOCALAPPDATA "ai.l0ng.openidea"
    if (-not (Test-Path -LiteralPath $base)) {
        $candidate = Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "EBWebView") } |
            Select-Object -First 1
        if ($candidate) { $base = $candidate.FullName }
    }
    $ToolsDir = Join-Path $base "tools"
}
if (-not $AppExe) { $AppExe = Join-Path $env:LOCALAPPDATA "OpenIDEA\openidea.exe" }

Write-Host ""
Write-Host "OpenIDEA 语言服务器离线包 $($bundle.version) ($($bundle.platform))" -ForegroundColor Cyan
Write-Host "适配 OpenIDEA >= $($bundle.openidea.minVersion)；已验证：$($bundle.openidea.testedVersions -join ', ')"
Write-Host "内置运行时：Node.js $($bundle.runtimes.node)，$($bundle.runtimes.jdk)"
Write-Host "目标目录：$ToolsDir"
Write-Host ""

if (Test-Path -LiteralPath $AppExe) {
    $appVersion = (Get-Item -LiteralPath $AppExe).VersionInfo.FileVersion
    Write-Host "检测到 OpenIDEA $appVersion"
    try {
        if ([version]$appVersion -lt [version]$bundle.openidea.minVersion) {
            Write-Warning "本包为 OpenIDEA >= $($bundle.openidea.minVersion) 构建，当前版本 $appVersion 可能不识别其中的工具。"
            if (-not $Force) {
                Write-Host "如仍要安装，请加 -Force 重新运行。" -ForegroundColor Yellow
                exit 2
            }
        }
    } catch {
        Write-Warning "无法比较版本号（$appVersion），继续安装。"
    }
} else {
    Write-Warning "未找到 $AppExe；仍会把文件安装到目标目录。"
}

$running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
    Write-Host "OpenIDEA 正在运行，请先退出后重试（或加 -Force 强制继续，部分文件可能被占用）。" -ForegroundColor Yellow
    exit 3
}

$payload = Join-Path $root "payload"
$items = Get-ChildItem -LiteralPath $payload -Force
$existing = @($items | Where-Object { Test-Path -LiteralPath (Join-Path $ToolsDir $_.Name) })

Write-Host "将安装 $($items.Count) 个目录/文件：$($items.Name -join ', ')"
if ($existing.Count) {
    Write-Host "其中 $($existing.Count) 个已存在，会先备份：$($existing.Name -join ', ')" -ForegroundColor Yellow
}

if ($DryRun) {
    Write-Host "`n[DryRun] 未做任何修改。" -ForegroundColor Cyan
    exit 0
}

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$ToolsDir.backup-$stamp"

foreach ($item in $items) {
    $target = Join-Path $ToolsDir $item.Name
    if (Test-Path -LiteralPath $target) {
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        Move-Item -LiteralPath $target -Destination (Join-Path $backup $item.Name) -Force
    }
    Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
    Write-Host "  + $($item.Name)"
}

Write-Host ""
Write-Host "完成。" -ForegroundColor Green
if ($existing.Count) { Write-Host "旧文件备份在：$backup" }
Write-Host "重启 OpenIDEA，然后在 Settings › Languages & Frameworks › Language Servers 查看状态。"
Write-Host ""
