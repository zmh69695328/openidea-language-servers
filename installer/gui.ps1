# gui.ps1 — small WPF installer UI for the offline bundle.
# No admin rights, no registry, no external dependencies: only files under the tools directory.
param(
    [string]$Preview,
    [string]$ToolsDir,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
. (Join-Path $PSScriptRoot "engine.ps1")

$bundle = Read-Bundle -Root $PSScriptRoot
if (-not $ToolsDir) { $ToolsDir = Get-DefaultToolsDir }
$appVersion = Get-InstalledAppVersion

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="OpenIDEA 语言服务器" Width="1000" Height="820" MinWidth="880" MinHeight="640"
        WindowStartupLocation="CenterScreen" Background="#F4F6FB"
        FontFamily="Microsoft YaHei UI, Segoe UI" UseLayoutRounding="True"
        TextOptions.TextFormattingMode="Display">
  <Window.Resources>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Background" Value="#2F6BFF"/>
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Padding" Value="20,10"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" CornerRadius="9" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#1F55E0"/></Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter TargetName="bd" Property="Opacity" Value="0.4"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Ghost" TargetType="Button">
      <Setter Property="Background" Value="White"/>
      <Setter Property="Foreground" Value="#374151"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Padding" Value="16,9"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" CornerRadius="9" BorderBrush="#DDE1EA" BorderThickness="1" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#F3F5FA"/></Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter TargetName="bd" Property="Opacity" Value="0.4"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Small" TargetType="Button" BasedOn="{StaticResource Ghost}">
      <Setter Property="Padding" Value="12,6"/>
      <Setter Property="FontSize" Value="12"/>
    </Style>
    <Style TargetType="CheckBox">
      <Setter Property="VerticalAlignment" Value="Center"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="CheckBox">
            <Grid Background="Transparent" Width="20" Height="20">
              <Border x:Name="box" CornerRadius="6" BorderBrush="#C9CFDA" BorderThickness="1.3" Background="White"/>
              <Path x:Name="check" Data="M 4,10 L 8,14 L 15,5" Stroke="White" StrokeThickness="2.2"
                    StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round" Visibility="Collapsed"/>
            </Grid>
            <ControlTemplate.Triggers>
              <Trigger Property="IsChecked" Value="True">
                <Setter TargetName="box" Property="Background" Value="#2F6BFF"/>
                <Setter TargetName="box" Property="BorderBrush" Value="#2F6BFF"/>
                <Setter TargetName="check" Property="Visibility" Value="Visible"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="box" Property="Background" Value="#EDEFF4"/>
                <Setter TargetName="box" Property="BorderBrush" Value="#DDE1EA"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Grid Background="#F4F6FB">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <Border Grid.Row="0" Background="White" BorderBrush="#E5E7EB" BorderThickness="0,0,0,1" Padding="28,20">
      <Grid>
        <StackPanel HorizontalAlignment="Left">
          <TextBlock Text="OpenIDEA 语言服务器" FontSize="22" FontWeight="Bold" Foreground="#111827"/>
          <TextBlock Text="离线安装器 · 只写入 OpenIDEA 的 tools 目录，无需管理员权限" FontSize="12" Foreground="#6B7280" Margin="0,4,0,0"/>
        </StackPanel>
        <StackPanel HorizontalAlignment="Right" VerticalAlignment="Center">
          <TextBlock x:Name="BundleVersionText" FontSize="12" Foreground="#6B7280" HorizontalAlignment="Right"/>
          <TextBlock x:Name="AppVersionText" FontSize="12" Foreground="#6B7280" HorizontalAlignment="Right" Margin="0,3,0,0"/>
        </StackPanel>
      </Grid>
    </Border>

    <Border x:Name="Banner" Grid.Row="1" Background="#FFF7E8" BorderBrush="#F5D9A8" BorderThickness="0,0,0,1"
            Padding="28,8" Visibility="Collapsed">
      <TextBlock x:Name="BannerText" FontSize="12" Foreground="#92400E"/>
    </Border>

    <ScrollViewer Grid.Row="2" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
      <StackPanel x:Name="RowsPanel" Margin="28,16,28,4"/>
    </ScrollViewer>

    <Border Grid.Row="3" Background="White" BorderBrush="#E5E7EB" BorderThickness="0,1,0,0" Padding="28,12,28,14">
      <StackPanel>
        <TextBlock x:Name="StatusText" FontSize="12" Foreground="#4B5563" Text="选择组件后点击「安装选中」或「卸载选中」。" Margin="0,0,0,8"/>
        <ProgressBar x:Name="Progress" Height="4" Minimum="0" Maximum="100" IsIndeterminate="False"
                     Foreground="#2F6BFF" Background="#EDEFF4" BorderThickness="0" Margin="0,0,0,10"/>
        <Grid>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
            <Button x:Name="SelectAll" Content="全选" Style="{StaticResource Small}" Margin="0,0,6,0"/>
            <Button x:Name="SelectNone" Content="全不选" Style="{StaticResource Small}" Margin="0,0,6,0"/>
            <Button x:Name="Refresh" Content="刷新" Style="{StaticResource Small}"/>
            <TextBlock x:Name="SelectedText" FontSize="12" Foreground="#4B5563" VerticalAlignment="Center" Margin="14,0,0,0"/>
            <TextBlock x:Name="TargetText" FontSize="12" Foreground="#9CA3AF" VerticalAlignment="Center" Margin="10,0,0,0"/>
          </StackPanel>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
            <Button x:Name="Uninstall" Content="卸载选中" Style="{StaticResource Ghost}" Margin="0,0,10,0" IsEnabled="False"/>
            <Button x:Name="Install" Content="安装选中" Style="{StaticResource Primary}" Margin="0,0,10,0" IsEnabled="False"/>
            <Button x:Name="Close" Content="关闭" Style="{StaticResource Ghost}"/>
          </StackPanel>
        </Grid>
        <Expander x:Name="LogExpander" Header="详细日志" FontSize="12" Foreground="#6B7280" Margin="0,10,0,0">
          <TextBox x:Name="LogBox" Height="96" IsReadOnly="True" FontFamily="Consolas" FontSize="11"
                   Background="#F8F9FC" BorderBrush="#E5E7EB" VerticalScrollBarVisibility="Auto" TextWrapping="NoWrap"
                   Margin="0,6,0,0"/>
        </Expander>
      </StackPanel>
    </Border>
  </Grid>
</Window>
'@

$window = [System.Windows.Markup.XamlReader]::Parse($xaml)
$RowsPanel = $window.FindName("RowsPanel")
$Banner = $window.FindName("Banner")
$BannerText = $window.FindName("BannerText")
$StatusText = $window.FindName("StatusText")
$Progress = $window.FindName("Progress")
$LogBox = $window.FindName("LogBox")
$LogExpander = $window.FindName("LogExpander")
$InstallButton = $window.FindName("Install")
$UninstallButton = $window.FindName("Uninstall")
$SelectAll = $window.FindName("SelectAll")
$SelectNone = $window.FindName("SelectNone")
$RefreshButton = $window.FindName("Refresh")
$CloseButton = $window.FindName("Close")
$TargetText = $window.FindName("TargetText")
$SelectedText = $window.FindName("SelectedText")
$window.FindName("BundleVersionText").Text = "离线包 " + $bundle.version
$appText = "未检测到已安装的 OpenIDEA"
if ($appVersion) { $appText = "已安装 OpenIDEA " + $appVersion }
$window.FindName("AppVersionText").Text = $appText
$TargetText.Text = $ToolsDir

function Brush([string]$hex) { return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($hex) }
function Format-Size([double]$bytes) {
    if ($bytes -ge 1073741824) { return ("{0:N2} GB" -f ($bytes / 1073741824)) }
    if ($bytes -ge 1048576) { return ("{0:N0} MB" -f ($bytes / 1048576)) }
    if ($bytes -ge 1024) { return ("{0:N0} KB" -f ($bytes / 1024)) }
    return ("{0:N0} B" -f $bytes)
}

$script:checks = @()
$script:checksById = @{}
$script:rowsById = @{}
$script:componentSize = @{}
$script:installed = @{}
$script:installedVersions = @{}
$script:updating = $false
$script:busy = $false
$script:summary = ""
$script:previewMode = [bool]$Preview
$script:proc = $null
$script:logFile = $null

$dependents = @{}
foreach ($c in $bundle.components) {
    foreach ($dep in $c.deps) {
        if (-not $dependents.ContainsKey($dep)) { $dependents[$dep] = @() }
        $dependents[$dep] += $c.id
    }
}

function Update-Actions {
    if ($script:updating) { return }
    $selected = @($script:checks | Where-Object { $_.IsChecked -eq $true -and $_.IsEnabled } | ForEach-Object { [string]$_.Tag })
    $toInstall = @($selected | Where-Object { -not $script:installed[$_] })
    $toUninstall = @($selected | Where-Object { $script:installed[$_] })
    $size = 0.0
    foreach ($id in $selected) { $size += [double]$script:componentSize[$id] }
    $plan = @{}
    foreach ($id in $toInstall) {
        foreach ($dep in (Resolve-Closure $bundle @($id))) {
            if (-not $script:installed[$dep]) { $plan[$dep] = $true }
        }
    }
    $planSize = 0.0
    foreach ($id in $plan.Keys) { $planSize += [double]$script:componentSize[$id] }
    if ($toInstall.Count -gt 0) {
        $SelectedText.Text = "已选 " + $selected.Count + " 个 · 将安装 " + $plan.Count + " 个（含依赖）· 约 " + (Format-Size $planSize)
    } elseif ($selected.Count -gt 0) {
        $SelectedText.Text = "已选 " + $selected.Count + " 个 · 约 " + (Format-Size $size)
    } else {
        $SelectedText.Text = ""
    }

    $busy = $script:busy
    $InstallButton.IsEnabled = (-not $busy) -and ($toInstall.Count -gt 0)
    $UninstallButton.IsEnabled = (-not $busy) -and ($toUninstall.Count -gt 0)

    if ($busy) { return }
    if ($selected.Count -eq 0) {
        $StatusText.Text = "勾选组件后点击「安装选中」或「卸载选中」。"
        $StatusText.Foreground = Brush "#4B5563"
    } elseif ($toInstall.Count -gt 0 -and $toUninstall.Count -eq 0) {
        $StatusText.Text = "将安装 " + $toInstall.Count + " 个组件（含依赖）。"
        $StatusText.Foreground = Brush "#4B5563"
    } elseif ($toUninstall.Count -gt 0 -and $toInstall.Count -eq 0) {
        $StatusText.Text = "将卸载 " + $toUninstall.Count + " 个组件。"
        $StatusText.Foreground = Brush "#4B5563"
    } else {
        $StatusText.Text = "将安装 " + $toInstall.Count + " 个、卸载 " + $toUninstall.Count + " 个。"
        $StatusText.Foreground = Brush "#4B5563"
    }
}

function Set-Busy {
    param([bool]$On)
    $script:busy = $On
    foreach ($box in $script:checks) {
        $box.IsEnabled = (-not $On) -and ($box.Tag -ne "npm-shared")
    }
    $SelectAll.IsEnabled = -not $On
    $SelectNone.IsEnabled = -not $On
    $RefreshButton.IsEnabled = -not $On
    $CloseButton.IsEnabled = -not $On
    if ($On) {
        $InstallButton.Content = "正在处理…"
        $UninstallButton.Content = "正在处理…"
        $InstallButton.IsEnabled = $false
        $UninstallButton.IsEnabled = $false
    } else {
        $InstallButton.Content = "安装选中"
        $UninstallButton.Content = "卸载选中"
        Update-Actions
    }
}

function Set-RowState {
    param([string]$Id, [string]$State)
    $row = $script:rowsById[$Id]
    if (-not $row) { return }
    switch ($State) {
        "active" { $row.BorderBrush = Brush "#2F6BFF"; $row.Background = Brush "#F3F7FF" }
        "done" { $row.BorderBrush = Brush "#BFE3CB"; $row.Background = Brush "#F6FCF8" }
        default { $row.BorderBrush = Brush "#E7EAF2"; $row.Background = Brush "#FFFFFF" }
    }
}

function Set-Dependencies {
    param([string]$Id, [bool]$Value)
    $component = Get-Component $bundle $Id
    if (-not $component) { return }
    foreach ($dep in $component.deps) {
        $box = $script:checksById[$dep]
        if ($box -and $box.IsChecked -ne $Value) {
            $box.IsChecked = $Value
            Set-Dependencies $dep $Value
        }
    }
}

function Set-Dependents {
    param([string]$Id, [bool]$Value)
    if (-not $dependents.ContainsKey($Id)) { return }
    foreach ($dependent in $dependents[$Id]) {
        $box = $script:checksById[$dependent]
        if ($box -and $box.IsChecked -ne $Value) {
            $box.IsChecked = $Value
            Set-Dependents $dependent $Value
        }
    }
}

function New-CategoryHeader {
    param([string]$Text)
    $block = New-Object System.Windows.Controls.TextBlock
    $block.Text = $Text
    $block.FontSize = 12
    $block.FontWeight = [System.Windows.FontWeights]::Bold
    $block.Foreground = Brush "#8A93A6"
    $block.Margin = [System.Windows.Thickness]::new(4, 16, 0, 8)
    return $block
}

function New-Row {
    param($Component, [bool]$IsInstalled, [string]$InstalledVersion)

    $border = New-Object System.Windows.Controls.Border
    $border.Background = Brush "#FFFFFF"
    $border.CornerRadius = [System.Windows.CornerRadius]::new(10)
    $border.BorderBrush = Brush "#E7EAF2"
    $border.BorderThickness = [System.Windows.Thickness]::new(1)
    $border.Padding = [System.Windows.Thickness]::new(16, 12, 18, 12)
    $border.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)

    $grid = New-Object System.Windows.Controls.Grid
    foreach ($width in @("28", "1*", "250", "86")) {
        $col = New-Object System.Windows.Controls.ColumnDefinition
        if ($width -eq "1*") { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
        elseif ($width -eq "28") { $col.Width = New-Object System.Windows.GridLength(28) }
        elseif ($width -eq "250") { $col.Width = New-Object System.Windows.GridLength(250) }
        else { $col.Width = New-Object System.Windows.GridLength(86) }
        $grid.ColumnDefinitions.Add($col)
    }

    $check = New-Object System.Windows.Controls.CheckBox
    [System.Windows.Controls.Grid]::SetColumn($check, 0)
    $check.Tag = $Component.id
    $check.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    if ($Component.id -eq "npm-shared") {
        $check.IsEnabled = $false
        $check.ToolTip = "自动随 npm 组件安装"
    }
    $check.add_Checked({
            Set-Dependencies ([string]$this.Tag) $true
            Update-Actions
        })
    $check.add_Unchecked({
            Set-Dependents ([string]$this.Tag) $false
            Update-Actions
        })
    $grid.Children.Add($check) | Out-Null
    $script:checks += $check
    $script:checksById[$Component.id] = $check

    $text = New-Object System.Windows.Controls.StackPanel
    [System.Windows.Controls.Grid]::SetColumn($text, 1)
    $text.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $name = New-Object System.Windows.Controls.TextBlock
    $name.Text = $Component.name
    $name.FontSize = 14
    $name.FontWeight = [System.Windows.FontWeights]::SemiBold
    $name.Foreground = Brush "#1F2937"
    $desc = New-Object System.Windows.Controls.TextBlock
    $desc.Text = $Component.description
    $desc.FontSize = 12
    $desc.Foreground = Brush "#6B7280"
    $desc.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $desc.Margin = [System.Windows.Thickness]::new(0, 3, 20, 0)
    $text.Children.Add($name) | Out-Null
    $text.Children.Add($desc) | Out-Null
    $grid.Children.Add($text) | Out-Null

    $versions = New-Object System.Windows.Controls.StackPanel
    [System.Windows.Controls.Grid]::SetColumn($versions, 2)
    $versions.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $line1 = New-Object System.Windows.Controls.TextBlock
    $line1.FontSize = 12
    $line1.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $outdated = $IsInstalled -and $InstalledVersion -and ($InstalledVersion -ne $Component.version)
    if (-not $IsInstalled) {
        $line1.Text = "未安装"
        $line1.Foreground = Brush "#9CA3AF"
    } elseif ($outdated) {
        $line1.Text = "已安装 " + $InstalledVersion
        $line1.Foreground = Brush "#B45309"
        $line1.ToolTip = "与离线包版本不同，勾选后可覆盖更新"
    } else {
        $line1.Text = "已安装 " + $InstalledVersion
        $line1.Foreground = Brush "#16A34A"
    }
    $line2 = New-Object System.Windows.Controls.TextBlock
    $line2.Text = "包内 " + $Component.version
    $line2.FontSize = 12
    $line2.Foreground = Brush "#6B7280"
    $line2.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $line2.Margin = [System.Windows.Thickness]::new(0, 3, 0, 0)
    $versions.Children.Add($line1) | Out-Null
    $versions.Children.Add($line2) | Out-Null
    $grid.Children.Add($versions) | Out-Null

    $size = New-Object System.Windows.Controls.TextBlock
    [System.Windows.Controls.Grid]::SetColumn($size, 3)
    $size.Text = Format-Size $Component.sizeBytes
    $size.FontSize = 12
    $size.Foreground = Brush "#9CA3AF"
    $size.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $size.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $grid.Children.Add($size) | Out-Null

    $border.Child = $grid
    $script:rowsById[$Component.id] = $border
    return $border
}

function Update-Rows {
    $script:updating = $true
    $RowsPanel.Children.Clear()
    $script:checks = @()
    $script:checksById = @{}
    $script:rowsById = @{}
    $script:componentSize = @{}
    $script:installed = @{}
    $script:installedVersions = @{}

    $state = @{ components = @{} }
    if ($script:previewMode) {
        $fake = @{
            "runtime-node" = "Node 26.12.0"
            "runtime-jdk"  = "Temurin 25.0.4"
            ts             = "TypeScript 6.0.2 · vtsls 0.2.9"
            python         = "Pyright 1.1.400 · Ruff 0.17.0 · debugpy 1.8.21"
            java           = "JDT LS 1.62.0 · java-debug 0.59.0"
        }
        foreach ($id in $fake.Keys) { $script:installed[$id] = $true; $script:installedVersions[$id] = $fake[$id] }
    } else {
        $state = Read-State $ToolsDir
        foreach ($component in $bundle.components) {
            if (Test-ComponentInstalled $ToolsDir $component) {
                $script:installed[$component.id] = $true
                $script:installedVersions[$component.id] = Get-ComponentInstalledVersion $state $component.id
            }
        }
    }

    $category = ""
    foreach ($component in $bundle.components) {
        $script:componentSize[$component.id] = $component.sizeBytes
        if ($component.category -ne $category) {
            $category = $component.category
            $RowsPanel.Children.Add((New-CategoryHeader $category)) | Out-Null
        }
        $isInstalled = [bool]$script:installed[$component.id]
        $version = $script:installedVersions[$component.id]
        $RowsPanel.Children.Add((New-Row $component $isInstalled $version)) | Out-Null
    }
    $script:updating = $false
    Update-Actions
}

function Invoke-Cli {
    param([string[]]$Arguments)
    $script:logFile = Join-Path ([System.IO.Path]::GetTempPath()) ("openidea-installer-" + [guid]::NewGuid().ToString("N") + ".log")
    New-Item -ItemType File -Force -Path $script:logFile | Out-Null
    $cli = Join-Path $PSScriptRoot "cli.ps1"
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cli, "-ToolsDir", $ToolsDir, "-LogFile", $script:logFile, "-Force") + $Arguments
    $script:summary = ""
    Set-Busy $true
    $Progress.Value = 0
    $Progress.IsIndeterminate = $false
    $StatusText.Text = "正在准备…"
    $StatusText.Foreground = Brush "#4B5563"
    $LogExpander.IsExpanded = $true
    $LogBox.Text = ""
    $script:proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -PassThru -WindowStyle Hidden
    $script:timer.Start()
}

