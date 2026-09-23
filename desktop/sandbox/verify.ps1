# Windows 샌드박스 안에서 실행됩니다. (호스트의 sandbox/run.ps1 이 부릅니다)
#
#   -Phase install : 설치 프로그램 실행 → 자동 시작 등록 확인 → 반투명/또렷 픽셀 측정 → 껐다 켜기
#   -Phase reboot  : 재부팅 뒤 로그온만으로 위젯이 떠 있는지 확인
#
# 결과는 C:\postit\out\<phase>.json 과 스크린샷 PNG 로 남깁니다.
param([Parameter(Mandatory)][ValidateSet("install", "reboot")][string]$Phase)

$ErrorActionPreference = "Stop"
$Out = "C:\postit\out"
$Setup = "C:\postit\release\post-it-desktop-setup.exe"
$Exe = Join-Path $env:LOCALAPPDATA "Programs\post-it-desktop\Post-it.exe"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -ItemType Directory -Force $Out | Out-Null

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -Name U -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SystemParametersInfo(int a, int b, string c, int d);
[DllImport("user32.dll")] public static extern bool SetSysColors(int n, int[] e, int[] c);
'@
[W.U]::SetProcessDPIAware() | Out-Null

$result = [ordered]@{ phase = $Phase; checks = [ordered]@{} }
function Check($name, $ok, $detail) {
  $result.checks[$name] = [ordered]@{ ok = [bool]$ok; detail = "$detail" }
  Write-Output ("[{0}] {1} - {2}" -f ($(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail))
}

function Get-PostItProcesses { @(Get-CimInstance Win32_Process -Filter "Name='Post-it.exe'") }
# Electron 은 한 앱에 여러 프로세스를 띄웁니다. --type= 이 없는 것이 본체입니다.
function Get-MainProcesses { @(Get-PostItProcesses | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch "--type=" }) }

function Wait-Until([scriptblock]$cond, [int]$seconds = 30) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}

# 위젯은 주 모니터 작업 영역 오른쪽 위(여백 24)에 320x176 으로 뜹니다. 카드는 창 안쪽 6px.
function Get-CardRect {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $g = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
  $s = $g.DpiX / 96.0; $g.Dispose()
  $x = [int]($wa.Right - (320 + 24) * $s); $y = [int]($wa.Top + 24 * $s)
  return [System.Drawing.Rectangle]::new($x + [int](10 * $s), $y + [int](10 * $s), [int](300 * $s), [int](156 * $s))
}

function Capture([System.Drawing.Rectangle]$r, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $r.Width, $r.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Location, [System.Drawing.Point]::Empty, $r.Size)
  $g.Dispose()
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  return $bmp
}

function Capture-Screen([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  (Capture $b $name).Dispose()
}

# 위젯이 가린 화면과 배경만 있는 화면을 비교해 위젯의 불투명도(alpha)를 추정합니다.
#   찍힌 색 = alpha * 카드색 + (1 - alpha) * 배경색   →   alpha = (찍힌 색 - 배경) / (카드색 - 배경)
# 카드 배경은 흰색(#fff)의 94% 입니다. 글자 픽셀은 중앙값으로 걸러집니다.
function Measure-Alpha($shot, $bg) {
  $alphas = New-Object System.Collections.Generic.List[double]
  for ($y = 0; $y -lt $shot.Height; $y += 3) {
    for ($x = 0; $x -lt $shot.Width; $x += 3) {
      $c = $shot.GetPixel($x, $y); $b = $bg.GetPixel($x, $y)
      $den = 255.0 - $b.G
      if ($den -lt 80) { continue }
      $alphas.Add(($c.G - $b.G) / $den)
    }
  }
  if ($alphas.Count -eq 0) { return -1 }
  $sorted = $alphas | Sort-Object
  return [math]::Round($sorted[[int]($sorted.Count / 2)], 3)
}

# 샌드박스 창 위에 호스트 마우스가 있으면 커서 위치가 덮어써질 수 있어, 잠시 붙잡아 둡니다.
function Hold-Cursor([int]$x, [int]$y, [int]$ms = 1200) {
  $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) { [W.U]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 50 }
}
function Move-CursorAway { $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Hold-Cursor ($wa.Left + 40) ($wa.Bottom - 40) 600 }
function Move-CursorOnto($r) { Hold-Cursor ($r.X + [int]($r.Width / 2)) ($r.Y + [int]($r.Height / 2)) }

# 카드 색(흰색)을 알고 측정하도록 앱 테마를 밝게 고정합니다.
$personalize = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
New-Item -Force $personalize | Out-Null
Set-ItemProperty $personalize AppsUseLightTheme 1 -Type DWord

# 측정하기 쉽게 바탕화면을 어두운 단색으로 (배경화면 끄기 + 배경색 #202830)
[W.U]::SetSysColors(1, @(1), @(0x302820)) | Out-Null
[W.U]::SystemParametersInfo(0x14, 0, "", 3) | Out-Null
# 다른 창이 위젯 자리를 가리지 않도록 모두 최소화
(New-Object -ComObject Shell.Application).MinimizeAll()
Start-Sleep -Seconds 1

