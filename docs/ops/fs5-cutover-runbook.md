# FS-5 Cutover Runbook — Multi-subdomain SSO (Frontend split)

> **Trạng thái:** SCAFFOLD — chưa land hạ tầng thật. Domain placeholder = `mediaos.example`.
> Thực thi runbook này KHI đã có domain prod + CI/CD thật. Thay mọi `mediaos.example` bằng domain thật.
> Tài liệu nền: [frontend-split-plan.md](../frontend-split-plan.md) §6 Phase 5 + §7 (SSO design) · [.env.example](../../.env.example) (khối "FS-5 CUTOVER — TEMPLATE PROD").

---

## 1. Kiến trúc đích (sau cutover)

Một backend (`apps/api`) + nhiều SPA, mỗi SPA một **subdomain riêng**, dùng chung **một phiên SSO** (refresh
cookie `Domain=.mediaos.example` HttpOnly). Đổi app KHÔNG đăng nhập lại (silent-refresh ở web-core).

| App | Subdomain | Vai trò | aud |
| --- | --- | --- | --- |
| `apps/web` | `mediaos.example` (root) | **Launcher** — chọn app theo capability | user |
| `apps/auth` | `auth.mediaos.example` | Đăng nhập trung tâm + 2FA + set-password | — |
| `apps/studio` | `studio.mediaos.example` | work + process + goals | user |
| `apps/people` | `people.mediaos.example` | hr + attendance + payroll | user |
| `apps/console` | `console.mediaos.example` | system (company/platform-accounts/break-glass) | user |
| `apps/admin` | `admin.mediaos.example` | operator control plane (NGOÀI phạm vi FE-split) | operator |
| `apps/api` | `api.mediaos.example` | NestJS modular monolith (1 backend) | — |

> `console` (tenant `aud=user`) TÁCH BẠCH `admin` (operator `aud=operator`, cross-tenant) — khác cổng auth.

---

## 2. DNS

Tạo bản ghi cho mỗi subdomain trỏ về load balancer / reverse proxy:

```
mediaos.example.            A/AAAA   <LB_IP>      # launcher (root)
api.mediaos.example.        A/AAAA   <LB_IP>
auth.mediaos.example.       A/AAAA   <LB_IP>
studio.mediaos.example.     A/AAAA   <LB_IP>
people.mediaos.example.     A/AAAA   <LB_IP>
console.mediaos.example.    A/AAAA   <LB_IP>
# admin.mediaos.example.    A/AAAA   <LB_IP>      # operator plane (ngoài đợt này)
```

Hoặc 1 wildcard `*.mediaos.example` + bản ghi root nếu LB phục vụ mọi subdomain.

---

## 3. TLS wildcard

Cookie SSO yêu cầu `Secure` (HTTPS) → cần chứng chỉ phủ MỌI subdomain.

- **Cấp:** `*.mediaos.example` **+** `mediaos.example` (wildcard KHÔNG phủ apex → cần cả hai SAN), hoặc cert riêng từng host.
- **Let's Encrypt:** wildcard cần **DNS-01 challenge** (không HTTP-01). Caddy/Traefik/cert-manter tự động hoá được.
- Bật **HSTS** + redirect 80→443 ở proxy.

---

## 4. Reverse proxy (ví dụ Caddy)

Mỗi subdomain phục vụ static bundle của app tương ứng; `api.` proxy về NestJS. SPA fallback `try_files → index.html`.

```caddyfile
mediaos.example            { root * /srv/web;     try_files {path} /index.html; file_server }
auth.mediaos.example       { root * /srv/auth;    try_files {path} /index.html; file_server }
studio.mediaos.example     { root * /srv/studio;  try_files {path} /index.html; file_server }
people.mediaos.example     { root * /srv/people;  try_files {path} /index.html; file_server }
console.mediaos.example    { root * /srv/console; try_files {path} /index.html; file_server }
api.mediaos.example        { reverse_proxy localhost:3100 }
```

Caddy tự xin TLS (DNS-01 cho wildcard nếu cấu hình DNS plugin). nginx tương đương: `location / { try_files $uri /index.html; }`.

---

## 5. Biến môi trường prod

Xem khối **"FS-5 CUTOVER — TEMPLATE PROD"** trong [.env.example](../../.env.example). Tóm tắt bất biến:

