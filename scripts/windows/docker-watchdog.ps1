<#
.SYNOPSIS
  Canh Docker Desktop trên máy PROD (NASHP). Engine im + không có tiến trình «Docker Desktop»
  ⇒ bật lại Docker Desktop. Tiến trình còn mà engine im quá lâu ⇒ CHỈ ghi log, không diệt gì.

.DESCRIPTION
  VÌ SAO CẦN (đo 16/10/2026): Docker Desktop chỉ được bật qua mục HKCU\...\Run, mà mục Run do
  explorer.exe chạy. Explorer đã hai lần bỏ lỡ nó:
    - 13/10 15:49: explorer.exe bị treo và bị Windows đóng (Application Hang 1002 lúc 15:49:39,
      15:49:48). Explorer mới chỉ chạy RunOnce, bỏ qua Run cho CẢ phiên ⇒ không có Docker ~17 giờ.
    - 16/10 00:04: sau Windows Update, Explorer chưa vào pha PostStartTasks thì tác vụ khoá màn
      hình đã khoá (00:04:34) ⇒ Explorer hoãn mọi startup app tới lần mở khoá đầu (07:40:47).
  Task Scheduler chạy độc lập với Explorer và chạy cả khi màn hình đang khoá ⇒ đặt việc bật
  Docker vào một tác vụ lịch (logon + mỗi 5 phút) thay vì trông vào Explorer.

  Quy tắc:
    1. Có file cờ  <thư mục log>\docker-watchdog.pause  ⇒ bỏ qua (owner đang bảo trì Docker).
    2. `docker info` trả về ServerVersion trong hạn ⇒ im lặng, thoát 0.
    3. Engine im VÀ không có tiến trình «Docker Desktop» trong phiên này ⇒ Start-Process Docker
       Desktop, ghi 1 dòng [ACTION].
    4. Engine im NHƯNG tiến trình còn ⇒ đếm thời gian; quá -StuckMinutes thì ghi [WARN]
       (lặp lại tối đa mỗi 60 phút), thoát 2. KHÔNG kill.
  Chỉ ghi log khi có hành động hoặc lỗi. Không đọc .env, không in secret.

  MÃ THOÁT (để LastTaskResult của Task Scheduler là tín hiệu thật):
    0 = ổn / đã bật Docker Desktop   1 = lỗi script
    2 = Docker Desktop còn chạy nhưng engine im quá ngưỡng   3 = không bật được Docker Desktop

  Tương thích Windows PowerShell 5.1. File phải lưu UTF-8 CÓ BOM (có tiếng Việt).

.EXAMPLE
  powershell -NoProfile -File docker-watchdog.ps1 -DryRun
  powershell -NoProfile -File docker-watchdog.ps1 -DryRun -SimulateEngineDown -SimulateNoProcess
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [int]$StuckMinutes = 10,
  [int]$InfoTimeoutSec = 20,
  [string]$LogPath = 'C:\dev 2\MediaOS\logs\docker-watchdog.log',
  [string]$DockerDesktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe',
  [string]$DockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
  # Chỉ để diễn tập nhánh quyết định, BẮT BUỘC đi kèm -DryRun.
  [switch]$SimulateEngineDown,
  [switch]$SimulateNoProcess
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$EXIT_OK = 0
$EXIT_SCRIPT_ERROR = 1
$EXIT_ENGINE_STUCK = 2
$EXIT_START_FAILED = 3
$LOG_MAX_BYTES = 1MB
$STUCK_REPEAT_MINUTES = 60
$DETAIL_MAX_CHARS = 160

$logDir = Split-Path -Parent $LogPath
$statePath = Join-Path $logDir 'docker-watchdog.state'
$pausePath = Join-Path $logDir 'docker-watchdog.pause'