$script:timer = New-Object System.Windows.Threading.DispatcherTimer
$script:timer.Interval = [TimeSpan]::FromMilliseconds(500)
$script:timer.add_Tick({
        if ($script:logFile -and (Test-Path -LiteralPath $script:logFile)) {
            $lines = @(Get-Content -LiteralPath $script:logFile -Encoding UTF8 -ErrorAction SilentlyContinue)
            if ($lines.Count -gt 0) {
                $visible = New-Object System.Collections.Generic.List[string]
                foreach ($line in $lines) {
                    if ($line -match '^@PROGRESS\|(\d+)\|(\d+)$') {
                        $doneCount = [double]$matches[1]
                        $totalCount = [double]$matches[2]
                        if ($totalCount -gt 0) {
                            $Progress.IsIndeterminate = $false
                            $Progress.Value = [Math]::Min(100, ($doneCount / $totalCount) * 100)
                        }
                    } elseif ($line -match '^@STEP\|(install|uninstall)\|(.+)$') {
                        Set-RowState $matches[2] "active"
                    } elseif ($line -match '^@STEP\|done\|(.+)$') {
                        Set-RowState $matches[1] "done"
                    } elseif ($line -match '^@SUMMARY\|(.+)$') {
                        $script:summary = $matches[1]
                    } else {
                        $visible.Add($line)
                    }
                }
                $LogBox.Text = ($visible -join "`r`n")
                $LogBox.ScrollToEnd()
                if ($visible.Count -gt 0) { $StatusText.Text = $visible[$visible.Count - 1] }
            }
        }
        if ($script:proc -and $script:proc.HasExited) {
            $script:timer.Stop()
            $Progress.IsIndeterminate = $false
            Set-Busy $false
            $ok = ($script:proc.ExitCode -eq 0)
            $script:proc = $null
            Update-Rows
            if ($ok) {
                $message = "完成。重启 OpenIDEA 后生效。"
                if ($script:summary -match 'installed=(\d+);skipped=(\d+);bytes=(\d+)') {
                    $message = "已安装/更新 " + $matches[1] + " 个组件"
                    if ([int]$matches[2] -gt 0) { $message += "，跳过 " + $matches[2] + " 个已是最新的" }
                    $message += "，共 " + (Format-Size ([double]$matches[3])) + "。重启 OpenIDEA 后生效。"
                } elseif ($script:summary -match 'removed=(\d+);bytes=(\d+)') {
                    $message = "已卸载 " + $matches[1] + " 个组件，释放约 " + (Format-Size ([double]$matches[2])) + "。"
                }
                $StatusText.Text = $message
                $StatusText.Foreground = Brush "#15803D"
                $Progress.Value = 100
            } else {
                $StatusText.Text = "操作失败，请查看下方日志。"
                $StatusText.Foreground = Brush "#B91C1C"
                $LogExpander.IsExpanded = $true
            }
        }
    })

