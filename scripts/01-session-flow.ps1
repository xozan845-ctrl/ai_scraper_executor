param(
  [string]$BaseUrl = $env:API_URL,
  [string]$ApiKey = $env:API_KEY,
  [string]$Url,
  [int]$TimeoutSec = 300
)
. "$PSScriptRoot/lib.ps1"

if (-not $Url) { $Url = New-TestUrl }

# Flujo completo del "chat": crear URL -> esperar radiografía -> instrucción -> job -> resultados.
Write-Step "1) Crear sesión (chat) para $Url"
$s = Invoke-Api POST 'sessions' @{ url = $Url }
Write-Ok "sesión $($s.id) status=$($s.status)"
if ($s.status -ne 'RADIOGRAPHY') { throw "estado inicial inesperado: $($s.status)" }

Write-Step "2) Esperar radiografía (el input del chat debe estar BLOQUEADO hasta READY)"
$ready = Wait-SessionReady -Id $s.id -TimeoutSec $TimeoutSec
Write-Ok "READY — input desbloqueado"

Write-Step "3) Enviar instrucción (crea job con el contexto de la URL)"
$m = Invoke-Api POST "sessions/$($s.id)/messages" @{ instruction = 'Obtén todos los productos con nombre, precio e imagen' }
Write-Ok "job $($m.jobId) status=$($m.jobStatus)"

Write-Step "4) Esperar fin del job"
$job = Wait-JobDone -Id $m.jobId -TimeoutSec $TimeoutSec
Write-Ok "job $($job.status)"

Write-Step "5) Resultados del job"
$res = Invoke-Api GET "jobs/$($m.jobId)/results"
Write-Ok "$($res.count) resultados"
if ($res.items -and $res.items.Count -gt 0) {
  Write-Info ("primer item: " + (($res.items[0] | ConvertTo-Json -Depth 4 -Compress)))
}

Write-Step "6) Historial de la sesión (contexto continuo para el chat)"
$detail = Invoke-Api GET "sessions/$($s.id)"
$dom = if ($detail.profile) { $detail.profile.domain } else { 'n/a' }
Write-Ok "mensajes=$($detail.messages.Count) perfil=$dom"
$last = $detail.messages[-1]
Write-Ok "último mensaje: role=$($last.role) jobStatus=$($last.jobStatus) resultados=$(@($last.results).Count)"
