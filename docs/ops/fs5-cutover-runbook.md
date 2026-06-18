# FS-5 Cutover Runbook — Multi-subdomain SSO (Frontend split)

> **Trạng thái:** Domain prod ĐÃ chốt = `funtimemediacorp.com`. Hosting ĐÃ chốt = **Cloudflare Pages (SPA tĩnh) + Cloudflare Tunnel (API)**.
> Hạ tầng thật (provision DNS/SSL/Tunnel + bật deploy CI) vẫn cần chủ dự án thực thi — xem §9.
> **Hướng dẫn THỰC THI chi tiết từng bước (copy-paste):** [cloudflare-deploy-guide.md](./cloudflare-deploy-guide.md).
> Tài liệu nền: [frontend-split-plan.md](../frontend-split-plan.md) §6 Phase 5 + §7 (SSO design) · [.env.example](../../.env.example) (khối "FS-5 CUTOVER — TEMPLATE PROD").

---

## 1. Kiến trúc đích (sau cutover)

Một backend (`apps/api`) + nhiều SPA, mỗi SPA một **subdomain riêng**, dùng chung **một phiên SSO** (refresh
cookie `Domain=.funtimemediacorp.com` HttpOnly). Đổi app KHÔNG đăng nhập lại (silent-refresh ở web-core).

| App | Subdomain | Hosting | Vai trò | aud |
| --- | --- | --- | --- | --- |
| `apps/web` | `funtimemediacorp.com` (root) | Cloudflare Pages | **Launcher** — chọn app theo capability | user |
| `apps/auth` | `auth.funtimemediacorp.com` | Cloudflare Pages | Đăng nhập trung tâm + 2FA + set-password | — |
| `apps/studio` | `studio.funtimemediacorp.com` | Cloudflare Pages | work + process + goals | user |
| `apps/people` | `people.funtimemediacorp.com` | Cloudflare Pages | hr + attendance + payroll | user |
| `apps/console` | `console.funtimemediacorp.com` | Cloudflare Pages | system (company/platform-accounts/break-glass) | user |
| `apps/admin` | `admin.funtimemediacorp.com` | Cloudflare Pages | operator control plane (NGOÀI phạm vi FE-split) | operator |
| `apps/api` | `api.funtimemediacorp.com` | Cloudflare Tunnel → NestJS :3100 | NestJS modular monolith (1 backend) | — |

> `console` (tenant `aud=user`) TÁCH BẠCH `admin` (operator `aud=operator`, cross-tenant) — khác cổng auth.
> **Tất cả subdomain đều là một nhãn** (auth./studio./people./console./api.) → Cloudflare Universal SSL phủ
> được bằng `*.funtimemediacorp.com` (xem §3) → KHÔNG cần Advanced Certificate Manager.

---

## 2. DNS (Cloudflare)

Domain `funtimemediacorp.com` phải dùng **nameserver của Cloudflare** (Cloudflare dashboard → Add site → đổi NS
ở nhà đăng ký domain). Sau đó các bản ghi được tạo (gần như) tự động:

- **SPA (Cloudflare Pages):** khi gắn custom domain vào một Pages project, Cloudflare **tự tạo** bản ghi CNAME
  **proxied (orange cloud)** trỏ về `<project>.pages.dev`. Với apex (`funtimemediacorp.com`) Cloudflare dùng
  **CNAME flattening** (apex CNAME hợp lệ trên Cloudflare). Không cần A/AAAA tay.
- **API (Cloudflare Tunnel):** chạy `cloudflared tunnel route dns <tunnel-name> api.funtimemediacorp.com` →
  tạo CNAME **proxied** trỏ về `<tunnel-id>.cfargotunnel.com`. (Tunnel BẮT BUỘC proxied.)

Bản ghi đích (sau khi gắn xong, để đối chiếu trên dashboard):

