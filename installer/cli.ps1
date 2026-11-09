# cli.ps1 — headless component installer (used by install.cmd and by the GUI).
[CmdletBinding()]
param(
    [string[]]$Install = @(),
    [string[]]$Uninstall = @(),
    [switch]$All,
    [switch]$List,
    [string]$ToolsDir,
    [string]$LogFile,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "engine.ps1")

$bundle = Read-Bundle -Root $PSScriptRoot
if (-not $ToolsDir) { $ToolsDir = Get-DefaultToolsDir }

function Write-Log {
    param([string]$Text)
    Write-Host $Text
    if ($LogFile) {
        try { Add-Content -LiteralPath $LogFile -Value $Text -Encoding UTF8 } catch { }
    }
}

function Fail {
    param([string]$Text)
    Write-Log ("ERROR|" + $Text)
    Write-Log "DONE|error"
    exit 1
}

if ($List -or ($Install.Count -eq 0 -and $Uninstall.Count -eq 0 -and -not $All)) {
    $state = Read-State $ToolsDir
    Write-Log ("包版本 " + $bundle.version + "，目标目录 " + $ToolsDir)
    foreach ($component in $bundle.components) {
        $installed = Test-ComponentInstalled $ToolsDir $component
        $version = Get-ComponentInstalledVersion $state $component.id
        $mark = "  "
        if ($installed) { $mark = "✓ " }
        Write-Log ($mark + $component.id + "  [" + $component.version + "]  " + $component.name + "  " + $component.category)
    }
    Write-Log "DONE|ok"
    exit 0
}

try {
    if ($All) { $Install = @($bundle.components | Where-Object { $_.id -ne "npm-shared" } | ForEach-Object { $_.id }) }

    if ($Install.Count -gt 0) {
        if (-not $Force) {
            $running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
            if ($running) { Fail "OpenIDEA 正在运行，请先退出（或加 -Force）" }
        }
        $n = Install-Components -Bundle $bundle -ToolsDir $ToolsDir -Ids $Install -OnStep { param($msg) Write-Log $msg }
        Write-Log ("已安装/更新 " + $n + " 个组件")
    }

    if ($Uninstall.Count -gt 0) {
        $running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
        if ($running -and -not $Force) { Fail "OpenIDEA 正在运行，请先退出（或加 -Force）" }
        $n = Uninstall-Components -Bundle $bundle -ToolsDir $ToolsDir -Ids $Uninstall -OnStep { param($msg) Write-Log $msg }
        Write-Log ("已卸载 " + $n + " 个组件")
    }

    Write-Log "DONE|ok"
    exit 0
} catch {
    Write-Log ("ERROR|" + $_.Exception.Message)
    Write-Log "DONE|error"
    exit 1
}
