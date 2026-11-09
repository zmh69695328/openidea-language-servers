# engine.ps1 — component-aware installer shared by gui.ps1 and cli.ps1.
# Everything is written under the OpenIDEA managed tools directory; no admin, no registry.

function Read-Bundle {
    param([string]$Root)
    if (-not $Root) { $Root = $PSScriptRoot }
    $file = Join-Path $Root "bundle.json"
    if (-not (Test-Path -LiteralPath $file)) { throw "找不到 bundle.json：$file" }
    $bundle = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundle | Add-Member -NotePropertyName Root -NotePropertyValue $Root -Force
    return $bundle
}

function Get-DefaultToolsDir {
    $base = Join-Path $env:LOCALAPPDATA "ai.l0ng.openidea"
    if (-not (Test-Path -LiteralPath $base)) {
        $candidate = Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "EBWebView") } |
            Select-Object -First 1
        if ($candidate) { $base = $candidate.FullName }
    }
    return (Join-Path $base "tools")
}

function Get-InstalledAppVersion {
    $exe = Join-Path $env:LOCALAPPDATA "OpenIDEA\openidea.exe"
    if (-not (Test-Path -LiteralPath $exe)) { return $null }
    try { return (Get-Item -LiteralPath $exe).VersionInfo.FileVersion } catch { return $null }
}

function Get-StatePath {
    param([string]$ToolsDir)
    return (Join-Path $ToolsDir ".openidea-offline-state.json")
}

function Read-State {
    param([string]$ToolsDir)
    $state = @{ components = @{} }
    $path = Get-StatePath $ToolsDir
    if (-not (Test-Path -LiteralPath $path)) { return $state }
    try {
        $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.components) {
            foreach ($p in $json.components.PSObject.Properties) {
                $state.components[$p.Name] = @{
                    version     = [string]$p.Value.version
                    installedAt = [string]$p.Value.installedAt
                }
            }
        }
    } catch { }
    return $state
}

function Save-State {
    param([string]$ToolsDir, $State)
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    $out = @{ components = @{} }
    foreach ($key in $State.components.Keys) { $out.components[$key] = $State.components[$key] }
    $out | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Get-StatePath $ToolsDir) -Encoding UTF8
}

function Get-Component {
    param($Bundle, [string]$Id)
    return ($Bundle.components | Where-Object { $_.id -eq $Id } | Select-Object -First 1)
}

function Test-ComponentInstalled {
    param([string]$ToolsDir, $Component)
    foreach ($rel in $Component.paths) {
        if (-not (Test-Path -LiteralPath (Join-Path $ToolsDir $rel))) { return $false }
    }
    return $true
}

function Get-ComponentInstalledVersion {
    param($State, [string]$Id)
    if ($State.components.ContainsKey($Id)) { return [string]$State.components[$Id].version }
    return $null
}

function Resolve-Closure {
    param($Bundle, [string[]]$Ids)
    $seen = @{}
    $queue = New-Object System.Collections.Queue
    foreach ($id in $Ids) { if ($id) { $queue.Enqueue($id) } }
    while ($queue.Count -gt 0) {
        $id = [string]$queue.Dequeue()
        if ($seen.ContainsKey($id)) { continue }
        $component = Get-Component $Bundle $id
        if (-not $component) { continue }
        $seen[$id] = $true
        foreach ($dep in $component.deps) { if (-not $seen.ContainsKey($dep)) { $queue.Enqueue($dep) } }
    }
    return @($seen.Keys)
}

function Remove-EmptyDirs {
    param([string]$Root)
    if (-not (Test-Path -LiteralPath $Root)) { return }
    $dirs = Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending
    foreach ($dir in $dirs) {
        try {
            $child = Get-ChildItem -LiteralPath $dir.FullName -Force -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $child) { Remove-Item -LiteralPath $dir.FullName -Force -ErrorAction SilentlyContinue }
        } catch { }
    }
}

function Install-Components {
    param($Bundle, [string]$ToolsDir, [string[]]$Ids, [scriptblock]$OnStep)

    $state = Read-State $ToolsDir
    $closure = Resolve-Closure $Bundle $Ids
    $count = 0
    foreach ($component in $Bundle.components) {
        if ($closure -notcontains $component.id) { continue }
        $already = (Test-ComponentInstalled $ToolsDir $component) -and
            $state.components.ContainsKey($component.id) -and
            ([string]$state.components[$component.id].version -eq [string]$component.version)
        if ($already) { continue }
        if ($OnStep) { & $OnStep ("安装 " + $component.name + "…") }
        foreach ($rel in $component.paths) {
            if ($rel -match '\.\.' -or [System.IO.Path]::IsPathRooted($rel)) { throw "非法路径：$rel" }
            $src = Join-Path (Join-Path $Bundle.Root "payload") $rel
            $dst = Join-Path $ToolsDir $rel
            if (-not (Test-Path -LiteralPath $src)) { throw ("包内缺少文件：" + $rel) }
            if ((Get-Item -LiteralPath $src).PSIsContainer) {
                New-Item -ItemType Directory -Force -Path $dst | Out-Null
                $null = robocopy $src $dst /E /NFL /NDL /NJH /NJS /R:1 /W:1 /MT:8
                if ($LASTEXITCODE -ge 8) { throw ("复制失败（robocopy " + $LASTEXITCODE + "）：" + $rel) }
            } else {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
                Copy-Item -LiteralPath $src -Destination $dst -Force
            }
        }
        $state.components[$component.id] = @{ version = [string]$component.version; installedAt = (Get-Date).ToString("o") }
        Save-State $ToolsDir $state
        $count++
    }
    return $count
}

function Uninstall-Components {
    param($Bundle, [string]$ToolsDir, [string[]]$Ids, [scriptblock]$OnStep)

    $state = Read-State $ToolsDir
    $count = 0
    foreach ($id in $Ids) {
        $component = Get-Component $Bundle $id
        if (-not $component) { continue }
        if ($OnStep) { & $OnStep ("卸载 " + $component.name + "…") }
        foreach ($rel in $component.paths) {
            if ($rel -match '\.\.' -or [System.IO.Path]::IsPathRooted($rel)) { throw "非法路径：$rel" }
            $path = Join-Path $ToolsDir $rel
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
        }
        if ($state.components.ContainsKey($id)) { $state.components.Remove($id) }
        Save-State $ToolsDir $state
        $count++
    }
    Remove-EmptyDirs $ToolsDir
    return $count
}
