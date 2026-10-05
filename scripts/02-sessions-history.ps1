param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY, [string]$Url)
. "$PSScriptRoot/lib.ps1"

if (-not $Url) { $Url = New-TestUrl }

Write-Step "Historial de sesiones (barra lateral del chat)"
$before = @(Invoke-Api GET 'sessions')
Write-Ok "$($before.Count) sesiones antes"

$s = Invoke-Api POST 'sessions' @{ url = $Url }
Write-Ok "creada sesión $($s.id)"

$after = @(Invoke-Api GET 'sessions')
if ($after.Count -lt 1) { throw 'el historial quedó vacío' }
if (-not ($after | Where-Object { $_.id -eq $s.id })) { throw 'la sesión nueva no aparece en el historial' }
Write-Ok "$($after.Count) sesiones después (incluye la nueva)"

$detail = Invoke-Api GET "sessions/$($s.id)"
Write-Ok "detalle: status=$($detail.status) mensajes=$(@($detail.messages).Count) dominio=$($detail.domain)"
if ($detail.credentials) { throw 'la API NUNCA debe devolver credenciales' }
Write-Ok "no expone credenciales"