```text
funtimemediacorp.com           CNAME (flatten, proxied)  web-mediaos.pages.dev       # launcher (apex)
auth.funtimemediacorp.com      CNAME (proxied)           auth-mediaos.pages.dev
studio.funtimemediacorp.com    CNAME (proxied)           studio-mediaos.pages.dev
people.funtimemediacorp.com    CNAME (proxied)           people-mediaos.pages.dev
console.funtimemediacorp.com   CNAME (proxied)           console-mediaos.pages.dev
api.funtimemediacorp.com       CNAME (proxied)           <tunnel-id>.cfargotunnel.com
# admin.funtimemediacorp.com   CNAME (proxied)           admin-mediaos.pages.dev      # operator plane (ngoài đợt này)
```

> Tên Pages project (`web-mediaos`…) tuỳ bạn đặt; phải khớp `--project-name` ở §6.

---

## 3. TLS (Cloudflare Universal SSL — KHÔNG cần Let's Encrypt/cert tay)

Cookie SSO yêu cầu `Secure` (HTTPS). Với mọi bản ghi **proxied**, Cloudflare tự cấp & auto-renew chứng chỉ
edge — không cần Caddy/cert-manager/DNS-01.

- **Universal SSL** phủ apex `funtimemediacorp.com` **+** wildcard một nhãn `*.funtimemediacorp.com`. Tất cả
  subdomain của ta là một nhãn → **được phủ sẵn**. (Chỉ subdomain ≥2 nhãn như `a.b.funtimemediacorp.com` mới
  cần Advanced Certificate Manager — ta KHÔNG có.)
- **SSL/TLS mode:** đặt **Full (strict)**. Origin của Pages đã là HTTPS; API qua Tunnel được `cloudflared`
  kết nối nội bộ (không mở cổng vào) nên Full(strict) an toàn.
- Bật **Always Use HTTPS** (thay redirect 80→443) + **HSTS** (SSL/TLS → Edge Certificates).
- `AUTH_COOKIE_SECURE=true` ở API (§5) — cookie chỉ gửi qua HTTPS, khớp edge.

---

## 4. Định tuyến (Cloudflare Pages + Tunnel — KHÔNG có reverse proxy tự host)

Không còn Caddy/nginx. Cloudflare đảm nhận routing + TLS ở edge.

**SPA (5 app):** mỗi app là một **Pages project** phục vụ `apps/<app>/dist`. Routing history-mode (SPA) cần
fallback về `index.html` cho route không khớp file tĩnh → thêm file `_redirects` vào output build mỗi app:

```text
# apps/<app>/public/_redirects  (Vite copy vào dist)
/*    /index.html   200
```

**API:** `cloudflared` chạy cạnh NestJS (cùng host/box), map ingress `api.` → `http://localhost:3100`:

```yaml
# /etc/cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.funtimemediacorp.com
    service: http://localhost:3100
  - service: http_status:404
```

> CORS/cookie do **NestJS** đặt (không phải Cloudflare). Cloudflare **không cache** response API có `Set-Cookie`
> (mặc định bypass cache cho method không-GET + cookie) → refresh/CSRF cookie đi qua nguyên vẹn.

---

## 5. Biến môi trường prod

Xem khối **"FS-5 CUTOVER — TEMPLATE PROD"** trong [.env.example](../../.env.example). Tóm tắt bất biến:

