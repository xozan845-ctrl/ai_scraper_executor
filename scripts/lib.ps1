# scripts/lib.ps1 — helpers compartidos para probar la API (PowerShell 7+ / pwsh)
# Config por entorno:  API_URL (default http://localhost:3000/api/v1), API_KEY (x-api-key)
$ErrorActionPreference = 'Stop'

if (-not $BaseUrl) { $BaseUrl = if ($env:API_URL) { $env:API_URL } else { 'http://localhost:3000/api/v1' } }
if (-not $ApiKey) { $ApiKey = $env:API_KEY }

function Write-Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "   $msg" -ForegroundColor DarkGray }
function Write-Warn2($msg) { Write-Host "   [!] $msg" -ForegroundColor Yellow }

function Get-Headers {
  $h = @{ 'Content-Type' = 'application/json' }
  if ($ApiKey) { $h['x-api-key'] = $ApiKey }
  return $h
}

function Invoke-Api {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [object]$Body,
    [hashtable]$ExtraHeaders,
    [int]$TimeoutSec = 300
  )
  $uri = "$BaseUrl/$($Path.TrimStart('/'))"
  $headers = Get-Headers
  if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] } }
  $params = @{ Method = $Method; Uri = $uri; Headers = $headers; TimeoutSec = $TimeoutSec }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10) }
  try {
    return Invoke-RestMethod @params
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $status = [int]$resp.StatusCode
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $reader.ReadToEnd()
      throw "HTTP $status en $Method $Path :: $text"
    }
    throw
  }
}

function Assert-Fails {
  param([Parameter(Mandatory)][scriptblock]$Block, [string]$Match)
  try {
    & $Block | Out-Null
    throw 'Se esperaba un error pero la llamada tuvo éxito'
  } catch {
    $msg = $_.Exception.Message
    if ($Match -and $msg -notmatch $Match) { throw "El error no coincide con '$Match': $msg" }
    Write-Ok "error esperado: $($msg.Split([Environment]::NewLine)[0])"
  }
}

function Wait-SessionReady {
  param([Parameter(Mandatory)][string]$Id, [int]$TimeoutSec = 240, [int]$IntervalSec = 3)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $s = Invoke-Api GET "sessions/$Id/status"
    Write-Info "status = $($s.status)"
    if ($s.status -eq 'READY') { return $s }
    if ($s.status -eq 'FAILED') { throw "Radiografía FAILED: $($s.error)" }
    Start-Sleep -Seconds $IntervalSec
  }
  throw "Timeout esperando READY ($TimeoutSec s)"
}

function Wait-JobDone {
  param([Parameter(Mandatory)][string]$Id, [int]$TimeoutSec = 240, [int]$IntervalSec = 3)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $j = Invoke-Api GET "jobs/$Id"
    Write-Info "job status = $($j.status)"
    if ($j.status -in @('COMPLETED', 'FAILED', 'CANCELLED')) { return $j }
    Start-Sleep -Seconds $IntervalSec
  }
  throw "Timeout esperando fin del job ($TimeoutSec s)"
}

function New-TestUrl {
  param([string]$Default = 'https://www.sevasaonline.com/')
  return if ($env:TEST_URL) { $env:TEST_URL } else { $Default }
}
