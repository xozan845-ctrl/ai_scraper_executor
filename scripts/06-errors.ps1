param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY)
. "$PSScriptRoot/lib.ps1"

Write-Step "SSRF / validación"
Assert-Fails { Invoke-Api POST 'sessions' @{ url = 'http://169.254.169.254/latest/meta-data/' } } 'rechazada|SSRF|dominio|URL'
Assert-Fails { Invoke-Api POST 'sessions' @{ url = 'http://127.0.0.1:6379/' } } 'rechazada|SSRF|dominio|URL'
Assert-Fails { Invoke-Api POST 'sessions' @{ url = 'no-es-una-url' } } 'url|URL'
Assert-Fails { Invoke-Api POST 'sessions' @{} } 'url|URL'
Assert-Fails { Invoke-Api POST 'jobs' @{ url = 'https://example.com'; instruction = 'x' } } 'instruction|shorter|length'
Write-Ok "validaciones de entrada OK"

Write-Step "Recursos inexistentes (404)"
Assert-Fails { Invoke-Api GET 'jobs/job_inexistente' } 'no encontrado'
Assert-Fails { Invoke-Api GET 'sessions/sess_inexistente' } 'no encontrada'
Assert-Fails { Invoke-Api POST 'sessions/sess_inexistente/messages' @{ instruction = 'hola' } } 'no encontrada'
Assert-Fails { Invoke-Api POST 'jobs/job_inexistente/cancel' } 'no encontrado'
Assert-Fails { Invoke-Api POST 'jobs/job_inexistente/retry' } 'no encontrado'

Write-Step "Enviar mensaje antes de READY -> 409"
$s = Invoke-Api POST 'sessions' @{ url = (New-TestUrl) }
Assert-Fails { Invoke-Api POST "sessions/$($s.id)/messages" @{ instruction = 'productos' } } 'no está lista|409'
Write-Ok "input bloqueado hasta READY verificado (409)"

Write-Step "Auth (si el servidor tiene API_KEYS)"
if ($ApiKey) {
  $resp = Invoke-WebRequest -Method GET -Uri "$BaseUrl/jobs" -SkipHttpErrorCheck
  if ($resp.StatusCode -ne 401) { throw "esperaba 401 sin x-api-key, recibí $($resp.StatusCode)" }
  Write-Ok "401 sin API key"
} else {
  Write-Warn2 "API_KEY no configurada en el cliente; se omite el test de 401"
}
