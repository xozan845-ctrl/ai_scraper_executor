param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY)
. "$PSScriptRoot/lib.ps1"

Write-Step "Health (liveness + readiness)"
$h = Invoke-Api GET 'health'
if ($h.status -ne 'ok') { throw "health != ok ($($h.status))" }
Write-Ok "liveness: $($h.status) service=$($h.service)"

try {
  $r = Invoke-Api GET 'health/ready'
  Write-Ok "readiness: $($r.status) checks=$($r.checks | ConvertTo-Json -Compress)"
} catch {
  Write-Warn2 "readiness no OK: $($_.Exception.Message.Split([Environment]::NewLine)[0])"
}

Write-Step "OpenAPI disponible"
try {
  $doc = Invoke-WebRequest -Method GET -Uri "$BaseUrl/docs-json" -SkipHttpErrorCheck
  if ($doc.StatusCode -eq 200) { Write-Ok "OpenAPI en /api/v1/docs (docs-json 200)" }
  else { Write-Warn2 "docs-json devolvió $($doc.StatusCode)" }
} catch { Write-Warn2 "no se pudo leer docs-json: $($_.Exception.Message)" }
