<#
.SYNOPSIS
  S10-AUTH-IPTRUST-1 - DO THU TU `X-Forwarded-For` khi client TU GUI san header do.

.DESCRIPTION
  Probe 10-* da do duoc: request "sach" tu Internet -> origin thay XFF DUNG MOT phan tu.
  Nhung so do do KHONG tra loi cau hoi quyet dinh: khi KE TAN CONG tu nhet
  `X-Forwarded-For: <bia>` vao, cloudflared NOI THEM IP that vao CUOI, CHEN TRUOC, hay XOA?

  Khac biet nay la ranh gioi an toan cua `TRUST_PROXY=loopback`:
    XFF = "<bia>, <that>"  (noi vao cuoi)  -> req.ip = <that>   AN TOAN
    XFF = "<that>, <bia>"  (chen truoc)    -> req.ip = <bia>    GIA MAO DUOC
    XFF = "<that>"         (xoa/ghi de)    -> req.ip = <that>   AN TOAN
  WO cam suy dieu nay tu tai lieu Cloudflare. Nen phai do.

  RE HON PROBE 10-*: KHONG sua `config.yml`, KHONG `Restart-Service cloudflared`.
  Ly do: hostname dev `cian-dev-console` DA tro san toi `http://localhost:5278`, va cong do
  dang TRONG (khong co Vite dev server chay). Chi can dung echo server DUNG tren cong ay.
  => 0 anh huong toi 8 hostname khac (ke ca `api.` PROD va `dangfb.` PROD).

.NOTES
  KHONG can Administrator (khong ghi ProgramData, khong restart service).
  An toan theo thiet ke:
    - Tu choi neu cong DANG BAN (khong bao gio cuop cong cua tien trinh khac).
    - Tu choi hostname PROD; va DOI CHIEU hostname -> cong trong config.yml truoc khi chay.
    - Echo server chi nghe 127.0.0.1, ghi header ra FILE, tra ve "ok" - KHONG doi header lai
      cho nguoi goi (de no khong thanh cong cu do noi bo cho nguoi la trong vai chuc giay song).
    - Duong dan bi mat ngau nhien: request khong dung token bi 404, khong ghi gi.
    - Tu tat sau khi do xong hoac het -TimeoutSec, di qua finally.
    - IP that + cf-ray bi THAY BANG PLACEHOLDER truoc khi ghi evidence (repo PUBLIC), nhung
      THU TU trong XFF duoc giu nguyen - do moi la thu can doc.
#>
[CmdletBinding()]
param(
  [string]$ProbeHost = "cian-dev-console.funtimemediacorp.com",
  [int]$Port = 5278,
  [string]$SpoofIp = "203.0.113.9",
  [int]$TimeoutSec = 60,
  [string]$ConfigPath = "C:\ProgramData\cloudflared\config.yml"
)

$ErrorActionPreference = "Stop"
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir  = Join-Path $PSScriptRoot "..\..\docs\DEVOPS\evidence"
$outFile = Join-Path $outDir "S10-AUTH-IPTRUST-1-xff-order-$stamp.txt"
$hdrDump = Join-Path $env:TEMP "iptrust-spoof-$stamp.json"
$token   = [guid]::NewGuid().ToString("N")

foreach ($p in @("api.", "dangfb.", "train.", "danews.", "tasklive.")) {
  if ($ProbeHost.StartsWith($p)) { throw "'$ProbeHost' la hostname PROD/dich vu that. Chon hostname dev." }
}

# -- Doi chieu hostname -> cong trong config.yml (dung cuop cong cua thu khac) --
if (-not (Test-Path $ConfigPath)) { throw "Khong thay $ConfigPath" }
$raw = Get-Content $ConfigPath -Raw
$pattern = "(?ms)hostname:\s*" + [regex]::Escape($ProbeHost) + "\s*\r?\n\s*service:\s*(\S+)"
$m = [regex]::Match($raw, $pattern)
if (-not $m.Success) { throw "Hostname '$ProbeHost' khong co trong $ConfigPath." }
$mapped = $m.Groups[1].Value
if ($mapped -notmatch ":$Port(/|$)") {
  throw "config.yml tro '$ProbeHost' -> '$mapped', KHONG phai cong $Port. Dung, dung doan."
}

# -- Cong PHAI dang trong --
$busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($busy) { throw "Cong $Port DANG BAN (pid $(($busy | Select-Object -First 1).OwningProcess)). Dung - khong cuop cong." }

Write-Host "hostname '$ProbeHost' -> '$mapped' (khop cong $Port, cong dang trong)" -ForegroundColor DarkGray

