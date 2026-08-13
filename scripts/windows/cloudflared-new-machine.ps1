# cloudflared-new-machine.ps1 — dựng Cloudflare Tunnel cho MỘT hostname trên MỘT MÁY MỚI.
#
#   File ĐỨNG MỘT MÌNH: copy nguyên file này sang máy mới rồi chạy, KHÔNG cần repo MediaOS.
#   Chạy KHÔNG tham số  → hiện GIAO DIỆN (ô nhập tên miền/cổng/…), có nút Kiểm tra và nút Cài đặt.
#   Chạy CÓ tham số     → chế độ dòng lệnh, không giao diện (dùng cho tự động hoá).
#
#   Tự xin quyền Administrator (KHÔNG dùng #requires — dòng đó làm PowerShell từ chối NẠP file khi
#   cửa sổ chưa elevated; đã cắn một lần với social-domain.ps1).
#
#   Hai chế độ dựng tunnel:
#     A) có Token dashboard → tunnel quản-lý-từ-dashboard. Không đụng config.yml. Đơn giản nhất.
#     B) không Token        → tunnel local-config: tạo tunnel + config.yml + DNS + Windows service.
#
#   BẤT BIẾN: KHÔNG BAO GIỜ copy credentials/tunnel-id của máy PROD sang máy này. Cùng một tunnel id
#   chạy ở 2 máy = Cloudflare coi là replica HA và chia request NGẪU NHIÊN → api./dangfb. PROD sẽ lúc
#   được lúc 502. Script vì vậy tạo tunnel RIÊNG và từ chối ghi đè config nhiều-hostname (trừ -Force).
param(
  [string]$Hostname,                                    # vd tuan.funtimemediacorp.com
  [int]$Port,                                           # cổng app đang nghe trên MÁY NÀY
  [string]$TunnelName,                                  # mặc định: <label đầu>-<tên máy>
  [string]$Token,                                       # có → chế độ A (dashboard)
  [string]$ConfigPath = "C:\ProgramData\cloudflared\config.yml",
  [switch]$PreserveHostHeader,                          # gửi Host thật thay vì localhost:<Port>
  [switch]$DryRun,
  [switch]$Force,
  [switch]$Gui,                                         # ép mở giao diện
  [switch]$NoElevate                                    # chỉ để XEM TRƯỚC giao diện — không cài được gì
)

