param([string]$BaseUrl = $env:API_URL, [string]$ApiKey = $env:API_KEY, [string]$Url, [int]$TimeoutSec = 300)
. "$PSScriptRoot/lib.ps1"

if (-not $Url) { $Url = New-TestUrl }

Write-Step "Radiografía directa (POST /radiography) para $Url"
$r = Invoke-Api POST 'radiography' @{ url = $Url; maxDepth = 1; maxPages = 3; forceBrowser = $true }
Write-Ok "perfil=$($r.profileId) dominio=$($r.domain)"
Write-Ok "selectores lista=$(@($r.discovered.listSelectors).Count) detalle=$(@($r.discovered.detailSelectors).Count)"

$domain = $r.domain
Write-Step "Perfil aprendido y selectores"
$p = Invoke-Api GET "radiography/profile/$domain"
Write-Ok "perfil: $($p.domain) isJavaScriptHeavy=$($p.isJavaScriptHeavy) totalJobs=$($p.totalJobs)"
$sel = Invoke-Api GET "radiography/profile/$domain/selectors"
Write-Ok "selectors list=[$($sel.recommendedSelectors.list -join ', ')] detail=[$($sel.recommendedSelectors.detail -join ', ')]"

Write-Step "Stats del dominio"
$stats = Invoke-Api GET "radiography/domain/$domain/stats"
Write-Ok "radiografías recientes=$($stats.recentRadiographies) avgLoadTime=$([math]::Round($stats.avgLoadTime))ms browserRate=$($stats.browserUsageRate)"