- **API** (`apps/api`, chạy trên host sau Tunnel): `AUTH_COOKIE_DOMAIN=.funtimemediacorp.com` (đầu `.`) ·
  `AUTH_COOKIE_SECURE=true` · `CORS_ORIGIN` = origin **tường minh** mọi subdomain (KHÔNG `*` vì credentials) ·
  `AUTH_REDIRECT_ALLOWLIST` = origin https thật (chống open-redirect, rủi ro #11) · `KMS_PROVIDER=vault`
  (prod KHÔNG KEK-in-file, ADR-0004).
- **VITE_\* nhúng lúc BUILD** từng app (build-time, không runtime — Vite inline vào bundle). Sai biến → app
  build ra trỏ sai origin. CI `apps-frontend.yml` đã tự suy từ `PROD_DOMAIN` (xem §6):
  - web (launcher): `VITE_API_URL`, `VITE_AUTH_APP_URL`, `VITE_{STUDIO,PEOPLE,CONSOLE}_URL`.
  - auth: `VITE_API_URL`, `VITE_DEFAULT_APP_URL=https://funtimemediacorp.com` (bounce về launcher).
  - studio/people/console: `VITE_API_URL`, `VITE_AUTH_APP_URL`.

> Vì CI build (không phải Cloudflare Pages build) nhúng VITE_*, deploy chỉ publish `dist` tĩnh (§6). KHÔNG cần
> đặt VITE_* trong Pages project settings.

---

## 6. CI per-app (build & deploy độc lập)

Mỗi app build & deploy riêng → đổi 1 app không phải rebuild cả monorepo. Pipeline mỗi app:

1. `pnpm install --frozen-lockfile`
2. Build package dùng chung TRƯỚC (apps tiêu thụ `dist`): `pnpm --filter @mediaos/contracts --filter @mediaos/web-core --filter @mediaos/ui build`
3. `pnpm --filter @mediaos/<app> build` **với VITE_\* prod của app đó nhúng vào env build**.
4. Deploy `apps/<app>/dist` → Cloudflare Pages project của app đó (xem dưới).

> **Tối ưu CI:** chỉ chạy job của app khi path của nó (hoặc package dùng chung) đổi — dùng path-filter
> (`apps/studio/**` + `packages/**`).

**✅ Đã dựng (WAVE 4 OPS):**

- [`.github/workflows/apps-frontend.yml`](../../.github/workflows/apps-frontend.yml) — matrix build per-app
  (web/auth/studio/people/console/admin) + path-filter (`dorny/paths-filter`): job `changes` phát hiện app
  nào đổi → job `build` chỉ build app đó (install → build shared `contracts`/`web-core`/`ui` → nhúng
  `VITE_*` prod theo app từ `vars.PROD_DOMAIN` → typecheck → test → build). **Deploy = PLACEHOLDER** (comment).
- [`.github/workflows/api.yml`](../../.github/workflows/api.yml) — pipeline API riêng (path-filter
  `apps/api/**` + `packages/contracts/**`): build/typecheck/migrate(ephemeral)/test trên Postgres service
  container; job `release` (chỉ push master) chạy `pnpm db:migrate` lên DB prod + deploy — **PLACEHOLDER**.
- `ci.yml` (sẵn có) GIỮ NGUYÊN làm cổng tích hợp CROSS-CUTTING (gate RLS-qua-PgBouncer GX-4 + build toàn
  workspace) chạy trên MỌI thay đổi — bổ trợ, KHÔNG thay 2 pipeline per-app ở trên.

**Bật deploy Cloudflare Pages (khi sẵn sàng):** trong `apps-frontend.yml`, thay step `Deploy placeholder`
bằng `wrangler pages deploy` (CI đã build sẵn `dist` kèm VITE_* đúng — chỉ publish tĩnh):

```yaml
- name: Deploy ${{ matrix.app }} → Cloudflare Pages
  if: github.event_name == 'push' && github.ref == 'refs/heads/master'
  run: npx wrangler@3 pages deploy "apps/${{ matrix.app }}/dist"
       --project-name "${{ matrix.app }}-mediaos" --branch main
  env:
    CLOUDFLARE_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}   # scope: Pages:Edit
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

> Tạo trước mỗi Pages project (1 lần): `wrangler pages project create <app>-mediaos --production-branch main`
> rồi gắn custom domain (§2). API (`apps/api`) KHÔNG lên Pages — deploy lên host chạy `cloudflared` (api.yml).
>
> **Cần điền khi vận hành thật (xem §9):** repo/環境 variable `PROD_DOMAIN=funtimemediacorp.com`; secret
> `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; DSN prod cho migrate (`secrets.PROD_DATABASE_DIRECT_URL`).

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

- [ ] Domain `funtimemediacorp.com` đã chuyển nameserver sang Cloudflare; site `Active`.
- [ ] 5 Pages project (web/auth/studio/people/console) tạo + gắn custom domain đúng (§2). API tunnel route DNS.
- [ ] SSL/TLS mode = **Full (strict)**; Always Use HTTPS + HSTS bật (§3). Universal SSL phủ apex + `*.` (Active).
- [ ] Mỗi app có `public/_redirects` (`/* /index.html 200`) → SPA fallback (§4).
- [ ] `cloudflared` chạy trên host API, ingress `api.` → `localhost:3100` (§4); API reachable qua HTTPS.
- [ ] API env prod: `AUTH_COOKIE_DOMAIN=.funtimemediacorp.com`, `AUTH_COOKIE_SECURE=true`, `CORS_ORIGIN` + `AUTH_REDIRECT_ALLOWLIST` đủ subdomain, `KMS_PROVIDER=vault`.
- [ ] CI: `vars.PROD_DOMAIN=funtimemediacorp.com` + secret `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`; bật step `wrangler pages deploy` (§6).
- [ ] Smoke: login ở `auth.` → bounce về launcher `funtimemediacorp.com` → mở studio/people/console KHÔNG login lại (SSO).
- [ ] Smoke: refresh-on-401 (đợi access token hết hạn → gọi API → silent-refresh) + logout toàn cục (1 app logout → app khác mất phiên ở refresh kế).
- [ ] Smoke: open-redirect — `?redirect=https://evil.example` bị từ chối (allowlist).
- [ ] Launcher: user role hẹp chỉ thấy tile app mình có quyền; click app không-quyền → đích tự 403/empty.

### Rollback

Cutover FE thuần (0 migration, 1 backend không đổi). Rollback = trong Cloudflare Pages **rollback deployment**
về bản trước (mỗi project giữ lịch sử deploy), hoặc trỏ custom domain về Pages project `web` cũ (monolith SPA).
API qua Tunnel không đổi schema → không có gì để hoàn tác phía DB.

---

## 9. Việc CHƯA làm — cần chủ dự án PROVISION (Cloudflare account + secret thật)

> CI per-app ĐÃ dựng (§6) tới bước build/test; deploy = placeholder. Phần dưới cần thao tác trên Cloudflare
> account + nạp secret — KHÔNG đẩy secret/token thật vào repo.

**Checklist provision (☐ = chủ dự án làm):**

- [x] **Domain prod** — `funtimemediacorp.com` (đã có). Đã bake vào `.env.example`, runbook, CI default.
- [ ] **Cloudflare site** — add `funtimemediacorp.com`, đổi nameserver ở nhà đăng ký, chờ `Active`.
- [ ] **Repo variable `PROD_DOMAIN`** — đặt `funtimemediacorp.com` (Settings → Secrets and variables →
      Actions → Variables). CI nhúng vào `VITE_*` lúc build (mặc định đã là `funtimemediacorp.com`).
- [ ] **Pages projects** (×5) — tạo `web/auth/studio/people/console -mediaos`, gắn custom domain (§2),
      thêm `public/_redirects` mỗi app (§4).
- [ ] **TLS** — SSL/TLS = Full (strict); Always Use HTTPS + HSTS; xác nhận Universal SSL Active (§3).
- [ ] **Cloudflare Tunnel** cho API — `cloudflared tunnel create` + `config.yml` ingress `api.` → :3100 +
      `tunnel route dns` (§4); chạy `cloudflared` như service trên host API.
- [ ] **API env prod** (§5): `AUTH_COOKIE_DOMAIN=.funtimemediacorp.com` · `AUTH_COOKIE_SECURE=true` ·
      `CORS_ORIGIN` + `AUTH_REDIRECT_ALLOWLIST` đủ subdomain (tường minh, KHÔNG `*`) · `KMS_PROVIDER=vault`.
- [ ] **Vault prod** cho KMS (bỏ KEK-in-file, ADR-0004): `KMS_VAULT_ADDR` + `KMS_VAULT_TOKEN` (từ secret manager).
- [ ] **Secret deploy CI** — `CLOUDFLARE_API_TOKEN` (scope Pages:Edit) + `CLOUDFLARE_ACCOUNT_ID`; bật step
      `wrangler pages deploy` (§6). Migrate prod cần `secrets.PROD_DATABASE_DIRECT_URL` (api.yml).
- [ ] **Smoke cutover** (chạy checklist §8): SSO 1-login dùng mọi subdomain · refresh-on-401 · logout toàn
      cục · chặn open-redirect · launcher gate theo capability.

**Rollback:** cutover FE thuần (0 schema change) → Pages rollback deployment (§8 Rollback).
