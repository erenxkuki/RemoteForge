# RemoteForge VPS Agent — Windows installer
# Usage: irm https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.ps1 | iex
param()

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "  RemoteForge VPS Agent Installer" -ForegroundColor Magenta
Write-Host ""

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[1/3] Node.js not found. Please install from https://nodejs.org (v20+)" -ForegroundColor Yellow
    exit 1
}
$nodeVer = (node --version) -replace 'v','' -split '\.' | Select-Object -First 1
if ([int]$nodeVer -lt 20) {
    Write-Host "Node.js 20+ required (found v$(node --version))" -ForegroundColor Red
    exit 1
}
Write-Host "[1/3] Node.js $(node --version) OK" -ForegroundColor Green

# Download agent
$installDir = "$env:USERPROFILE\.remoteforge-agent"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host "[2/3] Downloading agent..." -ForegroundColor Cyan
$agentUrl = "https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/agent.js"
try {
    Invoke-WebRequest -Uri $agentUrl -OutFile "$installDir\agent.js" -UseBasicParsing
    Write-Host "[2/3] Agent downloaded" -ForegroundColor Green
} catch {
    Write-Host "Download failed. Cloning repo..." -ForegroundColor Yellow
    if (Test-Path "$env:USERPROFILE\RemoteForge") { Remove-Item -Recurse -Force "$env:USERPROFILE\RemoteForge" }
    git clone --depth 1 https://github.com/erenxkuki/RemoteForge.git "$env:USERPROFILE\RemoteForge"
    Push-Location "$env:USERPROFILE\RemoteForge"
    npm run build
    Pop-Location
    Copy-Item "$env:USERPROFILE\RemoteForge\packages\agent\dist\index.js" "$installDir\agent.js"
    Write-Host "[2/3] Agent built" -ForegroundColor Green
}

# Create wrapper
$wrapper = "@echo off`nnode `"%USERPROFILE%\.remoteforge-agent\agent.js`" %*"
Set-Content -Path "$installDir\remoteforge-agent.cmd" -Value $wrapper

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    $env:Path = "$env:Path;$installDir"
}

Write-Host "[3/3] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "  Run: remoteforge-agent pair --server <SERVER_URL> --name myvps" -ForegroundColor Yellow
Write-Host ""