if ($Phase -eq "install") {
  # 1) 설치 (사용자가 내려받은 설치 파일을 여는 것과 같음. /S 는 조용히 설치)
  $p = Start-Process $Setup -ArgumentList "/S" -PassThru -Wait
  Check "installer-exit-code" ($p.ExitCode -eq 0) "exit=$($p.ExitCode)"
  Check "installed-exe" (Test-Path $Exe) $Exe
  $lnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Post-it 위젯.lnk"
  Check "start-menu-shortcut" (Test-Path $lnk) $lnk

  # 2) 처음 실행 (설치 직후 자동으로 뜨지 않았다면 사용자가 시작 메뉴에서 여는 것과 같음)
  if ((Get-PostItProcesses).Count -eq 0) { Start-Process $Exe }
  $up = Wait-Until { (Get-PostItProcesses).Count -gt 0 } 30
  Check "app-running" $up "processes=$((Get-PostItProcesses).Count)"
  Start-Sleep -Seconds 6
  Move-CursorAway
  Start-Sleep -Seconds 1

  # 3) 자동 시작 등록
  $run = (Get-ItemProperty $RunKey -ErrorAction SilentlyContinue)."Post-it"
  Check "autostart-registered" ($run -and $run -like "*Post-it.exe*--autostart*") "Run\Post-it = $run"

  # 4) 반투명 ↔ 또렷
  $rect = Get-CardRect
  $idle = Capture $rect "1-idle"
  Move-CursorOnto $rect
  $hover = Capture $rect "2-hover"
  Capture-Screen "screen-hover"
  Move-CursorAway; Start-Sleep -Milliseconds 900
  $idle2 = Capture $rect "3-idle-again"
  Capture-Screen "screen-idle"

  # 5) 껐다 켜기 (명령줄 --toggle 은 트레이 아이콘 클릭과 같은 동작)
  Start-Process $Exe -ArgumentList "--toggle" -Wait
  Start-Sleep -Milliseconds 900
  $hidden = Capture $rect "4-hidden"
  $mains = @(Get-MainProcesses)
  Check "still-single-instance" ($mains.Count -eq 1) ("main=" + $mains.Count + " " + (($mains | ForEach-Object { $_.CommandLine }) -join " | "))

  $aIdle = Measure-Alpha $idle $hidden
  $aHover = Measure-Alpha $hover $hidden
  $aIdle2 = Measure-Alpha $idle2 $hidden
  Check "translucent-when-idle" ($aIdle -gt 0.2 -and $aIdle -lt 0.55) "alpha=$aIdle (기대 0.4 x 0.94 = 0.38)"
  Check "opaque-on-hover" ($aHover -gt 0.85) "alpha=$aHover (기대 0.94)"
  Check "translucent-after-leave" ($aIdle2 -gt 0.2 -and $aIdle2 -lt 0.55) "alpha=$aIdle2"

  Start-Process $Exe -ArgumentList "--toggle" -Wait
  Start-Sleep -Milliseconds 900
  Move-CursorAway; Start-Sleep -Milliseconds 600
  $back = Capture $rect "5-shown-again"
  $aBack = Measure-Alpha $back $hidden
  Check "toggle-shows-again" ($aBack -gt 0.2) "alpha=$aBack"
  $hidden.Dispose(); $idle.Dispose(); $hover.Dispose(); $idle2.Dispose(); $back.Dispose()
}

if ($Phase -eq "reboot") {
  # 재부팅 뒤 이 스크립트는 아무것도 실행하지 않습니다. 로그온만으로 떠 있어야 합니다.
  $up = Wait-Until { (Get-PostItProcesses).Count -gt 0 } 90
  $main = Get-MainProcesses | Select-Object -First 1
  Check "running-after-reboot" $up "cmd=$($main.CommandLine)"
  Check "started-by-autostart" ($main -and $main.CommandLine -match "--autostart") "$($main.CommandLine)"
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  Check "started-after-boot" ($main -and $main.CreationDate -gt $boot) "boot=$boot started=$($main.CreationDate)"

  Start-Sleep -Seconds 5
  Move-CursorAway; Start-Sleep -Seconds 1
  $rect = Get-CardRect
  $idle = Capture $rect "6-after-reboot-idle"
  Capture-Screen "screen-after-reboot"
  Start-Process $Exe -ArgumentList "--hide" -Wait; Start-Sleep -Milliseconds 900
  $hidden = Capture $rect "7-after-reboot-hidden"
  $a = Measure-Alpha $idle $hidden
  Check "widget-visible-after-reboot" ($a -gt 0.2 -and $a -lt 0.55) "alpha=$a"
  Start-Process $Exe -ArgumentList "--show" -Wait

  # 제거하면 앱과 자동 실행 값이 함께 사라져야 합니다.
  $uninstaller = Join-Path (Split-Path $Exe) "Uninstall Post-it.exe"
  Start-Process $uninstaller -ArgumentList "/S" -Wait
  Wait-Until { -not (Test-Path $Exe) } 60 | Out-Null
  Check "uninstalled" (-not (Test-Path $Exe)) $Exe
  $left = (Get-ItemProperty $RunKey -ErrorAction SilentlyContinue)."Post-it"
  Check "autostart-removed-on-uninstall" (-not $left) "Run\Post-it = $left"
}

$result.passed = -not ($result.checks.Values | Where-Object { -not $_.ok })
$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $Out "$Phase.json")
Write-Output ("RESULT {0}: {1}" -f $Phase, $(if ($result.passed) { "PASS" } else { "FAIL" }))
