# G4-8 — Checklist Triển khai Pilot

> **Không code.** Đây là hướng dẫn ops để dựng MediaOS lên môi trường thật cho pilot team.
> Tham chiếu: [`docs/infra-zero-cost-plan.md`](../infra-zero-cost-plan.md) · [`CLAUDE.md` §4](../../CLAUDE.md).

---

## 0. Chuẩn bị trước khi bắt đầu

- [ ] Chọn nền tảng: **Oracle Cloud Always Free (Ampere A1)** hoặc **on-prem Linux**
  - A1: 4 OCPU, 24 GB RAM, 50 GB boot + 150 GB data block volume — Singapore region nếu có
  - On-prem: PC/server Linux chạy 24/7 trong văn phòng
- [ ] OS: Ubuntu 22.04 LTS (hoặc 24.04) 64-bit ARM64 (A1) hoặc x86_64 (on-prem)
- [ ] Tên miền hoặc subdomain trỏ về IP server (VD: `mediaos.yourdomain.com`) — cần trước khi cấp TLS
- [ ] Mở firewall port: **22** (SSH), **80** (HTTP redirect), **443** (HTTPS)
- [ ] Lưu khóa mã hóa backup tại ≥ 2 nơi an toàn ngoài server (password manager / két)

---

## 1. Cài đặt server

```bash
# Cập nhật OS
sudo apt update && sudo apt upgrade -y

# Docker Engine (không dùng Docker Desktop)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout/login lại sau bước này

# Docker Compose v2 đã đi kèm Docker Engine
docker compose version           # phải hiện v2.x

# Git, age (mã hóa backup), rclone (đẩy B2)
sudo apt install -y git age
curl https://rclone.org/install.sh | sudo bash

# Node 20 + pnpm 11 (để build)
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 20 && fnm use 20
npm install -g pnpm@11
```

---

## 2. Clone repo & cấu hình môi trường

```bash
git clone <repo-url> /opt/mediaos
cd /opt/mediaos

# Tạo .env từ example, rồi điền giá trị THẬT (xem mục 3)
cp .env.example .env
nano .env
```

---

## 3. Điền .env cho production

Mở `.env` và thay tất cả `changeme_*` bằng giá trị ngẫu nhiên mạnh:

| Biến | Ghi chú |
|------|---------|
| `POSTGRES_PASSWORD` | Mật khẩu postgres superuser — dài ≥ 20 ký tự |
| `APP_DB_PASSWORD` | Mật khẩu `mediaos_app` role |
| `WORKER_DB_PASSWORD` | Mật khẩu `mediaos_worker` role |
| `PGBOUNCER_AUTH_PASSWORD` | Mật khẩu `pgbouncer_auth` role |
| `MINIO_ROOT_PASSWORD` | MinIO admin password |
| `S3_SECRET_KEY` | Khớp với `MINIO_ROOT_PASSWORD` lúc đầu |
| `JWT_SECRET` | Random 64 bytes: `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Random 64 bytes khác |
| `NODE_ENV` | Đổi thành `production` |
| `CORS_ORIGIN` | URL web production, VD: `https://mediaos.yourdomain.com` |
| `VITE_API_URL` | `https://mediaos.yourdomain.com/api/v1` |
| `BACKUP_GPG_RECIPIENT` | GPG key ID hoặc email cho mã hóa dump |
| `BACKUP_B2_REMOTE` | Remote rclone đã cấu hình, VD: `b2:mediaos-backup` |

> **Bất biến #3:** KHÔNG bao giờ commit `.env` thật. File đã gitignore.

---

## 4. Dựng hạ tầng (Docker Compose)

```bash
cd /opt/mediaos

# Tạo thư mục secret cho PgBouncer
mkdir -p .secrets/pgbouncer

# Khởi động Postgres, Valkey, MinIO trước
docker compose up -d postgres valkey minio

# Chờ postgres healthy
docker compose ps   # STATUS phải là "(healthy)"
```

---

## 5. Migrate DB & setup DB roles

```bash
# Áp tất cả migration (dùng DATABASE_DIRECT_URL — superuser)
pnpm install
pnpm db:migrate

# Tạo roles mediaos_app / mediaos_worker / pgbouncer_auth với đúng password
pnpm --filter @mediaos/api db:setup-roles

# Sinh userlist.txt cho PgBouncer
# (script này đọc PGBOUNCER_AUTH_PASSWORD từ .env → ghi .secrets/pgbouncer/userlist.txt)
pnpm --filter @mediaos/api db:gen-pgbouncer-userlist

# Bây giờ khởi PgBouncer
docker compose up -d pgbouncer
docker compose ps   # pgbouncer STATUS = running
```

