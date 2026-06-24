# DEVOPS-03: DOCKER & CONTAINERIZATION
# DOCKER & CONTAINERIZATION
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-03 |
| Tên tài liệu | Docker & Containerization |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-02 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-03 định nghĩa chiến lược Docker và containerization cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt danh sách service cần container hóa trong MVP.
2. Định nghĩa Dockerfile cho backend API, worker và frontend web.
3. Chuẩn hóa Docker Compose cho local, development, staging/UAT và production nhỏ.
4. Chốt quy ước image tag, image registry và runtime environment.
5. Xác định cách mount volume, network, health check và log container.
6. Chuẩn bị nền để DEVOPS-06/07 triển khai pipeline deploy backend/frontend.
7. Hạn chế lỗi lệch môi trường giữa local, staging và production.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-03** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

Chuỗi DevOps MVP được tổ chức như sau:

```text
DEVOPS-01: DevOps Architecture & Environment Strategy
  -> DEVOPS-02: Repository, Branching & CI Pipeline
  -> DEVOPS-03: Docker & Containerization
  -> DEVOPS-04: Environment Configuration & Secrets Management
  -> DEVOPS-05: Database Migration & Seed Deployment
  -> DEVOPS-06: Backend Deployment Pipeline
  -> DEVOPS-07: Frontend Deployment Pipeline
  -> DEVOPS-08: Staging, UAT & Production Environment
  -> DEVOPS-09: Monitoring, Logging & Alerting
  -> DEVOPS-10: Backup, Rollback & Disaster Recovery
  -> DEVOPS-11: Security Hardening & Runtime Protection
  -> DEVOPS-12: Release Management & Go-live Plan
```

Mục tiêu của chuỗi này là biến mã nguồn, database migration, cấu hình môi trường, test result và checklist QA thành hệ thống có thể triển khai, giám sát, backup, rollback và go-live an toàn.

## 4. Nguyên tắc DevOps áp dụng chung

1. **Production-like từ sớm**: staging/UAT phải gần giống production về runtime, biến môi trường, SSL, reverse proxy, migration, logging và monitoring.
2. **Backend là trust boundary**: frontend có thể ẩn/hiện UI nhưng backend/API luôn kiểm tra authentication, permission, data scope và business rule.
3. **Mỗi môi trường tách biệt**: local, development, staging/UAT và production có database, secret, domain và storage riêng.
4. **Không deploy bằng `latest` ở production**: image phải có tag rõ ràng theo version hoặc commit SHA để rollback và truy vết.
5. **Migration phải được kiểm soát**: mọi migration cần chạy qua staging trước production và production phải backup trước migration.
6. **Deploy an toàn hơn deploy nhanh**: production deploy cần approval, smoke test, monitoring window và rollback plan.
7. **Secret không nằm trong source code**: secret chỉ được lưu trong secret store của CI/CD, server hoặc secret manager.
8. **Quan sát được hệ thống**: log, metric, health check, alert và audit vận hành phải có từ MVP.
9. **Tự động hóa phần lặp lại**: build, test, scan, migration, deploy và smoke test nên chuẩn hóa bằng pipeline/script.
10. **Có checklist rõ ràng**: mỗi bước release phải có điều kiện pass/fail để tránh quyết định cảm tính.

## 5. Service container trong MVP

| Service | Bắt buộc MVP | Vai trò |
| --- | --- | --- |
| `frontend-web` | Có | Serve web app hoặc static build qua Nginx |
| `backend-api` | Có | REST API, authentication, business logic |
| `worker` | Nên có | Background jobs: notification, cache, scheduled tasks |
| `postgres` | Có ở local/dev; production có thể managed | Database chính |
| `valkey` | Nên có | Cache, queue, rate limit nếu dùng |
| `reverse-proxy` | Có staging/prod | SSL termination, routing, security headers |
| `monitoring-agent` | Nên có | Log/metric/error tracking |

## 6. Nguyên tắc Dockerfile

1. Dùng multi-stage build để image nhỏ và an toàn hơn.
2. Không copy `.env`, secret, private key vào image.
3. Không chạy container bằng root nếu service cho phép.
4. Cố định version base image ở mức hợp lý, tránh tag quá mơ hồ.
5. Build output chỉ chứa file cần chạy production.
6. Có health check hoặc endpoint health cho orchestrator kiểm tra.
7. Log ra stdout/stderr, không ghi log chỉ trong file nội bộ container.
8. Tối ưu layer cache bằng cách copy lockfile trước khi install dependency.
9. Không dùng `latest` cho production deploy.
10. Có `.dockerignore` để tránh đưa file không cần thiết vào build context.

## 7. Dockerfile backend API mẫu

Giả định backend dùng Node.js/TypeScript. Nếu backend stack khác, nguyên tắc vẫn giữ tương tự.

```Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### 7.1 Backend runtime requirements

| Nhóm | Biến/requirement |
| --- | --- |
| HTTP | `PORT`, `APP_ENV`, `APP_BASE_URL` |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, token TTL |
| DB | `DATABASE_URL` hoặc host/user/password/db riêng |
| Valkey | `VALKEY_URL` nếu dùng cache/queue |
| File | `STORAGE_DRIVER`, bucket/path, signed URL secret |
| Observability | `LOG_LEVEL`, `SENTRY_DSN` nếu dùng |

## 8. Dockerfile worker mẫu

Worker có thể dùng cùng image backend nhưng command khác.

```Dockerfile
FROM ems-backend-api:${IMAGE_TAG} AS runner
CMD ["node", "dist/worker.js"]
```

Hoặc dùng cùng image và override command trong Compose:

```yaml
worker:
  image: registry.example.com/ems-backend-api:${IMAGE_TAG}
  command: ["node", "dist/worker.js"]
```

## 9. Dockerfile frontend mẫu

### 9.1 Build static bằng Nginx

```Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 9.2 Lưu ý frontend environment

Frontend static thường cần cấu hình build-time như:

```text
VITE_API_BASE_URL
VITE_APP_ENV
VITE_SENTRY_DSN
VITE_FEATURE_FLAGS
```

Nếu muốn runtime config không rebuild image, có thể dùng `config.json` được inject khi container start.

## 10. `.dockerignore` khuyến nghị

```text
node_modules
.git
.github
.env
.env.*
!.env.example
coverage
dist
build
.cache
.DS_Store
*.log
private_key*
*.pem
```

## 11. Docker Compose local

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ems_local
      POSTGRES_USER: ems
      POSTGRES_PASSWORD: ems_local_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ems -d ems_local"]
      interval: 10s
      timeout: 5s
      retries: 5

  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - "6379:6379"

  backend-api:
    build:
      context: ./apps/backend-api
    env_file:
      - ./env/local/backend.env
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_started

  frontend-web:
    build:
      context: ./apps/frontend-web
    ports:
      - "5173:80"
    depends_on:
      - backend-api

volumes:
  postgres_data:
```

## 12. Docker Compose staging/production nhỏ

Production nhỏ có thể dùng Docker Compose trên một VM nhưng cần:

1. Reverse proxy với SSL thật.
2. Không expose database/valkey ra internet.
3. Volume hoặc object storage backup được.
4. Health check cho API và frontend.
5. Restart policy.
6. Image pull từ registry theo tag cụ thể.
7. Log driver hoặc agent thu log.
8. Deploy script có backup/migration/smoke test.

```yaml
services:
  reverse-proxy:
    image: traefik:v3.1
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - proxy_certs:/letsencrypt

  backend-api:
    image: registry.example.com/ems-backend-api:${IMAGE_TAG}
    restart: unless-stopped
    env_file:
      - /opt/ems/env/backend.env
    networks:
      - internal
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  frontend-web:
    image: registry.example.com/ems-frontend-web:${IMAGE_TAG}
    restart: unless-stopped
    networks:
      - internal

networks:
  internal:

volumes:
  proxy_certs:
