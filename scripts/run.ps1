#!/usr/bin/env pwsh
Write-Host "Starting Radware CAP OSB in production mode..." -ForegroundColor Green
if (-not (Test-Path "node_modules")) { npm ci --omit=dev }
if (-not $env:BROKER_USER -or -not $env:BROKER_PASS -or -not $env:RADWARE_API_BASE -or -not $env:RADWARE_OPERATOR_KEY -or -not $env:DASHBOARD_BASE) {
    Write-Error "Missing required environment variables."
    exit 1
}
$env:NODE_ENV="production"
npm run start:prod
