<#
.SYNOPSIS
  S10-AUTH-IPTRUST-1 - DO THAT header ma `cloudflared` dat khi request di tu Internet vao origin.

.DESCRIPTION
  WO cam suy gia tri `TRUST_PROXY` tu tai lieu Cloudflare: dat `trust proxy` rong hon thuc te
  bien "IP mu" (hien trang) thanh "IP GIA MAO DUOC" - te hon. Nen phai do truoc khi chon.

  Script dung mot echo server chi-nghe-localhost o cong rac, TAM tro mot hostname DA CO cua
  tunnel sang cong do, goi vao tu Internet, ghi lai header THO, roi hoan nguyen.

  KHONG tao DNS record moi. `cloudflared tunnel route dns` de lai CNAME vinh vien ma CLI khong
  xoa duoc (phai vao dashboard) - dung lai hostname san co thi hoan nguyen tron ven chi bang
  khoi phuc `config.yml`.

  KHONG cham code app va KHONG cham `dist/`. (apps/api `dist/` dung CHUNG giua PROD :3100 va
  dev-online :3200 - build lai de them route debug co the lam login PROD 500.)

.PARAMETER ReuseHost
  Hostname CO SAN trong config.yml se bi tro tam sang echo server. CHON MOT HOSTNAME DEV
  (vd cian-dev...) - hostname do ngung phuc vu trong vai giay khi do. TUYET DOI khong chon
  `api.` hay `dangfb.` (PROD).
  Bo trong -> script chi LIET KE hostname roi thoat, khong sua gi.

.PARAMETER Port
  Cong localhost cho echo server. Mac dinh 39997.

.EXAMPLE
  # Buoc 1 - xem co nhung hostname nao (khong sua gi):
  powershell -ExecutionPolicy Bypass -File scripts\windows\10-trust-proxy-probe.ps1

  # Buoc 2 - do that (chay As Administrator):
  powershell -ExecutionPolicy Bypass -File scripts\windows\10-trust-proxy-probe.ps1 -ReuseHost cian-dev.funtimemediacorp.com

.NOTES
  PHAI chay As Administrator: ghi C:\ProgramData\cloudflared\config.yml + Restart-Service.
  config.yml do phuc vu CA 8 hostname - sai file la sap het. Vi vay moi duong thoat cua script
  deu di qua khoi finally: khoi phuc backup -> validate -> restart.
#>
[CmdletBinding()]
param(
  [string]$ReuseHost = "",
  [int]$Port = 39997,
  [string]$ConfigPath = "C:\ProgramData\cloudflared\config.yml"
)

$ErrorActionPreference = "Stop"
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir  = Join-Path $PSScriptRoot "..\..\docs\DEVOPS\evidence"
$outFile = Join-Path $outDir "S10-AUTH-IPTRUST-1-headers-$stamp.txt"
$hdrDump = Join-Path $env:TEMP "iptrust-probe-headers-$stamp.json"

function Find-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "$env:ProgramData\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  throw "Khong tim thay cloudflared.exe"
}

if (-not (Test-Path $ConfigPath)) { throw "Khong thay $ConfigPath" }
$cf  = Find-Cloudflared
$raw = Get-Content $ConfigPath -Raw

# -- Liet ke hostname (che do xem, khong sua) ---------------------------------
$hostNames = [regex]::Matches($raw, '(?m)^\s*-?\s*hostname:\s*(\S+)') | ForEach-Object { $_.Groups[1].Value }
if (-not $ReuseHost) {
  Write-Host ""
  Write-Host "=== Hostname dang phuc vu boi $ConfigPath ===" -ForegroundColor Cyan
  $hostNames | ForEach-Object { Write-Host "  $_" }
  Write-Host ""
  Write-Host "Chay lai voi -ReuseHost <mot hostname DEV o tren>." -ForegroundColor Yellow
  Write-Host "TUYET DOI khong chon hostname PROD (api. / dangfb.)." -ForegroundColor Yellow
  exit 0
}
if ($hostNames -notcontains $ReuseHost) {
  throw "Hostname '$ReuseHost' khong co trong $ConfigPath. Chay khong tham so de xem danh sach."
}
foreach ($p in @("api.", "dangfb.")) {
  if ($ReuseHost.StartsWith($p)) { throw "'$ReuseHost' la hostname PROD. Chon hostname dev." }
}

$backup = "$ConfigPath.bak-iptrust-$stamp"
Copy-Item $ConfigPath $backup -Force
Write-Host "Backup config -> $backup" -ForegroundColor DarkGray

