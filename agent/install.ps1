***REMOVED*** WorkerMill Agent Installer for Windows
***REMOVED*** Usage: irm https://workermill.com/install.ps1 | iex
$ErrorActionPreference = "Stop"

$cdnBase = "https://workermill.com/agent/latest"
$binaryName = "workermill-agent-win-x64.exe"
$installDir = "$env:LOCALAPPDATA\workermill\bin"

Write-Host "Installing WorkerMill Agent (windows-x64)..." -ForegroundColor Cyan

***REMOVED*** Download
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$outPath = Join-Path $installDir "workermill-agent.exe"
Invoke-WebRequest -Uri "$cdnBase/$binaryName" -OutFile $outPath

***REMOVED*** Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")
    Write-Host "Added $installDir to user PATH"
}

Write-Host ""
Write-Host "WorkerMill Agent installed to $outPath" -ForegroundColor Green
Write-Host ""
Write-Host "Run 'workermill-agent' to get started (you may need to restart your terminal)."