$echoProc = $null
try {
  $dumpJson  = $hdrDump | ConvertTo-Json
  $tokenJson = $token   | ConvertTo-Json
  $echoScript = @"
const fs = require('fs');
const http = require('http');
const OUT = $dumpJson;
const TOKEN = $tokenJson;
const srv = http.createServer((req, res) => {
  if (!req.url.startsWith('/' + TOKEN)) { res.writeHead(404).end(); return; }
  fs.appendFileSync(OUT, JSON.stringify({
    label: req.url.slice(TOKEN.length + 2),
    headers: req.headers,
    socketRemoteAddress: req.socket.remoteAddress,
  }, null, 2) + '\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok\n');
});
srv.listen($Port, '127.0.0.1', () => console.log('spoof-probe listening $Port'));
setTimeout(() => process.exit(0), $TimeoutSec * 1000).unref();
"@
  $echoFile = Join-Path $env:TEMP "iptrust-spoof-echo-$stamp.js"
  Set-Content -Path $echoFile -Value $echoScript -Encoding utf8
  $echoProc = Start-Process node -ArgumentList $echoFile -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if ($echoProc.HasExited) { throw "Echo server chet ngay khi khoi dong." }

  # -- 3 lan goi tu Internet ---------------------------------------------------
  # control  : khong gui XFF  -> cho biet IP that + hinh dang "sach" (doi chung voi probe 10-*)
  # spoof-xff: gui XFF bia    -> cho biet cloudflared NOI VAO DAU day
  # spoof-cf : gui ca CF-Connecting-IP bia -> co ghi de duoc header rieng cua Cloudflare khong
  $calls = @(
    @{ label = "control";   headers = @{} },
    @{ label = "spoof-xff"; headers = @{ "X-Forwarded-For" = $SpoofIp } },
    @{ label = "spoof-cf";  headers = @{ "X-Forwarded-For" = $SpoofIp; "CF-Connecting-IP" = $SpoofIp } }
  )
  # Ket qua TUNG lan goi phai vao evidence: mot lan bi CHAN O EDGE (khong toi origin) cung la
  # SO DO - no khong de lai dong nao trong dump header, nen neu chi ghi header thi so do do BIEN MAT.
  $callLog = @()
  foreach ($c in $calls) {
    $uri = "https://$ProbeHost/$token/$($c.label)"
    Write-Host "goi $($c.label) ..." -ForegroundColor Cyan
    try {
      $r = Invoke-WebRequest -Uri $uri -Headers $c.headers -UseBasicParsing -TimeoutSec 30
      $callLog += "  {0,-10} -> HTTP {1} (toi duoc origin)" -f $c.label, [int]$r.StatusCode
    } catch {
      $code = $null
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      if ($code) {
        $callLog += "  {0,-10} -> HTTP {1} CHAN O EDGE Cloudflare (KHONG toi origin)" -f $c.label, $code
      } else {
        $callLog += "  {0,-10} -> LOI: {1}" -f $c.label, $_.Exception.Message
      }
      Write-Warning "$($c.label): $($_.Exception.Message)"
    }
  }
  Start-Sleep -Seconds 2

  if (-not (Test-Path $hdrDump)) { throw "KHONG bat duoc request nao. Khong ket luan gi - dung doan." }
  $body = Get-Content $hdrDump -Raw

  # -- Che du lieu dinh danh TRUOC khi ghi vao repo PUBLIC (giu nguyen THU TU) --
  # IP that = XFF cua lan 'control' (client khong gui gi thi con lai dung IP that).
  $ctrl = [regex]::Match($body, '"label":\s*"control".*?"x-forwarded-for":\s*"([^"]+)"', 'Singleline')
  if ($ctrl.Success) {
    $realIp = $ctrl.Groups[1].Value.Trim()
    $body = $body.Replace($realIp, "<REAL-CLIENT-IP>")
  } else {
    throw "Khong tach duoc IP that tu lan control - KHONG che duoc nen DUNG, khong ghi file."
  }
  $body = [regex]::Replace($body, '("cf-ray":\s*")[^"]+', '${1}<REDACTED>')
  $body = [regex]::Replace($body, '("cf-warp-tag-id":\s*")[^"]+', '${1}<REDACTED>')

  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $head = @"
S10-AUTH-IPTRUST-1 - THU TU X-Forwarded-For khi client TU GUI header
Do luc: $stamp
Hostname: $ProbeHost -> $mapped (KHONG sua config.yml, KHONG restart cloudflared)
IP bia ma client tu khai: $SpoofIp
IP that cua client da thay bang placeholder <REAL-CLIENT-IP> (repo PUBLIC) - THU TU giu nguyen.

Doc gi o duoi (lan 'spoof-xff'):
  x-forwarded-for = "$SpoofIp, <REAL-CLIENT-IP>"  => NOI VAO CUOI  => TRUST_PROXY=loopback AN TOAN
  x-forwarded-for = "<REAL-CLIENT-IP>, $SpoofIp"  => CHEN TRUOC    => loopback GIA MAO DUOC, phai doi cach
  x-forwarded-for = "<REAL-CLIENT-IP>"            => XOA/GHI DE    => AN TOAN

KET QUA TUNG LAN GOI:
$($callLog -join "`n")

"@
  Set-Content -Path $outFile -Value ($head + $body) -Encoding utf8
  Write-Host ""
  Write-Host "=== HEADER (da che) ===" -ForegroundColor Green
  Write-Host $body
  Write-Host "Da luu: $outFile" -ForegroundColor Green
}
finally {
  if ($echoProc -and -not $echoProc.HasExited) {
    Stop-Process -Id $echoProc.Id -Force
    Write-Host "Da dung echo server." -ForegroundColor DarkGray
  }
  if (Test-Path $hdrDump) { Remove-Item $hdrDump -Force }
}
