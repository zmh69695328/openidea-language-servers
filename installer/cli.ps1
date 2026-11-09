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

# `-File` passes "ts,python" as one string: split it so multi-select works from the GUI and CLI.
$Install = @($Install | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Uninstall = @($Uninstall | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$bundle = Read-Bundle -Root $PSScriptRoot
if (-not $ToolsDir) { $ToolsDir = Get-DefaultToolsDir }

function Write-Log {
    param([string]$Text)
    if ($Text.StartsWith("@")) {
        if ($LogFile) { try { Add-Content -LiteralPath $LogFile -Value $Text -Encoding UTF8 } catch { } }
        return
    }
    $stamped = "[" + (Get-Date -Format "HH:mm:ss") + "] " + $Text
    Write-Host $Text
    if ($LogFile) { try { Add-Content -LiteralPath $LogFile -Value $stamped -Encoding UTF8 } catch { } }
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
        $stateText = "未安装"
        if ($installed) {
            $mark = "✓ "
            if ($version) { $stateText = "已装 " + $version } else { $stateText = "已安装" }
        }
        Write-Log ($mark + $component.id.PadRight(14) + " " + $stateText)
        Write-Log ("   " + "".PadRight(14) + " 包内 " + $component.version + "  ·  " + $component.name + "  ·  " + $component.category + "  ·  " + (Format-Size $component.sizeBytes))
    }
    Write-Log "DONE|ok"
    exit 0
}

try {
    if ($All) { $Install = @($bundle.components | Where-Object { $_.id -ne "npm-shared" } | ForEach-Object { $_.id }) }

    Write-Log ("包版本 " + $bundle.version + "，目标目录 " + $ToolsDir)
    if ($Install.Count -gt 0) {
        if (-not $Force) {
            $running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
            if ($running) { Fail "OpenIDEA 正在运行，请先退出（或加 -Force）" }
        }
        Write-Log ("要安装：" + ($Install -join ", "))
        $result = Install-Components -Bundle $bundle -ToolsDir $ToolsDir -Ids $Install -OnLog { param($msg) Write-Log $msg }
    }

    if ($Uninstall.Count -gt 0) {
        $running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
        if ($running -and -not $Force) { Fail "OpenIDEA 正在运行，请先退出（或加 -Force）" }
        Write-Log ("要卸载：" + ($Uninstall -join ", "))
        $result = Uninstall-Components -Bundle $bundle -ToolsDir $ToolsDir -Ids $Uninstall -OnLog { param($msg) Write-Log $msg }
    }

    Write-Log "DONE|ok"
    exit 0
} catch {
    Write-Log ("ERROR|" + $_.Exception.Message)
    Write-Log "DONE|error"
    exit 1
}
