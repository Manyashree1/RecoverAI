$ErrorActionPreference = 'Stop'

$zrok = Join-Path $env:LOCALAPPDATA 'Programs\zrok\zrok2.exe'
if (-not (Test-Path $zrok)) {
  throw "zrok is not installed at $zrok. Install the official release first."
}

try {
  $health = Invoke-RestMethod -UseBasicParsing 'http://localhost:3000/api/health'
} catch {
  throw 'RecoverAI backend is not reachable at http://localhost:3000. Start it with npm run dev first.'
}

if ($health.status -ne 'ok') {
  throw 'RecoverAI backend health check did not return status ok.'
}

& $zrok share public --headless --force-local 'localhost:3000'