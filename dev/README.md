# MediaOS — Dev launcher (Windows)

Nguồn sự thật của tooling: **`mediaos.ps1`** ở gốc repo. Hai cách dùng:

- **CLI:** gõ `m <lệnh>` ở gốc repo — vd `m dev`, `m reset`, `m deploy` (wrapper `m.cmd`).
- **Menu:** double-click `dev\dev.bat` (mở menu tương tác của cùng `mediaos.ps1`).

> `dev.bat`, `m.cmd` chỉ là shim mỏng gọi `mediaos.ps1` — sửa logic ở 1 chỗ duy nhất.

## Kiến trúc hiện tại (sau de-media-fy) — 4 app

| App | Cổng | Vai trò |
|-----|------|---------|
| `apps/api` | 3100 | NestJS (backend duy nhất) |
| `apps/auth` | 5275 | Đăng nhập |
| `apps/app` | 5273 | Vỏ nghiệp vụ hợp nhất — landing sau login |
| `apps/console` | 5278 | Quản trị hệ thống |

Infra docker: postgres :5432 · pgbouncer :6432 · valkey :6379 · minio :9000/9001.

## Dùng nhanh

| Việc | Lệnh |
|------|------|
| Lần đầu | `m setup` (pnpm install) → `m reset` (DB sạch + seed) → `m dev` |
| Khởi động dev + mở browser | `m dev` |
| Chỉ bật/tắt infra | `m up` / `m down` |
| Xem trạng thái (docker · cổng · health) | `m status` |
| Rebuild | `m rebuild` |
| Reset DB (XOÁ SẠCH + migrate + seed) | `m reset` |
| Test 1 app | `m test auth` (vd) |
| Login báo sai mật khẩu DB | `m roles` |

**Login dev:** company `demo` · `admin@demo.local` · `Admin@12345` → mở http://localhost:5273

## Cơ chế env (quan trọng)

- Root `.env` được toggle giữa `.env.dev` (flat-localhost — login browser chạy được) và
  `.env.prod` (cookie `.<domain>` + Secure — KHÔNG dùng chạy local). `m dev`/`m reset` tự copy `.env.dev` → `.env`; `m prod-env` trả lại `.env.prod`.
- DB + URL runtime dev lấy từ **`apps/<app>/.env`** (mật khẩu `changeme_*`, `VITE_*` flat-localhost) — ưu tiên hơn root `.env`.

## DB role passwords

- Postgres role là **cluster-global** (1 mật khẩu/role). Setup PROD đổi role sang mật khẩu prod ⇒ `changeme_*` của dev hết connect.
- Login/test báo *"password authentication failed"* → `m roles` (đồng bộ role về `changeme_*`).

## Deploy domain thật (Cloudflare Pages + cloudflared tunnel)

| Việc | Lệnh |
|------|------|
| Sinh `.env` PROD (secrets) | `m deploy-env [domain]` |
| Pipeline đầy đủ (cần Administrator) | `m deploy [domain]` |
| Chỉ deploy 3 SPA lên Pages | `m deploy-fe [domain]` |
| Build + cài/cập nhật service API | `m deploy-api` |

- Domain mặc định `funtimemediacorp.com`. FE map: `app`→apex · `auth`→auth. · `console`→console.
- Vẫn còn bước làm tay 1 lần (DNS · TLS wildcard · gắn custom domain mỗi Pages project) — xem `scripts/windows/` + runbook trong `docs/ops/`.

## Lưu ý

- Test chạy `vitest` **trực tiếp** trong thư mục app (turbo nuốt env → fail giả).
- `.env*` đã gitignore. Các file `dev/_*.bat` cũ (projects/api/auth stack media) đã **orphan** — không còn được gọi.
