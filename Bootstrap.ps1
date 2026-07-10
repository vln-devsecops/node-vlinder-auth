# Run from repo root: pwsh -File ./Bootstrap.ps1
$ErrorActionPreference = "Stop"

if (Test-Path .devcontainer/devcontainer.json) {
  Write-Host "This repository is expected to run from a dev container."
  Write-Host "Open in the dev container and run bootstrap there."
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Missing Node.js. Install it (see .nvmrc for the expected major version) and run Bootstrap.ps1 again."
  exit 1
}

$nodeMajor = (node -p "process.versions.node.split('.')[0]").Trim()
$expectedMajor = (Get-Content .nvmrc -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($expectedMajor -and ($nodeMajor -ne $expectedMajor.Trim())) {
  Write-Host "node is v$nodeMajor, but .nvmrc expects v$expectedMajor."
  Write-Host "Switch Node versions, then run Bootstrap.ps1 again."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Missing npm."
  exit 1
}

if (-not (Test-Path .env)) {
  if (-not (Test-Path dot-env)) {
    Write-Host "Missing dot-env template in repository root."
    exit 1
  }

  $createEnv = Read-Host ".env is missing. Create it from dot-env now? [y/N]"
  if ($createEnv -match '^[Yy]$') {
    Copy-Item dot-env .env
    Write-Host "Created .env from dot-env. Please fill in values, then run Bootstrap.ps1 again."
    exit 1
  } else {
    Write-Host "Cannot continue without .env."
    exit 1
  }
}

npm install

Write-Host "Bootstrap complete for node-vlinder-auth."
