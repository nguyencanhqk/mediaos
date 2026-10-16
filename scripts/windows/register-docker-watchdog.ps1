<#
.SYNOPSIS
  Đăng ký tác vụ lịch «MediaOS-DockerWatchdog»: chạy docker-watchdog.ps1 lúc user fmcai đăng nhập
  (trễ 90 giây) và lặp mỗi 5 phút, ẩn cửa sổ qua scripts\run-hidden.vbs.

.DESCRIPTION
  CẦN ADMIN?  KHÔNG. Tác vụ chạy bằng chính tài khoản fmcai, LogonType=Interactive,
  RunLevel=Limited (Docker Desktop không cần quyền nâng). Windows cho user thường tạo tác vụ
  chạy dưới tên mình. Nếu Register-ScheduledTask báo «Access is denied» thì mở PowerShell
  bằng «Run as administrator» rồi chạy lại đúng lệnh này.

  VÌ SAO Interactive (không phải «Run whether user is logged on or not»): Docker Desktop là
  ứng dụng của phiên đăng nhập; session 0 không bật được nó và không với tới pipe Docker
  (xem ghi chú trong scripts\run-hidden.vbs). Máy đã AutoAdminLogon=1 nên phiên luôn có
  sau khi boot; tác vụ vẫn chạy khi màn hình đang khoá.

  VÌ SAO trễ 90 giây ở trigger logon: lúc bình thường Explorer tự bật Docker ở ~+30 giây
  (mục Run). Chờ 90 giây để watchdog chỉ ra tay khi Explorer đã lỡ (13/10, 16/10), tránh
  bật hai lần.

  CHỈ trỏ vào CÂY CHÍNH C:\dev 2\MediaOS (không worktree, không %TEMP%): tác vụ trỏ vào thư
  mục sẽ bị xoá thì hỏng câm (memory scheduled-task-pointing-at-worktree).

  Tương thích Windows PowerShell 5.1. File phải lưu UTF-8 CÓ BOM.

.EXAMPLE
  # Xem trước, không đăng ký gì:
  powershell -NoProfile -ExecutionPolicy Bypass -File register-docker-watchdog.ps1 -DryRun
  # Đăng ký (PowerShell thường của user fmcai, tại bất kỳ thư mục nào):
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\dev 2\MediaOS\scripts\windows\register-docker-watchdog.ps1"
  # Gỡ:
  powershell -NoProfile -ExecutionPolicy Bypass -File "...\register-docker-watchdog.ps1" -Unregister
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = 'C:\dev 2\MediaOS',
  [string]$WatchdogRelPath = 'scripts\windows\docker-watchdog.ps1',
  [string]$TaskName = 'MediaOS-DockerWatchdog',
  [string]$UserId = ($env:COMPUTERNAME + '\fmcai'),
  [int]$IntervalMinutes = 5,
  [int]$LogonDelaySeconds = 90,
  [switch]$DryRun,
  [switch]$Unregister
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$EXEC_LIMIT_MINUTES = 3
$VERIFY_WAIT_SECONDS = 40

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Inputs {
  $tempRoot = [IO.Path]::GetFullPath($env:TEMP)
  $repoFull = [IO.Path]::GetFullPath($RepoRoot)
  if ($repoFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('RepoRoot nam trong %TEMP% (' + $repoFull + '): tac vu se hong cam khi thu muc bi don.')
  }
  $gitPath = Join-Path $repoFull '.git'
  if (-not (Test-Path -LiteralPath $gitPath -PathType Container)) {
    throw ('RepoRoot khong phai cay chinh (.git khong phai thu muc - co the la worktree): ' + $repoFull)
  }
  if ($WatchdogRelPath -match '[\s"]') {
    throw ('WatchdogRelPath khong duoc chua khoang trang/ngoac kep (run-hidden.vbs khong chuyen duoc): ' + $WatchdogRelPath)
  }
  $watchdogFull = Join-Path $repoFull $WatchdogRelPath
  if (-not (Test-Path -LiteralPath $watchdogFull -PathType Leaf)) {
    if (-not $DryRun) { throw ('Khong thay watchdog: ' + $watchdogFull) }
    Write-Warning ('Chua co watchdog tai ' + $watchdogFull + ' (DryRun van in ke hoach; dang ky that se dung lai).')
  }
  $vbs = Join-Path $repoFull 'scripts\run-hidden.vbs'
  if (-not (Test-Path -LiteralPath $vbs -PathType Leaf)) {
    throw ('Khong thay ' + $vbs)
  }
  if ($IntervalMinutes -lt 1 -or $LogonDelaySeconds -lt 0) {
    throw 'IntervalMinutes >= 1 va LogonDelaySeconds >= 0'
  }
  return New-Object PSObject -Property @{ Repo = $repoFull; Watchdog = $watchdogFull; Vbs = $vbs }
}

