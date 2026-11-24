# Developer tool: takes a headless Chrome screenshot of index.html.
# Usage: powershell -File scripts/shot.ps1 -Hash "autorun&level=1&t=3" -Out shot.png
param(
  [string]$Hash = "skipboot",
  [string]$Out = "shot.png",
  [int]$Width = 1500,
  [int]$Height = 940,
  [int]$Budget = 1500
)
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
$page = (Resolve-Path (Join-Path $PSScriptRoot "..\index.html")).Path
$url = "file:///" + ($page -replace '\\', '/') + "#" + $Hash
$outPath = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path (Get-Location) $Out }
& $chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
  "--window-size=$Width,$Height" "--virtual-time-budget=$Budget" "--screenshot=$outPath" $url 2>$null | Out-Null
Write-Output $outPath