---

## 6. Build & chạy API + Web

```bash
# Build toàn bộ (contracts → api → web)
pnpm build

# Chạy API (production process)
# Khuyến nghị: dùng PM2 để tự restart khi lỗi
npm install -g pm2
pm2 start apps/api/dist/main.js --name mediaos-api
pm2 startup   # theo hướng dẫn in ra để tự start khi reboot
pm2 save
```

Web là **static SPA** — serve bởi Caddy (bước tiếp theo).

---

## 7. Caddy reverse proxy & TLS tự động

Cài Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Tạo `/etc/caddy/Caddyfile`:
```
mediaos.yourdomain.com {
    # Serve Vite build
    root * /opt/mediaos/apps/web/dist
    file_server

    # SPA fallback (TanStack Router client-side routing)
    try_files {path} /index.html

    # Proxy API requests đến NestJS
    handle /api/* {
        reverse_proxy localhost:3100
    }

    # CORS headers đã xử lý ở NestJS, Caddy không cần thêm
}
```

```bash
sudo systemctl reload caddy
# Caddy sẽ tự cấp Let's Encrypt TLS cho domain
```

---

## 8. Seed dữ liệu pilot

```bash
# Tạo company + admin user đầu tiên
pnpm --filter @mediaos/api db:seed-pilot
# Script seed tạo: 1 company, 1 admin, 1 team mẫu, 1 project mẫu
# (tham khảo scripts/seed-pilot.ts — tạo mới nếu chưa có)
```

---

## 9. Smoke test sau deploy

```bash
# Health check API
curl -f https://mediaos.yourdomain.com/api/v1/health
# Phải trả: { "status": "ok" }

curl -f https://mediaos.yourdomain.com/api/v1/health/db
# Phải trả: { "status": "ok", "db": "ok" }

# Mở browser: https://mediaos.yourdomain.com
# Login với admin vừa seed → xác nhận dashboard load
```

---

## 10. Setup backup tự động

```bash
# Cấu hình rclone với Backblaze B2
rclone config   # theo wizard: chọn b2, nhập Account ID + Application Key

# Test thủ công 1 lần
bash /opt/mediaos/scripts/backup-db.sh

# Kiểm tra file đã lên B2
rclone ls b2:mediaos-backup

# Cài cron hằng đêm 02:00 Asia/Ho_Chi_Minh (UTC+7 = 19:00 UTC)
crontab -e
# Thêm dòng:
# 0 19 * * * TZ=Asia/Ho_Chi_Minh bash /opt/mediaos/scripts/backup-db.sh >> /var/log/mediaos-backup.log 2>&1
```

---

## 11. Uptime monitoring (0đ)

- Đăng ký [UptimeRobot](https://uptimerobot.com) free → thêm monitor HTTP(S) → `https://mediaos.yourdomain.com/api/v1/health`
- Nhận alert email/Telegram khi server down

---

## 12. Onboard pilot team

- [ ] Tạo tài khoản cho từng thành viên pilot (qua `/org/employees` → invite)
- [ ] Assign role phù hợp (Manager / Editor / QA / Uploader)
- [ ] Tạo 1 project thật với 1 video để team chạy thử trọn vòng
- [ ] Gửi link feedback form (xem [`feedback-template.md`](./feedback-template.md))
- [ ] Đặt lịch check-in sau **3 ngày** và **7 ngày**

---

## 13. Rollback nếu cần

```bash
# Dừng tất cả
pm2 stop mediaos-api
docker compose down

# Khôi phục DB từ backup gần nhất
# 1. Kéo dump từ B2
rclone copy b2:mediaos-backup/<latest>.dump.age /tmp/
# 2. Giải mã
age --decrypt -i <key-file> /tmp/<latest>.dump.age > /tmp/latest.dump
# 3. Restore
pg_restore -Fc -d $DATABASE_DIRECT_URL /tmp/latest.dump

# Khởi lại
docker compose up -d && pm2 start mediaos-api
```

---

## ✅ Done khi

- [ ] `curl /health` và `/health/db` đều `"ok"`
- [ ] Pilot team đăng nhập được, thấy đúng dữ liệu theo tenant
- [ ] 1 video chạy trọn vòng (tạo → task → nộp → duyệt) trên môi trường production
- [ ] Backup chạy thành công 1 lần, file xuất hiện trên B2
- [ ] Uptime monitor bật
- [ ] Feedback form gửi tới pilot team
