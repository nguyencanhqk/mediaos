# _lib.ps1 — helper dùng chung cho bộ script deploy Windows. Dot-source: . "$PSScriptRoot\_lib.ps1"
# Tương thích Windows PowerShell 5.1 (không ternary/??). Mọi script khác gọi các hàm ở đây.

$ErrorActionPreference = "Stop"

# Repo root = scripts/windows/../../
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:EnvPath  = Join-Path $RepoRoot ".env"

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  [!]  $m"   -ForegroundColor Yellow }
function Write-Err([string]$m)  { Write-Host "  [X]  $m"   -ForegroundColor Red }

# Sinh secret ngẫu nhiên an toàn (RNG), chỉ ký tự alnum (an toàn cho URL/connection string).
function New-Secret { param([int]$Bytes = 24)
  $b = New-Object 'System.Byte[]' $Bytes
  (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
  ([Convert]::ToBase64String($b)) -replace '[+/=]', ''
}
function New-HexSecret { param([int]$Bytes = 32)
  $b = New-Object 'System.Byte[]' $Bytes
  (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

# Ghi file UTF-8 KHÔNG BOM (dotenv parser của app đọc raw — BOM phá dòng đầu).
function Write-TextFile { param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

# Nạp .env (root) vào session env hiện tại → pnpm/node con kế thừa (db:migrate/setup-roles cần).
function Import-DotEnv { param([string]$Path = $script:EnvPath)
  if (-not (Test-Path $Path)) { throw "Không thấy .env tại $Path — chạy 01-setup-env.ps1 trước." }
  foreach ($line in Get-Content $Path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    Set-Item -Path ("Env:" + $k) -Value $v
  }
  Write-Ok "Đã nạp .env vào session"
}

# Đọc 1 giá trị từ .env (không nạp toàn bộ).
function Get-DotEnvValue { param([string]$Key, [string]$Path = $script:EnvPath)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    $t = $line.Trim()
    if ($t.StartsWith("$Key=")) { return $t.Substring($Key.Length + 1).Trim() }
  }
  return $null
}

function Test-Command { param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Command { param([string]$Name, [string]$Hint)
  if (-not (Test-Command $Name)) { throw "Thiếu lệnh '$Name'. $Hint" }
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "Cần chạy PowerShell với quyền Administrator (cài service/cloudflared)."
  }
}
