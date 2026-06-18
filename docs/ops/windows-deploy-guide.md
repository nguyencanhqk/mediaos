# MediaOS — Deploy trên Windows (tự động hoá bằng PowerShell)

> Backend (Postgres/API) chạy trên **máy Windows 11** + **Cloudflare Tunnel**; frontend lên **Cloudflare Pages**.
> Bộ script tự động: [`scripts/windows/`](../../scripts/windows/). Bản chi tiết khái niệm (Linux/chung):
> [cloudflare-deploy-guide.md](./cloudflare-deploy-guide.md). Kiến trúc: [fs5-cutover-runbook.md](./fs5-cutover-runbook.md).
> Domain: **funtimemediacorp.com**.

---

## 0. Máy Windows 11 cá nhân — lưu ý TRƯỚC

- **Máy phải BẬT liên tục.** Tắt máy / sleep ⇒ API + DB + tunnel chết ⇒ site sập. Vào *Settings → System →
  Power*: đặt **Never sleep** (ít nhất khi cắm điện). Cân nhắc tắt fast-startup nếu hay reboot.
- **Docker Desktop** cần bật chế độ **Start on login** (Settings → General) để DB tự lên sau reboot.
- API + cloudflared cài làm **Windows service auto-start** (script lo) → tự chạy lại sau reboot.
- Máy cá nhân không có IP tĩnh cũng **không sao**: Cloudflare Tunnel kết nối **outbound** (không mở cổng,
  không cần port-forward / public IP).
- Đây là cấu hình hợp cho **demo / nội bộ / staging**. Production thật nên cân nhắc server chạy 24/7.

---

## 1. Yêu cầu

- Windows 11, tài khoản Administrator.
- `winget` (có sẵn; nếu thiếu cập nhật *App Installer* từ Microsoft Store).
- Domain `funtimemediacorp.com` đã trỏ **nameserver về Cloudflare** (site `Active`).
- Đã clone repo MediaOS về máy (vd `C:\dev 2\MediaOS`).
- (FE) Cloudflare **API token** (scope *Account → Cloudflare Pages → Edit*) + **Account ID**, hoặc dùng
  `wrangler login` tương tác.

---

## 2. ⚠️ 2 blocker phải biết (giống bản chung)

1. **KMS Vault chưa implement** (`vault-kek.provider.ts` là stub `throw NOT_IMPLEMENTED:2g`). Script đặt
   `KMS_PROVIDER=local` + sinh KEK file (lệch ADR-0004, dùng tạm). Chi tiết + phương án B:
   [cloudflare-deploy-guide.md §2a](./cloudflare-deploy-guide.md).
2. **DB mới chưa có company** → phải seed 1 company trước khi super-admin bootstrap chạy. Bước này **thủ công**
   (cần xác nhận cột bảng `companies`) — xem §4 bước seed + [guide §3.3](./cloudflare-deploy-guide.md).

---

## 3. Chạy tự động (1 phát) — khuyến nghị

Mở **PowerShell as Administrator**, `cd` vào repo, rồi:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force   # cho phép chạy script trong phiên này
.\scripts\windows\deploy-all.ps1 -Domain funtimemediacorp.com
```

`deploy-all.ps1` chạy lần lượt 00→06, **dừng hỏi** ở các mốc tương tác (mở Docker Desktop, lưu mật khẩu
super-admin, seed company, cloudflared/wrangler login). Tham số hữu ích:

| Tham số | Ý nghĩa |
| --- | --- |
| `-Domain` | domain prod (mặc định `funtimemediacorp.com`) |
| `-CompanySlug` | slug company host (mặc định `funtime`) |
| `-AdminEmail` | email super-admin (mặc định `admin@<domain>`) |
| `-SkipPrereqs` | bỏ bước 00 (đã cài) |
| `-ForceEnv` | ghi đè `.env` đang có |
| `-NonInteractive` | không dừng hỏi (chỉ khi đã làm trước các bước tay) |

> Đặt token Pages trước khi tới bước 06 để FE deploy không cần login tay:
> `$env:CLOUDFLARE_API_TOKEN="..."; $env:CLOUDFLARE_ACCOUNT_ID="..."`

---

## 4. Chạy thủ công từng bước (nếu muốn kiểm soát)

| Script | Việc | Tương tác? |
| --- | --- | --- |
| `00-prereqs.ps1` | winget: Docker Desktop, Node, pnpm (corepack), cloudflared, nssm | — |
| `01-setup-env.ps1` | sinh `.env` prod + secret + KEK; in mật khẩu super-admin | — |
| `02-infra-up.ps1` | `docker compose up` + chờ Postgres healthy + tạo bucket MinIO | cần Docker đang chạy |
| `03-migrate.ps1` | install + build contracts + `db:migrate` + `db:setup-roles` | — |
| **seed company** | `psql "$env:DATABASE_DIRECT_URL"` → `INSERT INTO companies ...` | **thủ công** |
| `04-build-install-service.ps1` | build API + cài service `MediaOS-API` (NSSM) | Admin |
| `05-tunnel.ps1` | tunnel `api.<domain>` + service `cloudflared` | Admin + login |
| `06-deploy-pages.ps1` | build + deploy 5 SPA lên Pages | token hoặc login |

Ví dụ chạy lẻ:

```powershell
.\scripts\windows\00-prereqs.ps1
.\scripts\windows\01-setup-env.ps1 -Domain funtimemediacorp.com
# mở Docker Desktop, đợi Engine running
.\scripts\windows\02-infra-up.ps1
.\scripts\windows\03-migrate.ps1

