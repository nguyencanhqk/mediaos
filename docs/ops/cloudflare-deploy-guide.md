# MediaOS — Deploy production chi tiết (Cloudflare Pages + Tunnel)

> Domain: **funtimemediacorp.com** · Hosting FE: **Cloudflare Pages** (5 SPA) · API: **server riêng + Cloudflare Tunnel**.
> Đây là hướng dẫn THỰC THI từng bước (copy-paste). Kiến trúc tổng quan + checklist: [fs5-cutover-runbook.md](./fs5-cutover-runbook.md).
> Mọi giá trị `<...>` là chỗ bạn điền. **KHÔNG commit secret thật** (BẤT BIẾN #3).

---

## 0. Sơ đồ deploy

```text
                            ┌─────────────────── Cloudflare edge (TLS tự động) ───────────────────┐
  Trình duyệt  ──HTTPS──►   │  funtimemediacorp.com        → Pages: web-mediaos     (launcher)     │
                            │  auth.funtimemediacorp.com   → Pages: auth-mediaos                   │
                            │  studio.funtimemediacorp.com → Pages: studio-mediaos                 │
                            │  people.funtimemediacorp.com → Pages: people-mediaos                 │
                            │  console.funtimemediacorp.com→ Pages: console-mediaos                │
                            │  api.funtimemediacorp.com    → Tunnel ─┐                             │
                            └────────────────────────────────────────┼─────────────────────────────┘
                                                                      │ (outbound, không mở cổng vào)
                            ┌──────────────── Server backend (VPS Linux) ──┼──────────────────────────┐
                            │  cloudflared  ──►  NestJS API :3100  ◄────────┘                          │
                            │  docker compose: postgres :5432 · pgbouncer :6432 · valkey :6379 · minio │
                            │  KMS: local KEK file (xem §2) ·  backups (§9)                            │
                            └──────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Chuẩn bị

**Tài khoản / quyền:**
- Cloudflare account; domain `funtimemediacorp.com` đã (hoặc sẽ) trỏ nameserver về Cloudflare.
- GitHub repo MediaOS với quyền tạo Actions secrets/variables.
- Máy local có `node ≥20`, `pnpm 11.5.1`, và `npx wrangler` (Cloudflare CLI).

**Server backend (1 VPS Linux — Ubuntu 22.04+ khuyến nghị):**
- 2 vCPU / 4 GB RAM trở lên (Postgres + Valkey + MinIO + Node).
- Cài: `docker` + `docker compose` plugin, `node ≥20`, `pnpm`, `git`, `cloudflared`.

```bash
# trên VPS (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"          # logout/login lại
corepack enable && corepack prepare pnpm@11.5.1 --activate
# cloudflared: xem §4
```

---

## 2. ⚠️ 2 quyết định CHẶN — chốt TRƯỚC khi deploy

### 2a. KMS — `KMS_PROVIDER=vault` HIỆN CHƯA CHẠY ĐƯỢC

`apps/api/src/crypto/vault-kek.provider.ts` là **DI-stub**: mọi method (`wrapDek`/`unwrapDek`/`currentKey`/`reWrapDek`)
`throw NOT_IMPLEMENTED:2g`. Đặt `KMS_PROVIDER=vault` ở prod → API sẽ **vỡ ngay khi thao tác secret**
(tạo/đọc mật khẩu `platform_accounts`, reset-token, enroll 2FA TOTP).

**Lựa chọn:**

| Phương án | Việc cần làm | Đánh đổi |
| --- | --- | --- |
| **A. Local KEK (khả dụng ngay)** | `KMS_PROVIDER=local`, đặt file KEK 32-byte trên server (chmod 600, owner = service user, ổ đĩa mã hoá, backup riêng) | **Lệch ADR-0004** (cấm KEK-in-host cho prod). Chấp nhận tạm nếu chưa dùng nhiều secret kênh. |
| **B. Implement Vault transit (đúng ADR-0004)** | Viết thật `VaultKekProvider` (transit engine: `transit/encrypt|decrypt|keys`), rồi `KMS_PROVIDER=vault` | Tốn công dev trước khi launch. |

> Khuyến nghị: **launch bằng A**, đưa B vào backlog trước khi lưu nhiều `platform_accounts` secret. Khi 2FA
> enforcement bật (`TWO_FACTOR_ENFORCEMENT_ENABLED=true`) thì enroll TOTP cũng đi qua KMS → A vẫn chạy được
> (local KEK), chỉ là lệch ADR.

Tạo KEK local (trên server, 1 lần — GIỮ KỸ, mất KEK = mất mọi secret đã mã hoá):

```bash
mkdir -p /opt/mediaos/.secrets && chmod 700 /opt/mediaos/.secrets
node -e "require('fs').writeFileSync('/opt/mediaos/.secrets/local-kek.bin', require('crypto').randomBytes(32))"
chmod 600 /opt/mediaos/.secrets/local-kek.bin
# backup file này ra nơi an toàn TÁCH BIỆT (không cùng chỗ với DB backup).
```

### 2b. Object storage — MinIO (tự host) hay Cloudflare R2

`docker-compose.yml` có sẵn MinIO (S3-compatible). R2 cũng S3-compatible (cùng `@aws-sdk/client-s3`).

| Phương án | `S3_ENDPOINT` / cấu hình |
| --- | --- |
| **MinIO tự host** (mặc định compose) | `S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`, key = `MINIO_ROOT_*` |
| **Cloudflare R2** | `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, tạo R2 bucket + API token, `S3_FORCE_PATH_STYLE=true`, `S3_REGION=auto` |

> R2 đỡ vận hành/đỡ backup hơn; cùng hệ Cloudflare. MinIO thì zero phụ thuộc ngoài. Chọn 1, điền vào `.env` (§3).

---

## 3. Backend host (server sau Tunnel)

### 3.1 Lấy code + tạo `.env` prod

```bash
sudo mkdir -p /opt/mediaos && sudo chown "$USER" /opt/mediaos
git clone <repo-url> /opt/mediaos/app && cd /opt/mediaos/app
cp .env.example .env
```

Sửa `.env` (giá trị PROD — sinh mật khẩu mạnh, mỗi cái khác nhau):

```bash
# Sinh secret ngẫu nhiên (chạy nhiều lần lấy nhiều giá trị)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Các biến BẮT BUỘC đổi khỏi mặc định dev (xem `.env.example` để biết hết):

```ini
NODE_ENV=production
API_PORT=3100

# Postgres + 3 role tách quyền (phải KHỚP mật khẩu giữa URL và *_DB_PASSWORD)
POSTGRES_USER=mediaos
POSTGRES_PASSWORD=<strong-owner-pw>
POSTGRES_DB=mediaos
DATABASE_URL=postgres://mediaos_app:<app-pw>@localhost:6432/mediaos          # qua PgBouncer
DATABASE_DIRECT_URL=postgres://mediaos:<strong-owner-pw>@localhost:5432/mediaos  # owner, migrate
DATABASE_WORKER_URL=postgres://mediaos_worker:<worker-pw>@localhost:5432/mediaos
APP_DB_PASSWORD=<app-pw>
WORKER_DB_PASSWORD=<worker-pw>
PGBOUNCER_AUTH_PASSWORD=<pgb-auth-pw>

VALKEY_URL=redis://localhost:6379

# JWT (BẮT BUỘC — không có ở .env.example, thêm tay; ≥32 ký tự ngẫu nhiên)
JWT_SECRET=<random-64-hex>

# Object storage (§2b) — MinIO hoặc R2
MINIO_ROOT_USER=mediaos
MINIO_ROOT_PASSWORD=<strong>
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=mediaos
S3_SECRET_KEY=<strong>
S3_BUCKET=mediaos-assets
S3_FORCE_PATH_STYLE=true

# KMS (§2a) — local cho launch
KMS_PROVIDER=local
KMS_LOCAL_KEK_PATH=/opt/mediaos/.secrets/local-kek.bin

# ─── SSO / cookie PROD (đầu '.' bắt buộc; Secure cần HTTPS edge — Cloudflare lo) ───
AUTH_COOKIE_DOMAIN=.funtimemediacorp.com
AUTH_COOKIE_SECURE=true
CORS_ORIGIN=https://funtimemediacorp.com,https://auth.funtimemediacorp.com,https://studio.funtimemediacorp.com,https://people.funtimemediacorp.com,https://console.funtimemediacorp.com
AUTH_REDIRECT_ALLOWLIST=https://funtimemediacorp.com,https://studio.funtimemediacorp.com,https://people.funtimemediacorp.com,https://console.funtimemediacorp.com

# Worker scheduler (outbox + export) — bật ở prod
WORKERS_SCHEDULER_ENABLED=true
OUTBOX_POLL_MS=5000
EXPORT_POLL_MS=10000
```

> ⚠️ `JWT_SECRET` không có trong `.env.example` nhưng API cần (thấy ở `.github/workflows/api.yml`). Thêm tay.
> Nếu dùng admin (operator plane) → thêm origin `https://admin.funtimemediacorp.com` vào `CORS_ORIGIN`.

### 3.2 Dựng hạ tầng + DB

```bash
cd /opt/mediaos/app
docker compose up -d                     # postgres + pgbouncer + valkey + minio
pnpm install --frozen-lockfile

# Migrate (forward-only) qua DATABASE_DIRECT_URL — tạo bảng + RLS policy + FORCE
export $(grep -v '^#' .env | xargs)      # nạp .env vào shell (hoặc dùng dotenv)
pnpm db:migrate

# Gán mật khẩu role mediaos_app/worker + sinh .secrets/pgbouncer/userlist.txt (tách secret khỏi migration)
pnpm db:setup-roles
docker compose restart pgbouncer         # nạp userlist.txt mới
```

> `db:setup-roles` đọc `APP_DB_PASSWORD` / `WORKER_DB_PASSWORD` / `PGBOUNCER_AUTH_PASSWORD` từ env và ghi
> `.secrets/pgbouncer/userlist.txt` (compose mount vào pgbouncer). Chạy LẠI mỗi khi đổi mật khẩu role.

Tạo bucket storage (nếu MinIO):

```bash
docker run --rm --network host minio/mc \
  alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && \
docker run --rm --network host minio/mc mb local/mediaos-assets
```

### 3.3 Seed company đầu tiên + tài khoản admin

> ⚠️ DB prod mới = CHƯA có company nào. `seed-operator.mjs` là DEMO (hardcode company `demo`). Bootstrap
> operator/super-admin qua env (`PLATFORM_*`) chạy lúc API boot nhưng **chỉ gắn vào company ĐÃ TỒN TẠI &
> active** — không tự tạo company. Vậy phải seed 1 company trước.

**Bước 1 — tạo company host (qua owner conn).** Kiểm cột bảng `companies` ở `apps/api/src/db/schema/`
trước khi chạy (schema có thể có thêm cột NOT NULL); template tối thiểu:

```sql
-- psql "$DATABASE_DIRECT_URL"
INSERT INTO companies (id, name, slug, status)
VALUES (gen_random_uuid(), 'Funtime Media Corp', 'funtime', 'active');
```

**Bước 2 — bật env bootstrap** (thêm vào `.env`), rồi restart API để nó UPSERT tài khoản:

```ini
# Super-admin SẢN PHẨM (đăng nhập web/studio/people/console, full quyền trong company)
PLATFORM_SUPERADMIN_EMAIL=admin@funtimemediacorp.com
PLATFORM_SUPERADMIN_PASSWORD=<strong-12+>
PLATFORM_SUPERADMIN_NAME=Super Admin
PLATFORM_SUPERADMIN_COMPANY_SLUG=funtime

# (Tuỳ chọn) Operator control-plane (apps/admin, cross-tenant)
# PLATFORM_OPERATOR_EMAIL=operator@funtimemediacorp.com
# PLATFORM_OPERATOR_PASSWORD=<strong-12+>
# PLATFORM_OPERATOR_COMPANY_SLUG=funtime
```

> Role super-admin/operator có `requires_two_factor=true`. Với `TWO_FACTOR_ENFORCEMENT_ENABLED=true` (mặc định
> prod), lần đăng nhập đầu phải enroll TOTP (đi qua KMS — §2a). Muốn hoãn 2FA lúc bootstrap: tạm
> `TWO_FACTOR_ENFORCEMENT_ENABLED=false`, login, rồi bật lại.

### 3.4 Build + chạy API như service (systemd)

```bash
cd /opt/mediaos/app
pnpm --filter @mediaos/contracts build
pnpm --filter @mediaos/api build         # → apps/api/dist
```

`/etc/systemd/system/mediaos-api.service`:

```ini
[Unit]
Description=MediaOS API (NestJS)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/mediaos/app/apps/api
EnvironmentFile=/opt/mediaos/app/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
User=mediaos
# Bảo vệ KEK: chỉ user service đọc được /opt/mediaos/.secrets

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mediaos-api
curl -s http://localhost:3100/api/v1/health        # phải trả ok
curl -s http://localhost:3100/api/v1/health/db     # DB ok
```

---

## 4. Cloudflare Tunnel cho API

```bash
# trên server (đã cài cloudflared)
cloudflared tunnel login                      # mở link, chọn zone funtimemediacorp.com
cloudflared tunnel create mediaos-api         # in ra <TUNNEL_ID> + tạo credentials json
cloudflared tunnel route dns mediaos-api api.funtimemediacorp.com   # tạo CNAME proxied
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.funtimemediacorp.com
    service: http://localhost:3100
  - service: http_status:404
```

```bash
sudo cloudflared service install        # cài systemd service cloudflared
sudo systemctl enable --now cloudflared
curl -s https://api.funtimemediacorp.com/api/v1/health   # từ ngoài, qua edge
```

---

## 5. Cloudflare zone settings (SSL/TLS)

Trên dashboard zone `funtimemediacorp.com`:

- **SSL/TLS → Overview:** mode = **Full (strict)**.
- **SSL/TLS → Edge Certificates:** bật **Always Use HTTPS** + **HSTS** (max-age ≥ 6 tháng, includeSubDomains).
- **Universal SSL:** xác nhận `Active` (phủ apex + `*.funtimemediacorp.com` — mọi subdomain của ta 1 nhãn nên đủ).
- Không cần Advanced Certificate Manager (không có subdomain ≥2 nhãn).

---

## 6. Frontend — Cloudflare Pages (5 SPA)

> `public/_redirects` (`/* /index.html 200`) ĐÃ thêm cho web/auth/studio/people/console (SPA fallback). Vite
> copy vào `dist/` khi build.

### 6.1 Tạo Pages project (1 lần mỗi app, từ local)

```bash
npx wrangler login        # hoặc export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
for app in web auth studio people console; do
  npx wrangler pages project create "${app}-mediaos" --production-branch main
done
```

### 6.2 Deploy thủ công lần đầu (kiểm chứng trước khi tự động hoá CI)

Build PHẢI nhúng `VITE_*` đúng (build-time). Ví dụ build + deploy `web` (launcher):

```bash
pnpm install --frozen-lockfile
pnpm --filter @mediaos/contracts --filter @mediaos/web-core --filter @mediaos/ui build

# web (launcher) — cần API + auth + 3 product URL
VITE_API_URL=https://api.funtimemediacorp.com/api/v1 \
VITE_AUTH_APP_URL=https://auth.funtimemediacorp.com \
VITE_STUDIO_URL=https://studio.funtimemediacorp.com \
VITE_PEOPLE_URL=https://people.funtimemediacorp.com \
VITE_CONSOLE_URL=https://console.funtimemediacorp.com \
  pnpm --filter @mediaos/web build
npx wrangler pages deploy apps/web/dist --project-name web-mediaos --branch main
```

Biến `VITE_*` mỗi app (giống logic CI `apps-frontend.yml`):

| App | VITE_* cần nhúng |
| --- | --- |
| web | `VITE_API_URL`, `VITE_AUTH_APP_URL`, `VITE_STUDIO_URL`, `VITE_PEOPLE_URL`, `VITE_CONSOLE_URL` |
| auth | `VITE_API_URL`, `VITE_DEFAULT_APP_URL=https://funtimemediacorp.com` |
| studio | `VITE_API_URL`, `VITE_AUTH_APP_URL`, `VITE_WORKFLOW_MOCK=false` |
| people | `VITE_API_URL`, `VITE_AUTH_APP_URL` |
| console | `VITE_API_URL`, `VITE_AUTH_APP_URL` |

### 6.3 Gắn custom domain cho từng Pages project

Dashboard → Pages → `<app>-mediaos` → Custom domains → Add:

| Project | Domain |
| --- | --- |
| web-mediaos | `funtimemediacorp.com` (apex) |
| auth-mediaos | `auth.funtimemediacorp.com` |
| studio-mediaos | `studio.funtimemediacorp.com` |
| people-mediaos | `people.funtimemediacorp.com` |
| console-mediaos | `console.funtimemediacorp.com` |

Cloudflare tự tạo CNAME proxied + cấp cert. (Apex dùng CNAME flattening tự động.)

---

## 7. Tự động hoá CI (GitHub Actions)

**Variables** (Settings → Secrets and variables → Actions → Variables):
- `PROD_DOMAIN = funtimemediacorp.com`

**Secrets:**
- `CLOUDFLARE_API_TOKEN` (token scope **Account → Cloudflare Pages → Edit**)
- `CLOUDFLARE_ACCOUNT_ID`
- `PROD_DATABASE_DIRECT_URL` (cho migrate prod ở `api.yml` release — nếu muốn CI migrate; cẩn trọng)

**Bật deploy FE:** trong `.github/workflows/apps-frontend.yml`, bỏ comment block `Deploy → Cloudflare Pages`
(đã chuẩn bị sẵn) — CI build kèm `VITE_*` từ `PROD_DOMAIN` rồi `wrangler pages deploy apps/<app>/dist
--project-name <app>-mediaos`.

**Bật release API:** trong `.github/workflows/api.yml` job `release`, bỏ comment bước migrate + deploy. Lưu ý
deploy API vào VPS cần cơ chế riêng (vd SSH `git pull && pnpm build && systemctl restart mediaos-api`, hoặc
self-hosted runner). Migrate prod nên chạy **forward-only**, cân nhắc chạy tay khi có migration mới thay vì
auto, để kiểm soát.

---

## 8. Smoke test sau cutover (runbook §8)

```bash
# Liveness API qua edge
CANARY_BASE_URL=https://api.funtimemediacorp.com/api/v1 bash scripts/canary-watch.sh --once
```

Trên trình duyệt:
1. Mở `https://funtimemediacorp.com` → chưa đăng nhập → bounce sang `auth.funtimemediacorp.com`.
2. Login (super-admin §3.3) → bounce về launcher → thấy tile theo capability.
3. Mở `studio./people./console.` → **KHÔNG** phải login lại (SSO cookie `.funtimemediacorp.com`).
4. Để access token hết hạn → gọi 1 action → silent refresh (không văng login).
5. Logout ở 1 app → app khác mất phiên ở refresh kế.
6. Thử `?redirect=https://evil.example` ở auth → bị từ chối (allowlist).
7. DevTools → Application → Cookies: refresh cookie `HttpOnly` + `Secure` + `Domain=.funtimemediacorp.com` + `SameSite=Strict`.

---

## 9. Vận hành

- **Backup DB:** `bash scripts/backup-db.sh` (pg_dump → encrypt → offsite; cấu hình `BACKUP_*` trong `.env`).
  Đặt cron hằng ngày. Drill phục hồi: `scripts/backup-restore-drill.sh`.
- **Backup KEK:** file `/opt/mediaos/.secrets/local-kek.bin` — backup TÁCH BIỆT khỏi DB backup (mất KEK = mất secret).
- **Update app:** `git pull && pnpm install --frozen-lockfile && pnpm --filter @mediaos/api build && sudo systemctl restart mediaos-api`. Có migration mới → `pnpm db:migrate` TRƯỚC khi restart.
- **FE update:** push master → CI build + `wrangler pages deploy` (hoặc deploy tay §6.2). Pages giữ lịch sử → rollback 1 click.
- **Monitor:** `systemctl status mediaos-api cloudflared`, `docker compose ps`, log `journalctl -u mediaos-api -f`.

---

## 10. Tóm tắt việc cần bạn quyết / làm

- [ ] §2a KMS: chọn **A. local KEK** (launch nhanh, lệch ADR-0004) hay **B. implement Vault** trước.
- [ ] §2b Storage: **MinIO** tự host hay **R2**.
- [ ] §3.3 Xác nhận cột bảng `companies` rồi seed company `funtime` + bootstrap super-admin/operator.
- [ ] §1 Provision VPS + cài Docker/Node/cloudflared.
- [ ] §3 Dựng infra + migrate + roles + build + systemd API.
- [ ] §4 Cloudflare Tunnel cho `api.`.
- [ ] §5 SSL/TLS Full(strict) + Always HTTPS + HSTS.
- [ ] §6 Tạo 5 Pages project + custom domain + deploy.
- [ ] §7 CI vars/secrets + bật deploy step.
- [ ] §8 Smoke test toàn luồng SSO.
- [ ] §9 Cron backup DB + backup KEK.