# cloudflared ghi cảnh báo (version outdated…) ra stderr. Với ErrorActionPreference=Stop thì PS 5.1
# biến MỌI dòng stderr của native exe thành lỗi TERMINATING → script chết oan dù việc đã xong.
$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok  ([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Write-Err ([string]$m) { Write-Host "  [X]  $m" -ForegroundColor Red }
function Write-NoBom([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}
function Test-IsAdmin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

# ═════════════════════════════════════════════════════════════════════════════════════════════════
#  GIAO DIỆN
# ═════════════════════════════════════════════════════════════════════════════════════════════════
function Show-InstallerGui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form                 = New-Object System.Windows.Forms.Form
  $form.Text            = "Cài Cloudflare Tunnel — máy $env:COMPUTERNAME"
  $form.Size            = New-Object System.Drawing.Size(760, 700)
  $form.StartPosition   = "CenterScreen"
  $form.Font            = New-Object System.Drawing.Font("Segoe UI", 9)
  $form.MinimumSize     = New-Object System.Drawing.Size(700, 600)

  function New-Label([string]$t, [int]$x, [int]$y, [int]$w) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $t; $l.Location = New-Object System.Drawing.Point($x, $y)
    $l.Size = New-Object System.Drawing.Size($w, 20)
    return $l
  }
  function New-Box([int]$x, [int]$y, [int]$w) {
    $b = New-Object System.Windows.Forms.TextBox
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, 24)
    $b.Anchor = "Top,Left,Right"
    return $b
  }

  $form.Controls.Add((New-Label "Tên miền đầy đủ (hostname)" 16 16 260))
  $txtHost = New-Box 16 38 420
  $txtHost.Text = $Hostname
  $form.Controls.Add($txtHost)
  $lblHostHint = New-Label "vd: tuan.funtimemediacorp.com" 450 41 270
  $lblHostHint.ForeColor = [System.Drawing.Color]::Gray
  $form.Controls.Add($lblHostHint)

  $form.Controls.Add((New-Label "Cổng ứng dụng trên máy này" 16 74 260))
  $txtPort = New-Box 16 96 120
  if ($Port -gt 0) { $txtPort.Text = "$Port" }
  $txtPort.Anchor = "Top,Left"
  $form.Controls.Add($txtPort)
  $lblPortHint = New-Label "app phải đang nghe ở http://localhost:<cổng>" 150 99 400
  $lblPortHint.ForeColor = [System.Drawing.Color]::Gray
  $form.Controls.Add($lblPortHint)

  $form.Controls.Add((New-Label "Tên tunnel (để trống = tự đặt theo tên máy)" 16 132 320))
  $txtTunnel = New-Box 16 154 420
  $txtTunnel.Text = $TunnelName
  $form.Controls.Add($txtTunnel)

  $grp          = New-Object System.Windows.Forms.GroupBox
  $grp.Text     = "Cách dựng tunnel"
  $grp.Location = New-Object System.Drawing.Point(16, 190)
  $grp.Size     = New-Object System.Drawing.Size(706, 118)
  $grp.Anchor   = "Top,Left,Right"

  $rbLocal          = New-Object System.Windows.Forms.RadioButton
  $rbLocal.Text     = "Tự tạo tunnel trên máy này (mở trình duyệt 1 lần để uỷ quyền tên miền)"
  $rbLocal.Location = New-Object System.Drawing.Point(14, 24)
  $rbLocal.Size     = New-Object System.Drawing.Size(670, 22)
  $rbLocal.Checked  = $true
  $grp.Controls.Add($rbLocal)

  $rbToken          = New-Object System.Windows.Forms.RadioButton
  $rbToken.Text     = "Dùng token có sẵn từ Cloudflare Zero Trust dashboard"
  $rbToken.Location = New-Object System.Drawing.Point(14, 50)
  $rbToken.Size     = New-Object System.Drawing.Size(670, 22)
  $grp.Controls.Add($rbToken)

  $txtToken          = New-Object System.Windows.Forms.TextBox
  $txtToken.Location = New-Object System.Drawing.Point(34, 76)
  $txtToken.Size     = New-Object System.Drawing.Size(650, 24)
  $txtToken.Anchor   = "Top,Left,Right"
  $txtToken.Enabled  = $false
  $txtToken.Text     = $Token
  $grp.Controls.Add($txtToken)
  $form.Controls.Add($grp)

  $rbToken.Add_CheckedChanged({ $txtToken.Enabled = $rbToken.Checked })

  $chkHost          = New-Object System.Windows.Forms.CheckBox
  $chkHost.Text     = "Giữ nguyên Host thật (httpHostHeader) — bật nếu app tự dựng URL tuyệt đối"
  $chkHost.Location = New-Object System.Drawing.Point(16, 318)
  $chkHost.Size     = New-Object System.Drawing.Size(700, 22)
  $chkHost.Checked  = [bool]$PreserveHostHeader
  $form.Controls.Add($chkHost)

  $chkForce          = New-Object System.Windows.Forms.CheckBox
  $chkForce.Text     = "Force — cho phép ghi đè cấu hình đang phục vụ nhiều tên miền (NGUY HIỂM)"
  $chkForce.Location = New-Object System.Drawing.Point(16, 342)
  $chkForce.Size     = New-Object System.Drawing.Size(700, 22)
  $chkForce.ForeColor = [System.Drawing.Color]::Firebrick
  $form.Controls.Add($chkForce)

  $btnDry             = New-Object System.Windows.Forms.Button
  $btnDry.Text        = "Kiểm tra (không thay đổi gì)"
  $btnDry.Location    = New-Object System.Drawing.Point(16, 376)
  $btnDry.Size        = New-Object System.Drawing.Size(220, 34)
  $form.Controls.Add($btnDry)

  $btnRun             = New-Object System.Windows.Forms.Button
  $btnRun.Text        = "CÀI ĐẶT"
  $btnRun.Location    = New-Object System.Drawing.Point(246, 376)
  $btnRun.Size        = New-Object System.Drawing.Size(150, 34)
  $btnRun.BackColor   = [System.Drawing.Color]::FromArgb(0, 120, 212)
  $btnRun.ForeColor   = [System.Drawing.Color]::White
  $btnRun.FlatStyle   = "Flat"
  $form.Controls.Add($btnRun)

  $lblStatus           = New-Label "Sẵn sàng." 410 384 310
  $lblStatus.Anchor    = "Top,Left,Right"
  $form.Controls.Add($lblStatus)

  $log            = New-Object System.Windows.Forms.TextBox
  $log.Location   = New-Object System.Drawing.Point(16, 420)
  $log.Size       = New-Object System.Drawing.Size(706, 226)
  $log.Multiline  = $true
  $log.ScrollBars = "Vertical"
  $log.ReadOnly   = $true
  $log.BackColor  = [System.Drawing.Color]::FromArgb(24, 24, 24)
  $log.ForeColor  = [System.Drawing.Color]::Gainsboro
  $log.Font       = New-Object System.Drawing.Font("Consolas", 9)
  $log.Anchor     = "Top,Bottom,Left,Right"
  $form.Controls.Add($log)

  $appendLog = {
    param([string]$line)
    $log.AppendText($line + "`r`n")
  }

  # Chạy CHÍNH file này ở tiến trình con rồi bơm stdout vào ô log. Tiến trình con thừa kế quyền
  # admin của giao diện (giao diện đã elevate ở dưới) nên không hỏi UAC lần nữa.
  $runChild = {
    param([bool]$dry)
    $log.Clear()
    $h = $txtHost.Text.Trim()
    $p = 0
    [void][int]::TryParse($txtPort.Text.Trim(), [ref]$p)
    if (-not $h) { $lblStatus.Text = "Thiếu tên miền."; return }
    if ($p -le 0 -or $p -gt 65535) { $lblStatus.Text = "Cổng không hợp lệ."; return }

    # KHÔNG đặt tên biến là $args — đó là biến tự động của PowerShell.
    $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
                "-Hostname", "`"$h`"", "-Port", "$p", "-ConfigPath", "`"$ConfigPath`"")
    if ($txtTunnel.Text.Trim()) { $psArgs += @("-TunnelName", "`"$($txtTunnel.Text.Trim())`"") }
    if ($chkHost.Checked)  { $psArgs += "-PreserveHostHeader" }
    if ($chkForce.Checked) { $psArgs += "-Force" }
    if ($dry)              { $psArgs += "-DryRun" }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = (Join-Path $PSHOME "powershell.exe")
    $psi.Arguments              = ($args -join " ")
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8
    # Token đi bằng BIẾN MÔI TRƯỜNG của riêng tiến trình con, KHÔNG qua dòng lệnh: command line của
    # một process là thứ mọi process khác trên máy đọc được (Task Manager / WMI) — token sẽ lộ.
    if ($rbToken.Checked -and $txtToken.Text.Trim()) {
      $psi.EnvironmentVariables["CFTUNNEL_TOKEN"] = $txtToken.Text.Trim()
    }

    $btnRun.Enabled = $false; $btnDry.Enabled = $false
    if ($dry) { $lblStatus.Text = "Đang kiểm tra ..." } else { $lblStatus.Text = "Đang cài ..." }
    $lblStatus.ForeColor = [System.Drawing.Color]::DarkGoldenrod
    [System.Windows.Forms.Application]::DoEvents()

    $proc = [System.Diagnostics.Process]::Start($psi)
    # Đọc đồng bộ + DoEvents: giữ giao diện phản hồi mà không cần runspace (PS 5.1 cho phép).
    while (-not $proc.StandardOutput.EndOfStream) {
      & $appendLog $proc.StandardOutput.ReadLine()
      [System.Windows.Forms.Application]::DoEvents()
    }
    $err = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    if ($err) { & $appendLog "--- stderr ---"; & $appendLog $err }

    $btnRun.Enabled = $true; $btnDry.Enabled = $true
    if ($proc.ExitCode -eq 0) {
      if ($dry) { $lblStatus.Text = "Kiểm tra xong — chưa thay đổi gì." } else { $lblStatus.Text = "XONG (exit 0)." }
      $lblStatus.ForeColor = [System.Drawing.Color]::ForestGreen
    } else {
      $lblStatus.Text = "THẤT BẠI (exit $($proc.ExitCode)) — đọc log."
      $lblStatus.ForeColor = [System.Drawing.Color]::Firebrick
    }
  }

  $btnDry.Add_Click({ & $runChild $true })
  $btnRun.Add_Click({
    $h = $txtHost.Text.Trim()
    $ans = [System.Windows.Forms.MessageBox]::Show(
      "Sẽ cài Cloudflare Tunnel cho:`n`n    https://$h  →  http://localhost:$($txtPort.Text)`n`nTiếp tục?",
      "Xác nhận", "YesNo", "Question")
    if ($ans -eq "Yes") { & $runChild $false }
  })

  & $appendLog "Máy: $env:COMPUTERNAME   ·   config: $ConfigPath"
  & $appendLog "Bấm 'Kiểm tra' trước — nó in đúng những gì SẼ làm mà không đổi gì trên máy."
  [void]$form.ShowDialog()
}

# ── 0. Không tham số → giao diện. Elevate TRƯỚC để tiến trình con thừa kế quyền. ──────────────────
$wantGui = ($Gui -or (-not $Hostname) -or ($Port -le 0))
if (-not (Test-IsAdmin) -and -not $NoElevate) {
  $a = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  if ($wantGui) {
    $a = "-WindowStyle Hidden " + $a + " -Gui"
    if ($Hostname) { $a += " -Hostname `"$Hostname`"" }
    if ($Port -gt 0) { $a += " -Port $Port" }
  } else {
    $a = "-NoExit " + $a + " -Hostname `"$Hostname`" -Port $Port"
    if ($TunnelName)         { $a += " -TunnelName `"$TunnelName`"" }
    if ($Token)              { $a += " -Token `"$Token`"" }
    if ($PreserveHostHeader) { $a += " -PreserveHostHeader" }
    if ($DryRun)             { $a += " -DryRun" }
    if ($Force)              { $a += " -Force" }
  }
  if ($ConfigPath) { $a += " -ConfigPath `"$ConfigPath`"" }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $a
  exit 0
}
if ($wantGui) { Show-InstallerGui; exit 0 }

# ═════════════════════════════════════════════════════════════════════════════════════════════════
#  LÕI (dòng lệnh) — giao diện gọi lại chính file này với tham số đầy đủ
# ═════════════════════════════════════════════════════════════════════════════════════════════════
Write-Step "Cloudflare Tunnel → $Hostname (localhost:$Port) trên máy $env:COMPUTERNAME"
if ($DryRun) { Write-Warn "DRY-RUN: chỉ in kế hoạch, KHÔNG thay đổi gì." }

# Ưu tiên token qua biến môi trường (giao diện truyền kiểu này) hơn tham số -Token: tham số dòng lệnh
# hiện trong danh sách tiến trình của MỌI user trên máy.
if (-not $Token -and $env:CFTUNNEL_TOKEN) { $Token = $env:CFTUNNEL_TOKEN; Write-Host "  token: đọc từ CFTUNNEL_TOKEN" }

# ── 1. Kiểm tham số ──────────────────────────────────────────────────────────────────────────────
if ($Hostname -notmatch '^[a-z0-9\-]+(\.[a-z0-9\-]+)+$') { Write-Err "Hostname không hợp lệ: $Hostname"; exit 1 }
if ($Port -lt 1 -or $Port -gt 65535)                     { Write-Err "Port không hợp lệ: $Port"; exit 1 }
if ($Hostname -match 'funtimediacorp\.com$') {
  Write-Warn "Zone của công ty là 'funtimemediacorp.com' (có 'me'). '$Hostname' có thể là lỗi gõ."
  if (-not $Force) { Write-Err "Sửa lại tên miền, hoặc bật Force nếu zone này thật sự tồn tại."; exit 1 }
}
$labels = $Hostname.Split('.')
$zone   = ($labels[($labels.Count - 2)..($labels.Count - 1)]) -join '.'
if (-not $TunnelName) { $TunnelName = "$($labels[0])-$($env:COMPUTERNAME.ToLower())" }
Write-Host "  zone=$zone · tunnel=$TunnelName · config=$ConfigPath"

# ── 2. Chặn chạy nhầm trên máy PROD + đọc tunnel đang dùng ───────────────────────────────────────
# Máy PROD có config.yml phục vụ 9 hostname. Ghi đè = sập toàn bộ api./train./dangfb./cian-dev*.
$existingTid = $null
if (Test-Path $ConfigPath) {
  $existing  = @(Get-Content -Path $ConfigPath)
  $tl = $existing | Where-Object { $_ -match '^\s*tunnel:\s*(\S+)' } | Select-Object -First 1
  if ($tl -and $tl -match '^\s*tunnel:\s*(\S+)') { $existingTid = $Matches[1] }
  $hostCount = @($existing | Where-Object { $_ -match '^\s*-\s*hostname:' }).Count
  $hasMine   = @($existing | Where-Object { $_ -match ("^\s*-\s*hostname:\s*" + [regex]::Escape($Hostname) + "\s*$") }).Count -gt 0
  if ($hostCount -gt 1 -and -not $hasMine -and -not $Force) {
    Write-Err "$ConfigPath đang phục vụ $hostCount hostname — đây trông như MÁY PROD, không phải máy mới."
    Write-Err "Dừng lại để không làm sập các hostname đang chạy. Chắc chắn thì bật Force."
    exit 1
  }
}

# ── 3. Cài cloudflared ───────────────────────────────────────────────────────────────────────────
function Get-CloudflaredPath {
  $c = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}
$cf = Get-CloudflaredPath
if (-not $cf) {
  if ($DryRun) { Write-Host "  [dry] winget install Cloudflare.cloudflared" }
  else {
    Write-Host "  cài cloudflared ..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Null
    }
    $cf = Get-CloudflaredPath
    if (-not $cf) {
      # winget vắng hoặc hỏng → MSI chính chủ.
      $msi = Join-Path $env:TEMP "cloudflared.msi"
      Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi" -OutFile $msi -UseBasicParsing
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
      $cf = Get-CloudflaredPath
    }
  }
}
if (-not $cf -and -not $DryRun) { Write-Err "Không cài được cloudflared."; exit 1 }
if ($cf) { Write-Ok "cloudflared: $cf"; & $cf --version }

# ── 4A. Chế độ dashboard (token) ─────────────────────────────────────────────────────────────────
if ($Token) {
  Write-Step "Chế độ A — tunnel quản lý từ dashboard"
  if ($DryRun) {
    Write-Host "  [dry] cloudflared service install <TOKEN>"
    Write-Host "  [dry] rồi thêm Public Hostname trên dashboard: $Hostname → http://localhost:$Port"
    exit 0
  }
  if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
    Write-Warn "Service cloudflared đã tồn tại → gỡ trước khi cài lại bằng token."
    & $cf service uninstall | Out-Null
    Start-Sleep -Seconds 2
  }
  & $cf service install $Token
  if ($LASTEXITCODE -ne 0) { Write-Err "service install thất bại (exit $LASTEXITCODE) — token sai/hết hạn?"; exit 1 }
  Start-Service cloudflared -ErrorAction SilentlyContinue
  Write-Ok "Connector đã chạy. CÒN MỘT BƯỚC TRÊN DASHBOARD:"
  Write-Host "    Zero Trust > Networks > Tunnels > $TunnelName > Public Hostname > Add"
  Write-Host "      Subdomain=$($labels[0]) · Domain=$zone · Type=HTTP · URL=localhost:$Port"
  Write-Host "    (DNS CNAME do Cloudflare tự tạo khi Save.)"
  exit 0
}

# ── 4B. Chế độ local-config ──────────────────────────────────────────────────────────────────────
Write-Step "Chế độ B — tunnel local-config"
$userCf = Join-Path $env:USERPROFILE ".cloudflared"

# 4B.1 cert.pem (uỷ quyền zone) — TƯƠNG TÁC: mở trình duyệt.
if (-not (Test-Path (Join-Path $userCf "cert.pem"))) {
  if ($DryRun) { Write-Host "  [dry] cloudflared tunnel login  (mở trình duyệt, chọn zone $zone)" }
  else {
    Write-Warn "Mở trình duyệt — chọn zone $zone để uỷ quyền (nếu không tự mở, dùng link in ra dưới) ..."
    & $cf tunnel login
    if (-not (Test-Path (Join-Path $userCf "cert.pem"))) { Write-Err "Chưa có cert.pem — login chưa xong."; exit 1 }
  }
}

# 4B.2 tunnel: config có sẵn thì DÙNG LẠI tunnel của nó; không thì dùng theo tên; không nữa thì tạo mới.
#   Tạo tunnel mới trong khi config vẫn chạy tunnel cũ = DNS trỏ tới tunnel KHÔNG AI CHẠY → 1033 câm.
$tid = $null
$tunnelExplicit = ($PSBoundParameters.ContainsKey('TunnelName') -and $TunnelName)
if (-not $DryRun) {
  $listJson = & $cf tunnel list --output json
  $list = $null
  if ($listJson) { $list = ($listJson | ConvertFrom-Json) }
  if ($existingTid -and -not $tunnelExplicit) {
    $tid = $existingTid
    if ($list) {
      $n = ($list | Where-Object { $_.id -eq $existingTid } | Select-Object -First 1).name
      if ($n) { $TunnelName = $n }
    }
    Write-Warn "$ConfigPath đã trỏ tunnel $tid ($TunnelName) → DÙNG LẠI, không tạo tunnel mới."
  }
  if (-not $tid -and $list) {
    $tid = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id
  }
  if ($tid) { Write-Warn "Tunnel '$TunnelName' đã có → dùng lại (id=$tid)" }
  else {
    & $cf tunnel create $TunnelName | Out-Null
    $listJson = & $cf tunnel list --output json
    if ($listJson) {
      $list = ($listJson | ConvertFrom-Json)
      $tid  = ($list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id
    }
  }
  if (-not $tid) { Write-Err "Không lấy được tunnel id."; exit 1 }
  Write-Ok "Tunnel id = $tid"
} else {
  if ($existingTid -and -not $tunnelExplicit) {
    $tid = $existingTid
    Write-Host "  [dry] dùng lại tunnel đang có trong config: $tid (không tạo mới)"
  } else {
    Write-Host "  [dry] cloudflared tunnel create $TunnelName"
    $tid = "<UUID>"
  }
}

# 4B.3 credentials → cạnh config (service chạy LocalSystem, $HOME của nó KHÁC $env:USERPROFILE).
$cfgDir  = Split-Path -Parent $ConfigPath
$credDst = Join-Path $cfgDir "$tid.json"
if (-not $DryRun) {
  $credSrc = Join-Path $userCf "$tid.json"
  if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null }
  if (Test-Path $credDst) {
    Write-Ok "Credentials đã có: $credDst"          # ca dùng lại tunnel — file nằm sẵn cạnh config
  } elseif (Test-Path $credSrc) {
    Copy-Item $credSrc $credDst -Force
    Write-Ok "Credentials → $credDst"
  } else {
    Write-Err "Không thấy credentials cho tunnel $tid (đã tìm $credSrc và $credDst)."; exit 1
  }
  Copy-Item (Join-Path $userCf "cert.pem") $cfgDir -Force -ErrorAction SilentlyContinue
}

# 4B.4 config.yml — backup trước, validate sau, khôi phục ngay nếu validate đỏ.
$originReq = ""
if ($PreserveHostHeader) { $originReq = "`n    originRequest:`n      httpHostHeader: $Hostname" }
$backup = $null
if (Test-Path $ConfigPath) {
  $lines   = @(Get-Content -Path $ConfigPath)
  $tunLine = $lines | Where-Object { $_ -match '^\s*tunnel:\s*(\S+)' } | Select-Object -First 1
  $curTid  = $null
  if ($tunLine -and $tunLine -match '^\s*tunnel:\s*(\S+)') { $curTid = $Matches[1] }
  if ($curTid -and $curTid -ne $tid -and -not $Force) {
    Write-Err "$ConfigPath đang trỏ tunnel khác ($curTid ≠ $tid). Dừng — bật Force nếu cố ý thay."
    exit 1
  }
  # Vá theo DÒNG: sửa cổng nếu hostname đã có, không thì chèn TRƯỚC quy tắc bắt-tất-cả.
  # Đặt SAU http_status:404 thì rule mới không bao giờ được đọc tới.
  $out  = New-Object System.Collections.ArrayList
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]
    if ($l -match ("^\s*-\s*hostname:\s*" + [regex]::Escape($Hostname) + "\s*$")) {
      [void]$out.Add("  - hostname: $Hostname")
      [void]$out.Add("    service: http://localhost:$Port")
      if ($PreserveHostHeader) { [void]$out.Add("    originRequest:"); [void]$out.Add("      httpHostHeader: $Hostname") }
      $i++
      while ($i -lt $lines.Count -and $lines[$i] -notmatch '^\s*-\s') { $i++ }   # nuốt phần thân rule cũ
      $i--
      $done = $true
      continue
    }
    if (-not $done -and $l -match '^\s*-\s*service:\s*http_status:') {
      [void]$out.Add("  - hostname: $Hostname")
      [void]$out.Add("    service: http://localhost:$Port")
      if ($PreserveHostHeader) { [void]$out.Add("    originRequest:"); [void]$out.Add("      httpHostHeader: $Hostname") }
      $done = $true
    }
    [void]$out.Add($l)
  }
  if (-not $done) {
    [void]$out.Add("  - hostname: $Hostname")
    [void]$out.Add("    service: http://localhost:$Port")
    if ($PreserveHostHeader) { [void]$out.Add("    originRequest:"); [void]$out.Add("      httpHostHeader: $Hostname") }
    [void]$out.Add("  - service: http_status:404")
  }
  $content = ($out -join "`n") + "`n"
  $backup  = "$ConfigPath.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  if ($DryRun) { Write-Host "  [dry] vá $ConfigPath (backup $backup):"; Write-Host $content }
  else { Copy-Item $ConfigPath $backup -Force; Write-NoBom $ConfigPath $content; Write-Ok "Đã vá config (backup: $backup)" }
} else {
  $content = @"
tunnel: $tid
credentials-file: $credDst
ingress:
  - hostname: $Hostname
    service: http://localhost:$Port$originReq
  - service: http_status:404
"@
  if ($DryRun) { Write-Host "  [dry] tạo $ConfigPath :"; Write-Host $content }
  else { Write-NoBom $ConfigPath $content; Write-Ok "Đã tạo $ConfigPath" }
}

