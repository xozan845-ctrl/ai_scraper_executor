param(
  [string]$BaseUrl = $env:API_URL,
  [string]$ApiKey = $env:API_KEY,
  [switch]$SkipSlow
)
. "$PSScriptRoot/lib.ps1"

# Ejecuta todos los flujos y resume PASS/FAIL. -SkipSlow omite los que lanzan radiografía/job real.
$fast = @('00-health.ps1', '02-sessions-history.ps1', '03-credentials.ps1', '04-jobs.ps1', '06-errors.ps1')
$slow = @('01-session-flow.ps1', '05-radiography.ps1')
$scripts = if ($SkipSlow) { $fast } else { $fast[0..0] + $slow + $fast[1..($fast.Count - 1)] }

Write-Host "Base URL: $BaseUrl" -ForegroundColor DarkGray
Write-Host "API key:  $(if ($ApiKey) { 'configurada' } else { 'no' })" -ForegroundColor DarkGray
Write-Host "Scripts:  $($scripts -join ', ')" -ForegroundColor DarkGray

$failures = @()
foreach ($s in $scripts) {
  Write-Host "`n########## $s ##########" -ForegroundColor Magenta
  try {
    & "$PSScriptRoot/$s" -BaseUrl $BaseUrl -ApiKey $ApiKey
    Write-Host "PASS  $s" -ForegroundColor Green
  } catch {
    $failures += $s
    Write-Host "FAIL  $s :: $($_.Exception.Message.Split([Environment]::NewLine)[0])" -ForegroundColor Red
  }
}

Write-Host ""
if ($failures.Count) {
  Write-Host "Fallaron $($failures.Count)/$($scripts.Count): $($failures -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "TODOS LOS FLUJOS OK ($($scripts.Count) scripts)" -ForegroundColor Green
