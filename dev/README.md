# MediaOS — Dev launcher (Windows)

Nguồn sự thật của tooling: **`mediaos.ps1`** ở gốc repo. Hai cách dùng:

- **CLI:** gõ `m <lệnh>` ở gốc repo — vd `m dev`, `m reset`, `m deploy` (wrapper `m.cmd`).
- **Menu:** double-click `dev\dev.bat` (mở menu tương tác của cùng `mediaos.ps1`). `dev.bat` cũng
  nhận tham số chạy thẳng lệnh: `dev.bat prod-update` · `dev.bat prod-status` …

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
- DB + URL runtime dev lấy từ **`apps/<app>/.env`** (`VITE_*` flat-localhost) — ưu tiên hơn root `.env`.
  ⚠️ S6-SEC-ROTATE-1 (KI-043): `apps/api/.env` KHÔNG còn khai `DATABASE_*_URL` (chúng trỏ thẳng DB PROD và
  thắng mọi precedence — đúng vector V2 của KI-028). Mật khẩu DB nay CHỈ nằm ở root `.env`, không tracked.

## DB role passwords

- Postgres role là **cluster-global** (1 mật khẩu/role) ⇒ mọi DB trên cụm dùng chung một mật khẩu/role.
  Từ 2026-07-28 KHÔNG còn mật khẩu mặc định nào trong repo: repo là PUBLIC nên literal cũ chính là chìa
  khoá thật của cụm PROD (KI-043). Giá trị thật chỉ sống trong root `.env` (gitignore).
- Login/test báo *"password authentication failed"* → `m roles` (đồng bộ role THEO root `.env`).
  Lệnh này tự chữa được cả khi cụm và `.env` đang lệch: nó bootstrap qua local socket của container
  (`scripts/rotate-db-roles.mjs`) chứ không cần đăng nhập TCP bằng chính mật khẩu đang sai.

## Deploy domain thật (Cloudflare Pages + cloudflared tunnel)

| Việc | Lệnh |
|------|------|
| Sinh `.env` PROD (secrets) | `m deploy-env [domain]` |
| Pipeline đầy đủ (cần Administrator) | `m deploy [domain]` |
| Chỉ deploy 3 SPA lên Pages | `m deploy-fe [domain]` |
| Build + cài/cập nhật service API | `m deploy-api` |

- Domain mặc định `funtimemediacorp.com`. FE map: `app`→apex · `auth`→auth. · `console`→console.
- Vẫn còn bước làm tay 1 lần (DNS · TLS wildcard · gắn custom domain mỗi Pages project) — xem `scripts/windows/` + runbook trong `docs/ops/`.

### PROD đang chạy — re-build · cập nhật · khởi động lại

| Việc | Lệnh | Menu |
|------|------|------|
| **Update tất cả: FE + API + LMS + SOCIAL** (re-build → deploy Pages → rebuild backend → **migrate** → restart service) | `m prod-update` | `[21]` |
| Update chỉ FE (3 SPA lên Pages) | `m prod-update fe` | `[22]` |
| Update chỉ API (rebuild dist → **migrate** → restart service `MediaOS-API`) | `m prod-update api` | `[23]` |
| Update chỉ LMS (next build `apps/lms` + restart service `MediaOS-LMS`) | `m prod-update lms` | `[26]` |
| Update chỉ SOCIAL (npm build `apps/fbpost` + restart `MediaOS-Social` + **kiểm cổng phiên**) | `m prod-update social` | `[27]` |
| Chỉ restart service, KHÔNG rebuild, KHÔNG migrate (bỏ trống = cả ba) | `m prod-restart [api\|lms\|social]` | `[24]` |
| Trạng thái PROD (service · cổng · **migration tồn đọng** · health local/online) | `m prod-status` | `[25]` |