# 4B.5 HAI phép kiểm, không phải một: validate = cú pháp; ingress rule = hostname map ĐÚNG cổng.
if (-not $DryRun) {
  & $cf tunnel --config $ConfigPath ingress validate
  $validateOk = ($LASTEXITCODE -eq 0)
  $ruleOut = ""
  if ($validateOk) { $ruleOut = (& $cf tunnel --config $ConfigPath ingress rule "https://$Hostname/") -join "`n" }
  $ruleOk = ($validateOk -and $ruleOut -match [regex]::Escape("http://localhost:$Port"))
  if (-not $ruleOk) {
    Write-Err "Config KHÔNG đạt (validate=$validateOk, rule khớp cổng=$ruleOk)."
    Write-Host $ruleOut
    if ($backup) { Copy-Item $backup $ConfigPath -Force; Write-Warn "Đã khôi phục $backup — service KHÔNG restart." }
    exit 1
  }
  Write-Ok "validate + ingress rule: $Hostname → http://localhost:$Port"
}

# 4B.6 DNS CNAME
if ($DryRun) { Write-Host "  [dry] cloudflared tunnel route dns $TunnelName $Hostname" }
else {
  & $cf tunnel route dns $TunnelName $Hostname
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "route dns không tạo được — thường vì bản ghi '$($labels[0])' ĐÃ tồn tại."
    Write-Warn "Kiểm tay trên dashboard: CNAME $Hostname → $tid.cfargotunnel.com (Proxied/cam)."
  } else { Write-Ok "DNS: $Hostname → $tid.cfargotunnel.com" }
}