function Write-WatchdogLine {
  param([string]$Level, [string]$Message)
  $line = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') + ' [' + $Level + '] ' + $Message
  if ($DryRun) {
    Write-Host ('DRYRUN se ghi log: ' + $line)
    return
  }
  if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
  if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt $LOG_MAX_BYTES)) {
    Move-Item -LiteralPath $LogPath -Destination ($LogPath + '.1') -Force
  }
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-ShortText {
  param([string]$Text)
  if ($null -eq $Text) { return '' }
  $one = ($Text -replace '\s+', ' ').Trim()
  if ($one.Length -gt $DETAIL_MAX_CHARS) { $one = $one.Substring(0, $DETAIL_MAX_CHARS) }
  return $one
}

# Gọi `docker info` có hạn giờ. Trả object { Responds; Detail }.
function Test-DockerEngine {
  if ($SimulateEngineDown) {
    return New-Object PSObject -Property @{ Responds = $false; Detail = 'simulated: engine down' }
  }
  if (-not (Test-Path -LiteralPath $DockerCli)) {
    return New-Object PSObject -Property @{ Responds = $false; Detail = ('docker CLI not found: ' + $DockerCli) }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $DockerCli
  $psi.Arguments = 'info --format "{{.ServerVersion}}"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit($InfoTimeoutSec * 1000)) {
    # Chỉ dừng ĐÚNG tiến trình docker.exe do script này tạo (theo handle, không theo tên ảnh),
    # để các lần chạy 5 phút/lần không dồn tiến trình treo.
    $killNote = 'killed own docker CLI child'
    try { if (-not $proc.HasExited) { $proc.Kill() } }
    catch { $killNote = 'could not kill own docker CLI child: ' + $_.Exception.Message }
    return New-Object PSObject -Property @{ Responds = $false; Detail = ('docker info timeout ' + $InfoTimeoutSec + 's; ' + $killNote) }
  }
  $proc.WaitForExit()
  $version = Get-ShortText $outTask.Result
  if ($proc.ExitCode -eq 0 -and $version.Length -gt 0) {
    return New-Object PSObject -Property @{ Responds = $true; Detail = ('ServerVersion ' + $version) }
  }
  $err = Get-ShortText $errTask.Result
  return New-Object PSObject -Property @{ Responds = $false; Detail = ('docker info exit ' + $proc.ExitCode + ': ' + $err) }
}

function Get-DockerDesktopProcess {
  if ($SimulateNoProcess) { return @() }
  $mySession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  return @(Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySession })
}

# File trạng thái 3 dòng: (1) mốc thấy engine im đầu tiên  (2) mốc WARN gần nhất hoặc '-'
# (3) lý do: 'started' (watchdog đã bật Docker) | 'observed' (chỉ quan sát).
function Read-WatchdogState {
  $empty = New-Object PSObject -Property @{ Since = $null; LastWarn = $null; Reason = '' }
  if (-not (Test-Path -LiteralPath $statePath)) { return $empty }
  $lines = @(Get-Content -LiteralPath $statePath -TotalCount 3)
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $style = [Globalization.DateTimeStyles]::RoundtripKind
  $since = [datetime]::MinValue
  if ($lines.Count -lt 1 -or -not [datetime]::TryParse($lines[0], $culture, $style, [ref]$since)) { return $empty }
  $lastWarn = $null
  $parsedWarn = [datetime]::MinValue
  if ($lines.Count -ge 2 -and [datetime]::TryParse($lines[1], $culture, $style, [ref]$parsedWarn)) { $lastWarn = $parsedWarn }
  $reason = ''
  if ($lines.Count -ge 3) { $reason = $lines[2] }
  return New-Object PSObject -Property @{ Since = $since; LastWarn = $lastWarn; Reason = $reason }
}

function Save-WatchdogState {
  param([datetime]$Since, $LastWarn, [string]$Reason)
  if ($DryRun) { return }
  $warnText = '-'
  if ($null -ne $LastWarn) { $warnText = ([datetime]$LastWarn).ToString('o') }
  if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  Set-Content -LiteralPath $statePath -Value @($Since.ToString('o'), $warnText, $Reason) -Encoding ASCII
}

function Clear-WatchdogState {
  if ($DryRun) { return }
  if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
}

