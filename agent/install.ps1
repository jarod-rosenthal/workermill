# WorkerMill Agent Installer for Windows
# Usage: irm https://workermill.com/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "workermill/workermill"
$binaryName = "workermill-agent-win-x64.exe"
$installDir = "$env:LOCALAPPDATA\workermill\bin"

Write-Host "Installing WorkerMill Agent (windows-x64)..." -ForegroundColor Cyan

# Get latest release
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -eq $binaryName } | Select-Object -First 1

if (-not $asset) {
    Write-Host "Error: Could not find $binaryName in latest release." -ForegroundColor Red
    exit 1
}

# Download
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$outPath = Join-Path $installDir "workermill-agent.exe"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outPath

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")
    Write-Host "Added $installDir to user PATH"
}

Write-Host ""
Write-Host "WorkerMill Agent installed to $outPath" -ForegroundColor Green
Write-Host ""
Write-Host "Run 'workermill-agent' to get started (you may need to restart your terminal)."
