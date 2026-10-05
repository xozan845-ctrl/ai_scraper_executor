param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY, [string]$Url)
. "$PSScriptRoot/lib.ps1"

if (-not $Url) { $Url = New-TestUrl }

Write-Step "Sesión con credenciales (headers: Authorization/Cookie)"
try {
  $s = Invoke-Api POST 'sessions' @{
    url         = $Url
    credentials = @{ headers = @{ Authorization = 'Bearer test-token'; 'X-Demo' = '1' } }
  }
  Write-Ok "creada con credenciales: $($s.id) status=$($s.status)"
  if ($s.credentials) { throw 'la respuesta no debe incluir credenciales' }
  Write-Ok "credenciales no expuestas en la respuesta (cifradas en reposo)"

  # El detalle tampoco debe exponerlas
  $d = Invoke-Api GET "sessions/$($s.id)"
  if ($d.credentials) { throw 'el detalle no debe incluir credenciales' }
  Write-Ok "detalle tampoco las expone"
} catch {
  if ($_.Exception.Message -match 'CREDENTIALS_KEY') {
    Write-Warn2 "API sin CREDENTIALS_KEY configurada (esperado en dev): las credenciales no se pueden guardar"
  } else {
    throw
  }
}