function Invoke-Watchdog {
  if (($SimulateEngineDown -or $SimulateNoProcess) -and -not $DryRun) {
    throw 'Simulate* chi duoc dung cung -DryRun'
  }
  if (Test-Path -LiteralPath $pausePath) {
    if ($DryRun) { Write-Host ('DRYRUN: co co tam dung ' + $pausePath + ' -> bo qua') }
    return $EXIT_OK
  }

  $now = Get-Date
  $probe = Test-DockerEngine
  $state = Read-WatchdogState

  if ($probe.Responds) {
    if ($null -ne $state.Since) {
      $wasNoteworthy = ($state.Reason -eq 'started') -or ($null -ne $state.LastWarn)
      if ($wasNoteworthy) {
        $mins = [math]::Round(($now - $state.Since).TotalMinutes, 1)
        Write-WatchdogLine 'RECOVERED' ('engine responds again (' + $probe.Detail + ') after ' + $mins + ' min')
      }
      Clear-WatchdogState
    }
    return $EXIT_OK
  }

  # @(...) bắt buộc: hàm trả mảng rỗng thì PowerShell «trải» thành $null, và $null.Count nổ
  # dưới StrictMode — đúng nhánh quan trọng nhất (bắt được khi chạy thử 16/10).
  $procs = @(Get-DockerDesktopProcess)
  if ($procs.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $DockerDesktopExe)) {
      Write-WatchdogLine 'ERROR' ('engine down (' + $probe.Detail + ') and Docker Desktop exe missing: ' + $DockerDesktopExe)
      return $EXIT_START_FAILED
    }
    if ($DryRun) {
      Write-Host ('DRYRUN se chay: Start-Process "' + $DockerDesktopExe + '"')
    } else {
      try {
        Start-Process -FilePath $DockerDesktopExe
      } catch {
        Write-WatchdogLine 'ERROR' ('engine down (' + $probe.Detail + '); Start-Process Docker Desktop failed: ' + (Get-ShortText $_.Exception.Message))
        return $EXIT_START_FAILED
      }
    }
    Write-WatchdogLine 'ACTION' ('engine down (' + $probe.Detail + ') and no Docker Desktop process -> started Docker Desktop')
    Save-WatchdogState -Since $now -LastWarn $null -Reason 'started'
    return $EXIT_OK
  }

  # Tiến trình còn, engine im: có thể đang khởi động. Lần đầu thấy thì chỉ ghi mốc, im lặng.
  if ($null -eq $state.Since) {
    if ($DryRun) { Write-Host ('DRYRUN: Docker Desktop dang chay (PID ' + $procs[0].Id + ') nhung engine im; ghi moc, chua bao') }
    Save-WatchdogState -Since $now -LastWarn $null -Reason 'observed'
    return $EXIT_OK
  }
  $stuckMins = ($now - $state.Since).TotalMinutes
  if ($stuckMins -lt $StuckMinutes) { return $EXIT_OK }

  $shouldWarn = ($null -eq $state.LastWarn) -or ((($now - $state.LastWarn).TotalMinutes) -ge $STUCK_REPEAT_MINUTES)
  if ($shouldWarn) {
    $pids = ($procs | ForEach-Object { $_.Id }) -join ','
    Write-WatchdogLine 'WARN' ('Docker Desktop running (PID ' + $pids + ') but engine not responding for ' + [math]::Round($stuckMins, 0) + ' min (' + $probe.Detail + '); not killing - needs a human')
    Save-WatchdogState -Since $state.Since -LastWarn $now -Reason $state.Reason
  }
  return $EXIT_ENGINE_STUCK
}

$exitCode = $EXIT_SCRIPT_ERROR
try {
  $exitCode = Invoke-Watchdog
} catch {
  $msg = Get-ShortText $_.Exception.Message
  try { Write-WatchdogLine 'ERROR' ('script error: ' + $msg) }
  catch { Write-Error ('docker-watchdog: script error: ' + $msg + ' (khong ghi duoc log: ' + $_.Exception.Message + ')') }
  $exitCode = $EXIT_SCRIPT_ERROR
}
# Thoát tường minh: không để mã của lệnh native cuối cùng thành mã thoát của tác vụ.
exit ([int]$exitCode)