```

## 13. Image registry và tag convention

### 13.1 Registry

| Môi trường | Registry |
| --- | --- |
| Local | Local Docker daemon |
| Development | Internal registry hoặc GitHub/GitLab registry |
| Staging/UAT | Registry có quyền pull từ deploy server |
| Production | Registry có access control chặt, chỉ deploy runner/server pull |

### 13.2 Tag image

```text
<service>:<git_short_sha>
<service>:<environment>-<git_short_sha>
<service>:v<major>.<minor>.<patch>
```

Ví dụ:

```text
ems-backend-api:a1b2c3d
ems-backend-api:staging-a1b2c3d
ems-backend-api:v1.0.0
```

Production phải deploy bằng tag immutable.

## 14. Container network

| Network | Service | Expose public |
| --- | --- | --- |
| `public` | Reverse proxy | Có |
| `internal` | Backend, frontend, worker | Không trực tiếp |
| `data` | Postgres, Valkey | Không |

Nguyên tắc:

1. Database không public port ở staging/production.
2. Valkey không public port ở staging/production.
3. Backend chỉ public qua reverse proxy.
4. Internal service gọi nhau bằng service name/network nội bộ.

## 15. Volume và file storage

| Loại dữ liệu | Local/dev | Production MVP |
| --- | --- | --- |
| Postgres data | Docker volume | Managed DB hoặc volume backup nghiêm ngặt |
| Uploaded files | Local volume | Object storage khuyến nghị |
| Proxy cert | Docker volume | Volume backup được |
| Logs | stdout/stderr | Log collector |

Không lưu file upload quan trọng chỉ trong container layer vì khi redeploy có thể mất.

## 16. Health check

| Service | Health check |
| --- | --- |
| Backend API | `GET /health` hoặc `/api/v1/health` |
| Worker | Process heartbeat hoặc job heartbeat |
| Frontend | HTTP 200 trang root hoặc `/healthz` |
| Postgres | `pg_isready` |
| Valkey | `valkey-cli ping` |
| Reverse proxy | HTTP route health |

Backend health nên tách:

| Endpoint | Mục đích |
| --- | --- |
| `/health/live` | Process còn sống |
| `/health/ready` | Sẵn sàng nhận request, DB/Valkey ok |
| `/health/version` | Trả app version, commit SHA, build time |

## 17. Security hardening cho image

1. Không chạy root nếu không cần.
2. Không cài tool debug không cần thiết trong production image.
3. Không đưa source map public nếu có dữ liệu nhạy cảm hoặc policy không cho phép.
4. Scan image trong CI.
5. Update base image định kỳ.
6. Gắn label metadata: service, version, commit, build time.
7. Không bake secret vào image layer.
8. Dùng read-only filesystem nếu service phù hợp.
9. Giới hạn capability nếu dùng orchestrator hỗ trợ.
10. Thiết lập resource limit ở production.

## 18. Resource limit khuyến nghị ban đầu

| Service | CPU | Memory | Ghi chú |
| --- | --- | --- | --- |
| `frontend-web` | 0.25-0.5 CPU | 128-256MB | Nginx/static |
| `backend-api` | 1-2 CPU | 512MB-1GB | Tùy tải API |
| `worker` | 0.5-1 CPU | 256-512MB | Tùy job |
| `postgres` | 2 CPU | 2-4GB | Nếu self-host |
| `valkey` | 0.5 CPU | 256-512MB | Cache/queue MVP |

Thông số cần điều chỉnh sau load test ở QA-07.

## 19. Local developer workflow

```text
copy env/local/*.env.example -> env/local/*.env
  -> docker compose up -d postgres valkey
  -> run migration/seed
  -> docker compose up backend-api frontend-web
  -> open frontend local
  -> run smoke test local
```

Dev có thể chạy backend/frontend native để hot reload, nhưng database/valkey nên chạy bằng Docker để đồng nhất.

## 20. Checklist triển khai DEVOPS-03

### 20.1 Dockerfile checklist

- [ ] Backend Dockerfile multi-stage.
- [ ] Frontend Dockerfile multi-stage.
- [ ] Worker command rõ ràng.
- [ ] Không copy `.env` và secret vào image.
- [ ] Có `.dockerignore`.
- [ ] Container không chạy root nếu có thể.
- [ ] Có health check.
- [ ] Image build được trong CI.

### 20.2 Compose checklist

- [ ] Có Compose local.
- [ ] Có Compose staging/production nhỏ hoặc template tương đương.
- [ ] Database/Valkey không expose public ở staging/prod.
- [ ] Có volume cho data cần giữ.
- [ ] Có network tách public/internal/data.
- [ ] Có restart policy.
- [ ] Có env file theo môi trường.

### 20.3 Image checklist

- [ ] Image tag theo SHA/version.
- [ ] Không dùng `latest` ở production.
- [ ] Image push lên registry bảo mật.
- [ ] Image scan critical vulnerability.
- [ ] Có label metadata.

## 21. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Image chứa secret | Lộ dữ liệu | `.dockerignore`, review, secret scan |
| Container chạy root | Tăng rủi ro khai thác | Non-root user |
| DB expose internet | Rò rỉ/hack DB | Network private, firewall |
| Dùng `latest` | Không rollback được | Tag immutable |
| Volume không backup | Mất dữ liệu | Backup volume/object storage |
| Local khác production | Lỗi khi deploy | Docker Compose đồng nhất |

## 22. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO03-OQ-001 | Backend stack production chính xác là gì để chốt Dockerfile cuối? | Backend Lead | Cao |
| DO03-OQ-002 | Frontend dùng static Nginx hay SSR runtime? | Frontend Lead | Cao |
| DO03-OQ-003 | Production MVP dùng self-host Postgres hay managed DB? | DevOps/Tech Lead | Cao |
| DO03-OQ-004 | Object storage dùng S3-compatible provider nào? | DevOps | Trung bình |
| DO03-OQ-005 | Có yêu cầu image signing không? | Security/DevOps | Thấp |

## 99. Tiêu chí nghiệm thu DEVOPS-03

| STT | Tiêu chí | Bắt buộc MVP |
| --- | --- | --- |
| 1 | Tài liệu nêu rõ mục tiêu, phạm vi và không phạm vi | Có |
| 2 | Có quy trình triển khai hoặc vận hành cụ thể | Có |
| 3 | Có checklist cho DevOps/Backend/Frontend/QA | Có |
| 4 | Có rule tách biệt môi trường local/dev/staging/production | Có |
| 5 | Có kiểm soát bảo mật, secret, permission hoặc access nếu liên quan | Có |
| 6 | Có rollback/fallback hoặc cách xử lý lỗi nếu liên quan | Có |
| 7 | Có mapping với QA/release readiness nếu liên quan | Có |
| 8 | Có open questions cần chốt trước production | Có |

---

## 100. Kết luận

**DEVOPS-03** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