$InstallButton.add_Click({
        $ids = @($script:checks | Where-Object { $_.IsChecked -eq $true -and $_.IsEnabled -and -not $script:installed[[string]$_.Tag] } | ForEach-Object { [string]$_.Tag })
        if ($ids.Count -eq 0) { return }
        Invoke-Cli (@("-Install") + ($ids -join ","))
    })

$UninstallButton.add_Click({
        $ids = @($script:checks | Where-Object { $_.IsChecked -eq $true -and $_.IsEnabled -and $script:installed[[string]$_.Tag] } | ForEach-Object { [string]$_.Tag })
        if ($ids.Count -eq 0) { return }
        $names = @($ids | ForEach-Object { (Get-Component $bundle $_).name })
        $answer = [System.Windows.MessageBox]::Show(
            ("确定卸载以下组件吗？`n`n" + ($names -join "`n") + "`n`n只删除它们自己的文件，不影响 OpenIDEA 本身。"),
            "卸载组件", "YesNo", "Question")
        if ($answer -ne "Yes") { return }
        Invoke-Cli (@("-Uninstall") + ($ids -join ","))
    })

$SelectAll.add_Click({
        $script:updating = $true
        foreach ($box in $script:checks) { if ($box.IsEnabled) { $box.IsChecked = $true } }
        $script:updating = $false
        Update-Actions
    })