# seed company host (xác nhận cột bảng companies ở apps/api/src/db/schema/ trước):
#   psql "$env:DATABASE_DIRECT_URL" -c "INSERT INTO companies (id,name,slug,status) VALUES (gen_random_uuid(),'Funtime Media Corp','funtime','active');"

.\scripts\windows\04-build-install-service.ps1
Restart-Service MediaOS-API     # để super-admin bootstrap chạy sau khi company đã có
.\scripts\windows\05-tunnel.ps1 -Domain funtimemediacorp.com
$env:CLOUDFLARE_API_TOKEN="..."; $env:CLOUDFLARE_ACCOUNT_ID="..."
.\scripts\windows\06-deploy-pages.ps1 -Domain funtimemediacorp.com
```

> `psql` chưa cài? Dùng container: `docker exec -i mediaos-postgres psql -U mediaos -d mediaos -c "INSERT ..."`.

---

## 5. Sau khi chạy — việc tay còn lại

1. **Pages custom domain** (dashboard → Pages → từng project → Custom domains):
   `web-mediaos`→apex, `auth-mediaos`→`auth.`, `studio./people./console.` tương ứng.
2. **SSL/TLS** zone: mode **Full (strict)** + **Always Use HTTPS** + **HSTS** (SSL/TLS → Edge Certificates).
3. **Smoke test** ([runbook §8](./fs5-cutover-runbook.md)): login `auth.` → launcher → mở studio/people/console
   không login lại; refresh-on-401; logout toàn cục; chặn `?redirect=` lạ.
4. **Backup**: lên Task Scheduler chạy `scripts/backup-db.sh` (qua WSL/git-bash) hằng ngày; **backup file KEK**
   `.secrets\local-kek.bin` ra nơi an toàn TÁCH BIỆT.

---

## 6. Vận hành (Windows)

```powershell
Get-Service MediaOS-API, cloudflared           # trạng thái service
Get-Content .\logs\api.err.log -Tail 50        # log API
docker compose ps                              # hạ tầng
```

**Cập nhật code:**

```powershell
git pull
pnpm install --frozen-lockfile
.\scripts\windows\03-migrate.ps1               # nếu có migration mới
pnpm --filter "@mediaos/api" build
Restart-Service MediaOS-API
.\scripts\windows\06-deploy-pages.ps1 -Domain funtimemediacorp.com   # nếu FE đổi
```

---

## 7. Troubleshooting

| Triệu chứng | Nguyên nhân / cách xử |
| --- | --- |
| `02` lỗi `docker compose up` | Docker Desktop chưa chạy / chưa 'Engine running'. Mở app, đợi rồi chạy lại. |
| API service start rồi tắt | Xem `logs\api.err.log`. Thường: `.env` sai, DB chưa migrate, **KEK thiếu** (chạy lại 01), JWT_SECRET trống. |
| `db:setup-roles` lỗi auth pgbouncer | Đổi mật khẩu mà chưa `docker compose restart pgbouncer` (03 đã làm; chạy lại nếu cần). |
| `cloudflared` service không kết nối | Config phải ở `C:\Windows\System32\config\systemprofile\.cloudflared\` (05 đã copy). Kiểm `cloudflared tunnel info mediaos-api`. |
| `https://api.<domain>` 502 | API service chết hoặc tunnel trỏ sai cổng. Kiểm `Get-Service MediaOS-API` + ingress trỏ `localhost:3100`. |
| Pages deploy đòi login | Đặt `$env:CLOUDFLARE_API_TOKEN` + `$env:CLOUDFLARE_ACCOUNT_ID` trước khi chạy 06. |
| Login web nhưng đổi app phải login lại | Cookie domain sai: `.env` `AUTH_COOKIE_DOMAIN=.funtimemediacorp.com` (đầu '.') + `AUTH_COOKIE_SECURE=true` + custom domain đúng. |
| Super-admin không tạo được | Company chưa seed lúc API boot → seed company rồi `Restart-Service MediaOS-API` (bootstrap idempotent). |
| API auth DB fail `password authentication failed for "mediaos_app/worker"` | `apps/api/.env` (fixture TEST, mật khẩu placeholder) SHADOW root `.env` prod do `ENV_FILE_PATHS=[".env","../../.env"]` (file trước thắng). **Fix (đã làm):** service chạy cwd=**repo root** (04 đặt `AppDirectory=$RepoRoot`), KHÔNG phải apps/api. Nếu chạy tay: `node apps/api/dist/main.js` TỪ repo root. |
| `Connection terminated unexpectedly` qua PgBouncer :6432 | edoburu/pgbouncer sinh `[databases] mediaos = ... auth_user=postgres` nhưng KHÔNG có role `postgres` (superuser=`mediaos`) + userlist chỉ có `pgbouncer_auth` → auth_query fail. **Fix (đã làm):** `DATABASE_URL` trỏ THẲNG `:5432` (bypass bouncer); RLS vẫn ép qua mediaos_app + GUC per-tx. Wire bouncer đúng = TODO (custom config: db-line `auth_user=pgbouncer_auth`, bỏ `user=`). |

---

## 8. Gỡ cài đặt

```powershell
nssm stop MediaOS-API; nssm remove MediaOS-API confirm
cloudflared service uninstall
docker compose down            # thêm -v để xoá cả dữ liệu (CẨN THẬN: mất DB)
```
