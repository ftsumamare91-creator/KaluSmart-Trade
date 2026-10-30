$ErrorActionPreference = "Continue"

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$api = Join-Path $base "apps\api"
$web = Join-Path $base "apps\web"

Write-Host "Starting KaluSmart Trade services..." -ForegroundColor Cyan

# Backend API in a separate PowerShell window
Start-Process powershell.exe -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$api'; npm run start:dev"
)

Start-Sleep -Seconds 3

# Frontend on port 3001
Start-Process powershell.exe -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$web'; npm run dev -- --port 3001"
)

# Open website after services have time to initialize
Start-Sleep -Seconds 8
Start-Process "http://localhost:3001"

Write-Host ""
Write-Host "Frontend: http://localhost:3001" -ForegroundColor Green
Write-Host "Backend:  http://localhost:4000/api/health"
Write-Host "Database: PostgreSQL on port 5432"
Write-Host ""
Write-Host "Keep the API and Web terminal windows open." -ForegroundColor Yellow
