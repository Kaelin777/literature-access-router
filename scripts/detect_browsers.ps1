# Detect controllable Chromium-based browsers and CDP availability on Windows.
# Outputs JSON for the literature-access-router pipeline.
$ErrorActionPreference = 'SilentlyContinue'

function Test-TcpPort {
    param([int]$Port, [string]$Host = '127.0.0.1', [int]$TimeoutMs = 800)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($Host, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { $client.Close(); return $false }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch { return $false }
}

$browsers = @(
    [pscustomobject]@{
        id = 'chrome'; name = 'Google Chrome';
        paths = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        );
        process = 'chrome';
        devtools = "$env:LOCALAPPDATA\Google\Chrome\User Data\DevToolsActivePort"
    },
    [pscustomobject]@{
        id = 'edge'; name = 'Microsoft Edge';
        paths = @(
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
        );
        process = 'msedge';
        devtools = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\DevToolsActivePort"
    },
    [pscustomobject]@{
        id = 'chromium'; name = 'Chromium';
        paths = @(
            "$env:ProgramFiles\Chromium\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Chromium\Application\chrome.exe",
            "$env:LOCALAPPDATA\Chromium\Application\chrome.exe"
        );
        process = 'chromium';
        devtools = "$env:LOCALAPPDATA\Chromium\User Data\DevToolsActivePort"
    }
)

$results = @()
foreach ($b in $browsers) {
    $installedPath = $b.paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $running = [bool](Get-Process -Name $b.process -ErrorAction SilentlyContinue)
    $cdp = $false
    $port = $null
    if (Test-Path -LiteralPath $b.devtools) {
        $lines = Get-Content -LiteralPath $b.devtools -ErrorAction SilentlyContinue
        if ($lines -and $lines.Count -ge 1) {
            $port = [int]$lines[0]
            $cdp = Test-TcpPort -Port $port
        }
    }
    $results += [pscustomobject]@{
        id = $b.id
        name = $b.name
        installed = [bool]$installedPath
        path = $installedPath
        running = $running
        cdp = $cdp
        devtools_port = $port
        controllable = [bool]($installedPath -and $cdp)
    }
}

$recommended = $results | Where-Object { $_.controllable } | Select-Object -First 1
if (-not $recommended) { $recommended = $results | Where-Object { $_.installed -and $_.running } | Select-Object -First 1 }
if (-not $recommended) { $recommended = $results | Where-Object { $_.installed } | Select-Object -First 1 }

[pscustomobject]@{
    os = 'Windows'
    browsers = $results
    recommended = if ($recommended) { $recommended.id } else { $null }
    needs_install = -not [bool]($results | Where-Object { $_.installed } | Select-Object -First 1)
    needs_cdp_enable = -not [bool]($results | Where-Object { $_.controllable } | Select-Object -First 1)
    notes = 'Only Chromium-based browsers with CDP are controllable. If no controllable browser exists, ask the user for permission before installing or enabling anything.'
} | ConvertTo-Json -Depth 5