function New-WatchdogTaskParts {
  param($Paths)
  $cmd = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $WatchdogRelPath
  $argLine = '"' + $Paths.Vbs + '" "' + $Paths.Repo + '" "' + $cmd + '"'
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $argLine -WorkingDirectory $Paths.Repo

  $logon = New-ScheduledTaskTrigger -AtLogOn -User $UserId
  $logon.Delay = 'PT' + $LogonDelaySeconds + 'S'
  # Bỏ -RepetitionDuration ⇒ lặp vô hạn (cùng khuôn MediaOS-OpsAlert, RELEASE-09 §4).
  $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

  $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $EXEC_LIMIT_MINUTES)

  return New-Object PSObject -Property @{
    Action = $action; Triggers = @($logon, $repeat); Principal = $principal; Settings = $settings; ArgLine = $argLine
  }
}

function Show-Plan {
  param($Paths, $Parts)
  Write-Host ('Tac vu      : ' + $TaskName)
  Write-Host ('Chay bang   : ' + $UserId + ' (Interactive, RunLevel Limited)')
  Write-Host ('Can Admin   : KHONG (dang chay voi quyen Admin: ' + (Test-IsAdmin) + ')')
  Write-Host ('Lenh        : wscript.exe ' + $Parts.ArgLine)
  Write-Host ('Trigger 1   : luc ' + $UserId + ' dang nhap, tre ' + $LogonDelaySeconds + ' giay')
  Write-Host ('Trigger 2   : moi ' + $IntervalMinutes + ' phut, vo han')
  Write-Host ('Cai dat     : IgnoreNew, StartWhenAvailable, gioi han ' + $EXEC_LIMIT_MINUTES + ' phut/lan')
  Write-Host ('Log         : ' + (Join-Path $Paths.Repo 'logs\docker-watchdog.log') + ' (chi khi co hanh dong/loi)')
  Write-Host ('Tam dung    : tao file ' + (Join-Path $Paths.Repo 'logs\docker-watchdog.pause'))
}

function Confirm-Registered {
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds($VERIFY_WAIT_SECONDS)
  do {
    Start-Sleep -Seconds 2
    $state = (Get-ScheduledTask -TaskName $TaskName).State
  } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ('Chay thu    : LastRunTime=' + $info.LastRunTime + ' LastTaskResult=' + $info.LastTaskResult + ' (0 = on; 2 = engine im qua nguong; 3 = khong bat duoc Docker)')
  Write-Host ('Lan ke tiep : ' + $info.NextRunTime)
}

if ($Unregister) {
  if ($DryRun) { Write-Host ('DRYRUN: se go tac vu ' + $TaskName); exit 0 }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ('Da go tac vu ' + $TaskName)
  exit 0
}

$paths = Assert-Inputs
$parts = New-WatchdogTaskParts -Paths $paths
Show-Plan -Paths $paths -Parts $parts

if ($DryRun) {
  Write-Host 'DRYRUN: khong dang ky gi.'
  exit 0
}

try {
  Register-ScheduledTask -TaskName $TaskName -Action $parts.Action -Trigger $parts.Triggers `
    -Principal $parts.Principal -Settings $parts.Settings -Force `
    -Description 'MediaOS PROD: bat lai Docker Desktop neu Explorer bo lo muc Run (13/10, 16/10/2026). Logon+90s va moi 5 phut. Khong kill.' | Out-Null
} catch {
  $m = $_.Exception.Message
  if ($m -match 'denied|0x80070005') {
    Write-Error ('Bi tu choi quyen khi dang ky. Mo PowerShell bang "Run as administrator" roi chay lai. Chi tiet: ' + $m)
  } else {
    Write-Error ('Dang ky that bai: ' + $m)
  }
  exit 1
}
Write-Host ('Da dang ky ' + $TaskName + '. Chay thu mot lan...')
Confirm-Registered
exit 0