# 4B.7 service
if ($DryRun) { Write-Host "  [dry] cloudflared --config $ConfigPath service install; Start-Service cloudflared"; exit 0 }
if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Restart-Service cloudflared
  Write-Ok "Đã restart service cloudflared"
} else {
  & $cf --config $ConfigPath service install
  if ($LASTEXITCODE -ne 0) { Write-Err "service install thất bại (exit $LASTEXITCODE)"; exit 1 }
  Start-Service cloudflared
  Write-Ok "Đã cài + chạy service cloudflared (--config $ConfigPath)"
}

# ── 5. Nghiệm thu — "service Running" KHÔNG phải bằng chứng ───────────────────────────────────────
Write-Step "Nghiệm thu"
$localUp = $false
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect("127.0.0.1", $Port)
  $localUp = $tcp.Connected
  $tcp.Close()
} catch { $localUp = $false }
if ($localUp) { Write-Ok "localhost:$Port đang nghe" }
else { Write-Warn "localhost:$Port KHÔNG ai nghe → qua domain sẽ ra 502. Bật app rồi đo lại." }

$code = 0
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 4
  try {
    $r = Invoke-WebRequest "https://$Hostname/" -UseBasicParsing -TimeoutSec 8 -MaximumRedirection 0
    $code = [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode.value__ } else { $code = 0 }
  }
  if ($code -ne 0) { break }
}
switch ($code) {
  0       { Write-Warn "Không phản hồi → DNS chưa lan truyền, hoặc tunnel/connector chưa lên. Xem: cloudflared tunnel info $TunnelName" }
  404     { Write-Warn "404 → DNS+tunnel ĐÃ tới nơi nhưng rơi vào http_status:404 (thiếu/sai ingress rule) — HOẶC app thật sự trả 404 ở '/'." }
  502     { Write-Warn "502 → tunnel sống, app phía sau không trả lời ở cổng $Port." }
  default { Write-Ok "https://$Hostname/ → HTTP $code (tunnel thông)" }
}

Write-Host ""
Write-Host "Bẫy cần nhớ:" -ForegroundColor Yellow
Write-Host "  · Sau tunnel, app thấy Host = localhost:$Port. Đừng dựng URL công khai từ request.origin"
Write-Host "    (redirect nội bộ dùng Location TƯƠNG ĐỐI; base URL/OAuth redirect_uri lấy từ biến môi trường)."
Write-Host "    Hoặc bật ô 'Giữ nguyên Host thật' để cloudflared gửi Host thật."
Write-Host "  · Trần upload ~100MB của Cloudflare áp lên đường này."
Write-Host "  · Đổi cổng/thêm hostname: chạy lại chính script này (tự vá config + validate + restart)."
