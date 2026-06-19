# MediaOS — Dev launcher (Windows)

Bộ script khởi động & test nhanh local. Double-click `dev.bat`.

## Dùng nhanh

| Việc | Cách |
|------|------|
| Khởi động + xem app | Chạy `dev\dev.bat` → chọn **[1]** (stack demo) hoặc **[2]** (Projects PM) |
| Test 1 app | `dev\dev.bat` → **[4]**, hoặc double-click `dev\test.bat` |
| Chỉ bật DB/infra | `dev.bat` → **[3]** |
| Seed dữ liệu demo | `dev.bat` → **[5]** |
| Trả lại `.env` PROD | `dev.bat` → **[6]** |
| Tắt DB/infra | `dev.bat` → **[7]** |

## Hai stack

**[1] MAIN dev (công ty `demo`)** — DB `mediaos`
- api :3100 · auth :5275 · web :5273 · studio :5276 · people :5277 · console :5278
- Login: `demo` / `admin@demo.local` / `Admin@12345` → mở http://localhost:5273

**[2] PROJECTS PM (công ty `funtime`)** — DB `mediaos_projectspm`
- api :3101 · auth :5285 · projects :5279
- Login: `funtime` / `admin@funtimemediacorp.com` / `Admin@12345` → mở http://localhost:5279

## Cơ chế env (quan trọng)

- Root `.env` được toggle giữa `.env.dev` (flat-localhost, login browser chạy được) và
  `.env.prod` (cấu hình production, cookie `.funtimemediacorp.com` + Secure — KHÔNG dùng để chạy local browser).
- Khi chọn [1]/[2], launcher copy `.env.dev` → `.env`. Chọn [6] để trả lại `.env.prod`.
- DB của runtime dev luôn lấy từ `apps/api/.env` (mật khẩu `changeme_*`) vì `ENV_FILE_PATHS`
  ưu tiên `apps/api/.env` trước root `.env`. Biến `set` trong `_api-*.bat` thắng cả hai.

## DB role passwords (quan trọng)

- Postgres role là **cluster-global**: chỉ 1 giá trị mật khẩu, không thể vừa dev (`changeme_*`)
  vừa prod cùng lúc. Setup PROD đổi role sang mật khẩu prod → `apps/api/.env` (changeme) hết connect.
- Khi login/test báo *"password authentication failed"* → chọn **[8]** để đồng bộ role về `changeme_*`
  (khớp `apps/api/.env`). Đã đồng bộ sẵn 1 lần khi tạo bộ script này.
- Muốn quay lại role mật khẩu PROD: dùng `scripts/windows/` (setup env prod) hoặc
  `pnpm db:setup-roles` với `.env.prod` đang active.

## Lưu ý

- Test chạy `vitest` **trực tiếp** trong thư mục app, KHÔNG qua `pnpm test`/turbo (turbo nuốt env → fail giả).
- Stack [2] yêu cầu DB `mediaos_projectspm` đã tạo + migrate + seed; nếu chưa thì login sẽ fail.
- `.env`, `.env.dev`, `.env.prod` đều đã gitignore — không bị commit. Các file trong `dev/` thì
  KHÔNG gitignore (chỉ chứa mật khẩu dev placeholder `changeme_*`, không phải secret thật).