- Bước đụng service (restart) cần Administrator — thiếu quyền thì lệnh **tự mở cửa sổ UAC** chạy tiếp phần backend; phần FE (Pages) không cần admin.
- 🔒 **Migrate chạy TRƯỚC restart và fail-closed** (S5-DEVOPS-DEPLOYMIG-1). Migrate đỏ · bạn huỷ · không đo được trạng thái · migrate xong mà vẫn còn tồn đọng ⇒ **KHÔNG restart**, thoát code 1, service giữ nguyên bản đang chạy. Lý do: trạng thái xấu nhất không phải "bản cũ chạy tiếp" mà là **"dist mới chạy trên schema cũ"** — đúng sự cố 2026-07-24 (thiếu migration 0511 ⇒ job nền Failed mỗi nhịp, `api.err.log` phình 149 MB). Hệ quả: migrate đỏ ở nhánh API chặn luôn nhánh LMS trong cùng lần chạy — cần riêng thì `m prod-update lms`.
- Lô tồn đọng có **`REVOKE`/`DROP`** (contract) ⇒ lệnh **dừng lại hỏi**, gõ `MIGRATE` để xác nhận. Máy không biết dist đang chạy còn dùng đối tượng sắp bị gỡ hay không, nên không tự quyết. Chạy không tương tác thì đặt `MEDIAOS_MIGRATE_YES=1` (vẫn in cảnh báo). `DROP … IF EXISTS` kiểu dựng-lại chỉ được in ra, không hỏi.
- Xem trước còn nợ bao nhiêu migration mà **không** đụng gì: `m prod-status` — hoặc chi tiết từng câu: `node scripts/windows/migration-status.mjs` (chỉ chạy 1 SELECT).
- `prod-update` nhẹ hơn `m deploy-api` (không gỡ/cài lại service NSSM). Đổi cấu hình service/node path → vẫn dùng `m deploy-api`.
- ⚠️ `apps/api/dist` DÙNG CHUNG với dev-online — đang chạy `m dev-online` (watch) thì `m dev-online-stop` trước khi update PROD (lệnh có cảnh báo khi thấy cổng :3200 mở).
- **LMS** = `apps/lms` (fmc-app, Next.js + SQLite) — workspace RIÊNG ngoài turbo/pnpm-workspace, chạy service NSSM `MediaOS-LMS` cổng :3400, online tại `https://train.funtimemediacorp.com`. Deps LMS đổi thì tự `pnpm install` trong `apps/lms` trước khi `m prod-update lms`.
- **SOCIAL** = `apps/fbpost` (đăng bài Facebook Page, [DECISIONS-08](../docs/DECISIONS/DECISIONS-08_Social_Satellite_App.md)) — cũng là workspace RIÊNG, nhưng dùng **npm** (`package-lock.json`) chứ không pnpm, nên `m prod-update social` gọi `npm run build`. Service NSSM `MediaOS-Social` cổng :3500, **chưa có tunnel** (mới chỉ localhost). Chi tiết vận hành: [DEVOPS-14](../docs/DEVOPS/DEVOPS-14_Social_Satellite_App_Deployment.md).
- 🔒 **`[27]` và `[25]` đều kiểm CỔNG PHIÊN của fbpost** bằng một đường phải-401 (`GET /api/pages`). Lý do: `/login` trả 200 là chuyện đương nhiên (trang đó vốn công khai), nên health xanh **không** chứng minh cổng phiên còn sống — mà cổng phiên chết nghĩa là toàn bộ token Facebook của công ty mở toang cho bất kỳ ai chạm được cổng 3500. Thấy báo đỏ ở dòng này thì **đừng mở fbpost ra ngoài** cho tới khi sửa xong.
- `m prod-status` còn kiểm **cầu SSO phía API**: `404` = API PROD đang chạy dist CŨ (chưa có module social, chạy `m prod-update api`) · `503` = thiếu `SOCIAL_SSO_SECRET`/`SOCIAL_BASE_URL`/`SOCIAL_COMPANY_ID` trong `apps/api/.env` · `401` = bình thường (có route, chỉ thiếu xác thực).

## Dev-online — xem DEV trên domain thật, song song prod

Lộ dev stack local ra internet qua cloudflared dưới `cian-dev.*`, chạy đồng thời với prod.

| Việc | Lệnh |
|------|------|
| Tạo DB cô lập `mediaos_dev` (1 lần) | `m dev-online-db` |
| Tạo ingress cloudflared + DNS (1 lần, **Administrator**) | `m dev-online-tunnel` |
| Chạy dev stack lộ online — **dev server + HMR** (sửa FE thấy ngay) | `m dev-online` |
| Chạy dev stack lộ online — **bản build** (nhanh/ổn định qua tunnel, KHÔNG HMR) | `m dev-online-fast` |

Cùng có trong **menu** (`dev\dev.bat`): `[11]` DEV-ONLINE · `[12]` DEV-ONLINE FAST.

> **Dùng `dev-online-fast` khi nào:** dev-mode nạp hàng trăm module rời/trang → qua tunnel rất chậm và hay rớt kết nối (`ERR_CONNECTION_CLOSED`). Bản build gộp còn 2–3 request/trang ⇒ ổn định. Đổi lại KHÔNG có HMR: sửa code FE phải chạy lại `m dev-online-fast`. API vẫn chạy watch như thường.

URL (sau 3 bước trên): app `https://cian-dev.funtimemediacorp.com` · auth `https://cian-dev-auth…` · console `https://cian-dev-console…` · api `https://cian-dev-api…/api/v1/health`.

- **Tách khỏi prod:** dev-online dùng API **:3200** + DB **`mediaos_dev`** (prod giữ :3100 + DB `mediaos`). Config ở `.env.dev-online` (đè lên `.env.dev`; `m dev-online` tự tạo từ `.env.dev-online.example`).
- **Host 1 cấp** (`cian-dev`, `cian-dev-api`, …) → Universal SSL `*.funtimemediacorp.com` phủ TLS miễn phí.
- **Role Postgres cluster-global:** chạy song song prod-API thì sửa 3 mật khẩu DB trong `.env.dev-online` cho KHỚP role prod (xem `.env.prod`), vì 1 role chỉ 1 mật khẩu cho mọi DB.
- ⚠️ **Cookie domain trùng prod** (`.funtimemediacorp.com`) → 1 trình duyệt không đăng nhập đồng thời prod + dev. Test dev bằng **trình duyệt/profile khác**. (Muốn cô lập cookie hẳn: cần host 2 cấp `*.cian-dev.…` + Cloudflare Advanced Certificate trả phí.)
- Đổi tên `cian-dev`: sửa `$DevPrefix` trong `scripts/windows/07-tunnel-dev.ps1` + hostname trong `.env.dev-online` + `VITE_TUNNEL_HOST` trong `mediaos.ps1`.

## Lưu ý

- Test chạy `vitest` **trực tiếp** trong thư mục app (turbo nuốt env → fail giả).
- `.env*` đã gitignore. Các file `dev/_*.bat` cũ (projects/api/auth stack media) đã **orphan** — không còn được gọi.
