# 깨끗한 Windows 에서 설치본이 제대로 도는지 Windows 샌드박스로 확인합니다.
#
#   npm run dist              # release\post-it-desktop-setup.exe 를 먼저 만듭니다
#   npm run test:sandbox      # = powershell -File sandbox\run.ps1
#
# 1) 새 샌드박스를 띄워 설치 → 자동 시작 등록 → 반투명/또렷 → 껐다 켜기를 확인하고
# 2) 샌드박스 안에서 재부팅한 뒤, 로그온만으로 위젯이 다시 떠 있는지 확인합니다.
# 결과: sandbox\out\install.json, reboot.json, 스크린샷 PNG
#
# 샌드박스는 창을 연결해야 사용자가 로그온되므로, 도는 동안 샌드박스 창이 화면에 뜹니다.

# wsb 가 stderr 에 쓰는 안내문을 오류로 취급하지 않도록 Continue 로 둡니다.
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
$Out = Join-Path $PSScriptRoot "out"
$Setup = Join-Path $Root "release\post-it-desktop-setup.exe"
if (-not (Test-Path $Setup)) { Write-Error "먼저 npm run dist 로 $Setup 를 만드세요."; exit 1 }

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory $Out | Out-Null

$config = @"
<Configuration>
  <Networking>Enable</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$(Split-Path $Setup)</HostFolder><SandboxFolder>C:\postit\release</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$PSScriptRoot</HostFolder><SandboxFolder>C:\postit\sandbox</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$Out</HostFolder><SandboxFolder>C:\postit\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
</Configuration>
"@

# wsb exec 는 자기 종료 코드 대신 "…(코드: N)" / "(code: N)" 문구로 결과를 알려 줍니다.
function Invoke-Sandbox([string]$command, [string]$as = "ExistingLogin") {
  $text = & wsb exec --id $script:Id -c $command -r $as 2>&1 | Out-String
  if ($text -match ":\s*(-?\d+)\)") { return [int]$Matches[1] }
  return -1
}

function Get-BootTime {
  $file = "C:\postit\out\boot.txt"
  Invoke-Sandbox "powershell -NoProfile -Command (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o') | Set-Content $file" "System" | Out-Null
  $hostFile = Join-Path $Out "boot.txt"
  if (Test-Path $hostFile) { return (Get-Content $hostFile -Raw).Trim() }
  return $null
}

# 창이 연결돼 있어야 사용자가 로그온됩니다. 재부팅하면서 창이 끊기면 다시 연결합니다.
function Connect-Window { Start-Process wsb -ArgumentList "connect", "--id", $script:Id }

function Wait-Logon([int]$seconds = 300) {
  $deadline = (Get-Date).AddSeconds($seconds)
  $reconnectAt = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ((Invoke-Sandbox "C:\postit\sandbox\logged-on.cmd") -eq 0) { Start-Sleep -Seconds 8; return }
    if ((Get-Date) -gt $reconnectAt) { Connect-Window; $reconnectAt = (Get-Date).AddSeconds(45) }
    Start-Sleep -Seconds 3
  }
  throw "샌드박스 로그온을 기다리다 시간이 지났습니다."
}

function Show-Result([string]$phase) {
  $file = Join-Path $Out "$phase.json"
  if (-not (Test-Path $file)) { Write-Host "[$phase] 결과 파일이 없습니다." -ForegroundColor Red; return $false }
  $r = Get-Content $file -Raw -Encoding utf8 | ConvertFrom-Json
  foreach ($p in $r.checks.PSObject.Properties) {
    $color = if ($p.Value.ok) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}  {2}" -f $(if ($p.Value.ok) { "PASS" } else { "FAIL" }), $p.Name, $p.Value.detail) -ForegroundColor $color
  }
  return [bool]$r.passed
}

$script:Id = ((& wsb start --config $config --raw 2>$null) | ConvertFrom-Json).Id
if (-not $script:Id) { Write-Error "샌드박스를 시작하지 못했습니다."; exit 1 }
Write-Host "샌드박스 시작: $script:Id"
$code = 1
try {
  Connect-Window
  Wait-Logon
  $ps = "powershell -NoProfile -ExecutionPolicy Bypass -File C:\postit\sandbox\verify.ps1"

  Write-Host "1) 설치와 동작 확인"
  Invoke-Sandbox "$ps -Phase install" | Out-Null
  $ok1 = Show-Result "install"

  Write-Host "2) 샌드박스 안에서 재부팅"
  $before = Get-BootTime
  Invoke-Sandbox "shutdown /r /t 0" "System" | Out-Null
  $deadline = (Get-Date).AddSeconds(300)
  do { Start-Sleep -Seconds 5; $after = Get-BootTime } while (($after -eq $before -or -not $after) -and (Get-Date) -lt $deadline)
  Write-Host "   부팅 시각 $before → $after"
  Wait-Logon
  Invoke-Sandbox "$ps -Phase reboot" | Out-Null
  $ok2 = ($after -ne $before) -and (Show-Result "reboot")

  if ($ok1 -and $ok2) { Write-Host "샌드박스 검증 통과" -ForegroundColor Green; $code = 0 }
  else { Write-Host "샌드박스 검증 실패" -ForegroundColor Red }
}
catch {
  Write-Host $_ -ForegroundColor Red
}
finally {
  if (-not $env:POSTIT_KEEP_SANDBOX) { & wsb stop --id $script:Id 2>&1 | Out-Null }
}
exit $code