$SelectNone.add_Click({
        $script:updating = $true
        foreach ($box in $script:checks) { $box.IsChecked = $false }
        $script:updating = $false
        Update-Actions
    })

$RefreshButton.add_Click({ Update-Rows })
$CloseButton.add_Click({ $window.Close() })

$running = Get-Process -Name "openidea" -ErrorAction SilentlyContinue
if ($running -and -not $script:previewMode) {
    $Banner.Visibility = [System.Windows.Visibility]::Visible
    $BannerText.Text = "OpenIDEA 正在运行：安装/卸载可能因文件占用失败，建议先退出。"
}

Update-Rows

if ($Preview) {
    # Offscreen layout + render through a VisualBrush (works without an interactive desktop).
    $content = $window.Content
    $size = New-Object System.Windows.Size(1000, 780)
    $content.Measure($size)
    $content.Arrange((New-Object System.Windows.Rect(0, 0, 1000, 780)))
    $content.UpdateLayout()
    Write-Host ("preview: content=" + $content.ActualWidth + "x" + $content.ActualHeight + " rows=" + $RowsPanel.Children.Count)
    $brush = New-Object System.Windows.Media.VisualBrush($content)
    $visual = New-Object System.Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()
    $dc.DrawRectangle($brush, $null, (New-Object System.Windows.Rect(0, 0, 1000, 780)))
    $dc.Close()
    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(1000, 780, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [System.IO.File]::Create($Preview)
    $encoder.Save($stream)
    $stream.Close()
    $window.Close()
    exit 0
}

$window.ShowDialog() | Out-Null
