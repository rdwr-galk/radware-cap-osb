#!/usr/bin/env pwsh
Write-Host "Starting Radware CAP OSB in development mode..." -ForegroundColor Green
if (-not (Test-Path "node_modules")) { npm ci }
if (-not (Test-Path ".env") -and (Test-Path ".env.sample")) { Copy-Item ".env.sample" ".env" }
$env:NODE_ENV="development"
npm run dev