$echoProc = $null
$touched  = $false
try {
  # -- Echo server: chi nghe 127.0.0.1, GHI header ra FILE, KHONG doi ra Internet --
  # (doi header ve cho nguoi goi = tu bien probe thanh cong cu do noi bo cho nguoi la)
  $dumpJson = $hdrDump | ConvertTo-Json
  $echoScript = @"
const fs = require('fs');
const http = require('http');
const OUT = $dumpJson;
http.createServer((req, res) => {
  fs.appendFileSync(OUT, JSON.stringify({
    url: req.url,
    httpVersion: req.httpVersion,
    headers: req.headers,
    socketRemoteAddress: req.socket.remoteAddress,
    socketRemoteFamily: req.socket.remoteFamily,
  }, null, 2) + '\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok\n');
}).listen($Port, '127.0.0.1', () => console.log('probe listening ' + $Port));
"@
  $echoFile = Join-Path $env:TEMP "iptrust-echo-$stamp.js"
  Set-Content -Path $echoFile -Value $echoScript -Encoding utf8
  $echoProc = Start-Process node -ArgumentList $echoFile -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if ($echoProc.HasExited) { throw "Echo server chet ngay khi khoi dong (cong $Port ban?)" }
  Write-Host "Echo server pid $($echoProc.Id) tren 127.0.0.1:$Port" -ForegroundColor DarkGray

  # -- Tro tam hostname sang echo server ---------------------------------------
  # Thay dung dong `service:` dau tien SAU dong hostname da chon.
  $pattern = "(?ms)(hostname:\s*" + [regex]::Escape($ReuseHost) + "\s*\r?\n\s*service:\s*)(\S+)"
  if ($raw -notmatch $pattern) {
    throw "Khong khop duoc cap hostname/service cho '$ReuseHost' - config co the dung dinh dang khac. DUNG, sua tay."
  }
  $origService = [regex]::Match($raw, $pattern).Groups[2].Value
  Write-Host "Hostname '$ReuseHost' dang tro -> $origService (se khoi phuc)" -ForegroundColor DarkGray
  $patched = [regex]::Replace($raw, $pattern, "`${1}http://localhost:$Port")
  Set-Content -Path $ConfigPath -Value $patched -Encoding utf8
  $touched = $true

  # -- validate TRUOC khi restart. Do -> khoi phuc ngay, khong bao gio restart file chua validate --
  & $cf tunnel --config $ConfigPath ingress validate
  if ($LASTEXITCODE -ne 0) { throw "ingress validate DO - khong restart, se khoi phuc backup." }
  # validate chi kiem CU PHAP; `ingress rule` moi khang dinh hostname map dung cong.
  & $cf tunnel --config $ConfigPath ingress rule "https://$ReuseHost/"

  Restart-Service cloudflared
  Start-Sleep -Seconds 5

  # -- Goi tu Internet ---------------------------------------------------------
  Write-Host ""
  Write-Host "Goi https://$ReuseHost/iptrust-probe ..." -ForegroundColor Cyan
  try {
    Invoke-WebRequest -Uri "https://$ReuseHost/iptrust-probe" -UseBasicParsing -TimeoutSec 30 | Out-Null
  } catch {
    Write-Warning "Request loi: $($_.Exception.Message) - van doc file header neu co."
  }
  Start-Sleep -Seconds 2

  # -- Ket qua -----------------------------------------------------------------
  if (-not (Test-Path $hdrDump)) {
    throw "KHONG bat duoc request nao. Khong ket luan gi ve header - dung doan."
  }
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $body = Get-Content $hdrDump -Raw
  $head = @"
S10-AUTH-IPTRUST-1 - so do THAT header cloudflared dat
Do luc: $stamp
Hostname dung de do: $ReuseHost (tam tro -> http://localhost:$Port, da khoi phuc -> $origService)
Cach do: request tu Internet qua cloudflared -> echo server localhost.

Doc gi o duoi:
- headers['x-forwarded-for'] co MAY phan tu (tach bang dau phay) => so hop TRUST_PROXY.
- co headers['cf-connecting-ip'] khong.
- socketRemoteAddress = dia chi ma Express thay khi TRUST_PROXY=false (hien trang: ::1).

"@
  Set-Content -Path $outFile -Value ($head + $body) -Encoding utf8
  Write-Host ""
  Write-Host "=== HEADER THO ===" -ForegroundColor Green
  Write-Host $body
  Write-Host "Da luu: $outFile" -ForegroundColor Green
}
finally {
  if ($touched) {
    Copy-Item $backup $ConfigPath -Force
    & $cf tunnel --config $ConfigPath ingress validate
    if ($LASTEXITCODE -ne 0) {
      Write-Host "!!! KHOI PHUC XONG NHUNG VALIDATE DO - KHONG restart. Backup: $backup" -ForegroundColor Red
    } else {
      Restart-Service cloudflared
      Write-Host "Da khoi phuc config.yml + restart cloudflared." -ForegroundColor Green
    }
  }
  if ($echoProc -and -not $echoProc.HasExited) {
    Stop-Process -Id $echoProc.Id -Force
    Write-Host "Da dung echo server." -ForegroundColor DarkGray
  }
}
