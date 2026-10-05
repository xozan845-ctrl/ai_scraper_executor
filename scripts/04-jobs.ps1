param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY, [string]$Url)
. "$PSScriptRoot/lib.ps1"

if (-not $Url) { $Url = New-TestUrl }

Write-Step "Jobs: crear / listar / filtrar / execution / ai / idempotencia / cancel"
$j = Invoke-Api POST 'jobs' @{ url = $Url; instruction = 'Obtén productos'; priority = 3 }
Write-Ok "job $($j.id) status=$($j.status) priority=3"

Write-Step "Listado paginado + filtro por estado"
$page = Invoke-Api GET 'jobs?limit=5'
Write-Ok "items=$(@($page.items).Count) nextCursor=$($page.nextCursor)"
$failed = Invoke-Api GET 'jobs?status=FAILED&limit=5'
Write-Ok "filtro status=FAILED items=$(@($failed.items).Count)"

Write-Step "Detalle / execution / ai"
$one = Invoke-Api GET "jobs/$($j.id)"
Write-Ok "detalle: $($one.id) $($one.status)"
$exec = Invoke-Api GET "jobs/$($j.id)/execution"
Write-Ok "execution commands=$(@($exec.commands).Count) pages=$(@($exec.pages).Count) errors=$(@($exec.errors).Count)"
$ai = Invoke-Api GET "jobs/$($j.id)/ai?limit=10"
Write-Ok "ai calls=$($ai.count)"

Write-Step "Idempotencia (Idempotency-Key)"
$key = [guid]::NewGuid().ToString()
$j1 = Invoke-Api POST 'jobs' @{ url = $Url; instruction = 'Idem test' } -ExtraHeaders @{ 'Idempotency-Key' = $key }
$j2 = Invoke-Api POST 'jobs' @{ url = $Url; instruction = 'Idem test' } -ExtraHeaders @{ 'Idempotency-Key' = $key }
if ($j1.id -ne $j2.id) { throw "idempotencia rota: $($j1.id) != $($j2.id)" }
Write-Ok "misma clave -> mismo job ($($j1.id))"

Write-Step "Cancelar"
$c = Invoke-Api POST "jobs/$($j.id)/cancel"
Write-Ok "cancel -> $($c.status)"
if ($c.status -notin @('CANCELLED', 'COMPLETED', 'FAILED')) { throw "estado inesperado tras cancelar: $($c.status)" }

Write-Step "Retry (reencola FAILED)"
# Forzamos un FAILED rápido: cancelar no sirve; probamos retry sobre un job inexistente (404) y sobre uno válido.
Assert-Fails { Invoke-Api POST 'jobs/job_inexistente/retry' } 'no encontrado'
Write-Ok "retry de job inexistente -> 404"