- **API:** `AUTH_COOKIE_DOMAIN=.mediaos.example` (đầu `.`) · `AUTH_COOKIE_SECURE=true` · `CORS_ORIGIN` =
  origin **tường minh** mọi subdomain (KHÔNG `*` vì credentials) · `AUTH_REDIRECT_ALLOWLIST` = origin https
  thật (chống open-redirect, rủi ro #11) · `KMS_PROVIDER=vault` (prod KHÔNG KEK-in-file, ADR-0004).
- **VITE_\* nhúng lúc BUILD** từng app (build-time, không runtime). Sai biến → app build ra trỏ sai origin.
  - web (launcher): `VITE_API_URL`, `VITE_AUTH_APP_URL`, `VITE_{STUDIO,PEOPLE,CONSOLE}_URL`.
  - auth: `VITE_API_URL`, `VITE_DEFAULT_APP_URL=https://mediaos.example` (bounce về launcher).
  - studio/people/console: `VITE_API_URL`, `VITE_AUTH_APP_URL`.

---

## 6. CI per-app (build & deploy độc lập)

Mỗi app build & deploy riêng → đổi 1 app không phải rebuild cả monorepo. Pipeline mỗi app:

1. `pnpm install --frozen-lockfile`
2. Build package dùng chung TRƯỚC (apps tiêu thụ `dist`): `pnpm --filter @mediaos/contracts --filter @mediaos/web-core --filter @mediaos/ui build`
3. `pnpm --filter @mediaos/<app> build` **với VITE_\* prod của app đó nhúng vào env build**.
4. Publish `apps/<app>/dist` → host của subdomain đó (CDN/Caddy root).

> **Tối ưu CI:** chỉ chạy job của app khi path của nó (hoặc package dùng chung) đổi — dùng path-filter
> (`apps/studio/**` + `packages/**`).

**✅ Đã dựng (WAVE 4 OPS):**

- [`.github/workflows/apps-frontend.yml`](../../.github/workflows/apps-frontend.yml) — matrix build per-app
  (web/auth/studio/people/console/admin) + path-filter (`dorny/paths-filter`): job `changes` phát hiện app
  nào đổi → job `build` chỉ build app đó (install → build shared `contracts`/`web-core`/`ui` → nhúng
  `VITE_*` prod theo app → typecheck → test → build). **Deploy = PLACEHOLDER** (comment) tới khi chốt host.
- [`.github/workflows/api.yml`](../../.github/workflows/api.yml) — pipeline API riêng (path-filter
  `apps/api/**` + `packages/contracts/**`): build/typecheck/migrate(ephemeral)/test trên Postgres service
  container; job `release` (chỉ push master) chạy `pnpm db:migrate` lên DB prod + deploy — **PLACEHOLDER**.
- `ci.yml` (sẵn có) GIỮ NGUYÊN làm cổng tích hợp CROSS-CUTTING (gate RLS-qua-PgBouncer GX-4 + build toàn
  workspace) chạy trên MỌI thay đổi — bổ trợ, KHÔNG thay 2 pipeline per-app ở trên.

> **Cần điền khi vận hành thật (xem §9):** repo/環境 variable `PROD_DOMAIN` (thay placeholder `mediaos.example`),
> bước deploy + secret host (`DEPLOY_TOKEN`), DSN prod cho migrate (`secrets.PROD_DATABASE_DIRECT_URL`).

---

## 7. Dev local nhiều subdomain (`*.localhost`)

`*.localhost` tự phân giải về `127.0.0.1` trên hầu hết OS (không cần sửa `hosts`). Mỗi app vite đã set
`allowedHosts:[".localhost"]` + port riêng. Chạy `pnpm dev` (hoặc từng `pnpm --filter @mediaos/<app> dev`) rồi mở:

| URL dev | App |
| --- | --- |
| http://web.localhost:5273 | launcher |
| http://auth.localhost:5275 | đăng nhập |
| http://studio.localhost:5276 | studio |
| http://people.localhost:5277 | people |
| http://console.localhost:5278 | console |
| http://api.localhost:3100 | api |

Dev cookie `Domain=localhost` (xem `.env.example` `AUTH_COOKIE_DOMAIN=localhost`) share cho mọi `*.localhost`
→ SSO chạy giống prod. (Nếu OS không phân giải `*.localhost`, thêm vào `hosts`.)

---

## 8. Checklist cutover

- [ ] DNS 6 subdomain (+ apex) trỏ LB.
- [ ] TLS wildcard `*.mediaos.example` + apex cấp & auto-renew; HSTS + 80→443.
- [ ] Reverse proxy route từng subdomain → bundle app; `api.` → NestJS; SPA fallback index.html.
- [ ] API env prod: `AUTH_COOKIE_DOMAIN=.mediaos.example`, `AUTH_COOKIE_SECURE=true`, `CORS_ORIGIN` + `AUTH_REDIRECT_ALLOWLIST` đủ subdomain, `KMS_PROVIDER=vault`.
- [ ] Build mỗi app với VITE_* prod đúng; deploy lên subdomain của nó.
- [ ] Smoke: login ở `auth.` → bounce về launcher `mediaos.example` → mở studio/people/console KHÔNG login lại (SSO).
- [ ] Smoke: refresh-on-401 (đợi access token hết hạn → gọi API → silent-refresh) + logout toàn cục (1 app logout → app khác mất phiên ở refresh kế).
- [ ] Smoke: open-redirect — `?redirect=https://evil.example` bị từ chối (allowlist).
- [ ] Launcher: user role hẹp chỉ thấy tile app mình có quyền; click app không-quyền → đích tự 403/empty.

### Rollback

Cutover FE thuần (0 migration, 1 backend không đổi). Rollback = trỏ DNS/proxy về deployment `apps/web` cũ
(monolith SPA) HOẶC giữ bản build trước mỗi subdomain và swap lại. Không có thay đổi schema để hoàn tác.

---

## 9. Việc CHƯA làm — cần QUYẾT ĐỊNH OPS của chủ dự án (KHÔNG code được)

> CI per-app ĐÃ dựng (§6) nhưng chỉ tới bước build/test; phần dưới cần người chốt hạ tầng + secret thật.
> Phiên WAVE 4 OPS chỉ chuẩn bị template/placeholder, KHÔNG provision (KHÔNG đẩy secret/domain thật vào repo).

**Quyết định cần chốt (☐ = chủ dự án điền):**

- [ ] **Domain prod thật** — thay mọi `mediaos.example`. Đặt **GitHub repo/環境 variable `PROD_DOMAIN`** (CI
      `apps-frontend.yml` nhúng vào `VITE_*` lúc build). Cập nhật `.env.example` khối "FS-5 CUTOVER" + §5 ở trên.
- [ ] **DNS** — 6 subdomain (web/auth/studio/people/console + api) + apex trỏ LB (§2). Hoặc wildcard
      `*.<domain>` + apex.
- [ ] **TLS wildcard** `*.<domain>` **+** apex (wildcard không phủ apex) — Let's Encrypt **DNS-01** / Caddy /
      cert-manager. Bật HSTS + redirect 80→443 (§3).
- [ ] **Reverse proxy** route subdomain → bundle SPA; `api.` → NestJS :3100; SPA fallback `index.html`
      (mẫu Caddyfile §4).
- [ ] **API env prod** (§5): `AUTH_COOKIE_DOMAIN=.<domain>` · `AUTH_COOKIE_SECURE=true` · `CORS_ORIGIN` +
      `AUTH_REDIRECT_ALLOWLIST` đủ subdomain (tường minh, KHÔNG `*`) · `KMS_PROVIDER=vault`.
- [ ] **Vault prod** cho KMS (bỏ KEK-in-file, ADR-0004): `KMS_VAULT_ADDR` + `KMS_VAULT_TOKEN` (từ secret manager).
- [ ] **Host + secret deploy** — bật bước deploy (đang PLACEHOLDER) trong `apps-frontend.yml` + `api.yml`:
      chọn host (CDN/S3/Caddy), thêm secret `DEPLOY_TOKEN`; migrate prod cần `secrets.PROD_DATABASE_DIRECT_URL`.
- [ ] **Smoke cutover** (chạy checklist §8): SSO 1-login dùng mọi subdomain · refresh-on-401 · logout toàn
      cục · chặn open-redirect · launcher gate theo capability.

**Rollback:** cutover FE thuần (0 schema change) → trỏ DNS/proxy về deployment cũ (§8 Rollback).
