# CLAUDE.md — Hệ thống Quản lý Doanh nghiệp nội bộ

> Hợp đồng vận hành cho mọi phiên Claude Code làm việc trên dự án này.
> Đọc file này TRƯỚC khi sửa code. Các quy tắc ở đây **ghi đè** thói quen mặc định.

---

## 1. Dự án là gì

**Hệ thống quản lý doanh nghiệp nội bộ** (internal Enterprise Management System) — nền tảng all-in-one số hóa nhân sự, chấm công, nghỉ phép, công việc, dashboard và thông báo cho một công ty, kiến trúc **Modular Monolith + API-first**. Đơn-công-ty (single-company) trước; có thể mở rộng đa-công-ty/SaaS về sau (SPEC-01 §24) nhưng **không phải mục tiêu hiện tại**.

> **Reframe 2026-06-20:** dự án đã **de-media-fy** — KHÔNG còn là OS cho công ty media. Các module media/kênh/video/content và tài chính-theo-kênh (revenue/cost/profit/KPI nội dung) **bị loại khỏi phạm vi sản phẩm**. Code media/finance đã build trước đây ở `apps/api` được **park (out-of-scope)**, không phát triển tiếp, không xóa ở đợt này.

**Nguồn sự thật nghiệp vụ = `docs/spec/`** (bộ SPEC-01…08 — rule/màn hình/mã lỗi, máy + người đọc). **Chỉ mục TOÀN BỘ tài liệu = `docs/README.md`** — §8 ghép cặp mỗi module qua SPEC · DB (schema) · API (endpoint) · BACKEND/FRONTEND (triển khai) · UI · QA (test case) · DEVOPS/DECISIONS; cần schema/API/impl/test thì tra README tìm đúng nhóm, **KHÔNG chỉ đọc SPEC**. MVP gồm 7 module lõi:

| Mã | Module | Spec |
| --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | SPEC-02 |
| HR | Quản lý nhân sự | SPEC-03 |
| ATT | Chấm công | SPEC-04 |
| LEAVE | Nghỉ phép | SPEC-05 |
| TASK | Công việc & dự án | SPEC-06 |
| DASH | Dashboard | SPEC-07 |
| NOTI | Thông báo hệ thống | SPEC-08 |

Sau MVP (thiết kế để mở rộng, CHƯA làm): PAYROLL · RECRUIT (Phase 2) · ASSET · ROOM (Phase 3) · CHAT · SOCIAL (Phase 4) · MOBILE · AI · INTEGRATION (Phase 5). Xem SPEC-01 §7, §25.

**HARNESS (cách làm việc):** mở phiên bằng `bash harness/init.sh`. Contract gọn cross-tool: `AGENTS.md`. Cách làm + cơ chế: `harness/README.md`. Luật tự động (zone→model/gate/autonomy + thang leo): `harness/policy.md`.

Điểm khởi đầu mỗi phiên — "đang ở đâu, làm gì tiếp": **`docs/STATUS.md` (TỰ SINH bởi `harness/gen-status.mjs` — KHÔNG sửa tay)**. Nguồn việc máy-đọc (Work Order): **`harness/backlog.mjs`**. Chỉ mục tài liệu đầy đủ: `docs/README.md` (kiến trúc BE/FE = `BACKEND-01`/`FRONTEND-01`). ERD: `docs/erd-current.md`. Phân quyền hợp nhất: `docs/permission-matrix-spec.md`. Quyết định kiến trúc/stack: `docs/DECISIONS/`.

> Chi tiết nghiệp vụ (màn hình, API, rule, test case, mã lỗi) sống ở `docs/spec/` — KHÔNG nhân bản vào các doc khác để tránh trôi (drift). Doc kiến trúc/ERD/permission chỉ tổng hợp tầng-trên và **trỏ về** spec.

---

## 2. BẤT BIẾN — không bao giờ được phá

1. **`company_id` ở MỌI query** dữ liệu nghiệp vụ. Cô lập dữ liệu ép ở tầng DB bằng **RLS + FORCE**, KHÔNG dựa vào kỷ luật dev. Mọi repository đi qua `withTenant(companyId, fn)`. _Hiện chạy ở N=1 (một công ty); hạ tầng giữ nguyên để sẵn sàng mở rộng — không tháo._
2. **Không hard-delete** dữ liệu quan trọng. Dùng `deleted_at` (soft delete — SPEC-01 §16.2). Bảng **audit/snapshot là append-only** — app role không có quyền UPDATE/DELETE. Bảng append-only hiện tại: `audit_logs`. _(Khi build PAYROLL/finance ở Phase 2, bổ sung `payslips`/`kpi_results`/… vào danh sách này.)_
3. **Không secret plaintext.** Mật khẩu user → **hash** (SPEC-01 §22.1, SPEC-02). Secret hệ thống (token tích hợp, khóa API…) → **env/secret manager**, không hard-code, không log, không vào DTO của role không quyền. _(Envelope-encryption/KMS chỉ áp dụng lại nếu Phase sau cần lưu credential bên thứ ba.)_

> 3 bất biến này được ép tự động bởi hook trong `.claude/hooks/` (xem mục 6).

---

## 3. Luật phụ thuộc (thứ tự bắt buộc)

```text
Audit log + Event bus (outbox)  ──▶  PHẢI có trước mọi module ghi dữ liệu
Permission engine               ──▶  trước mọi module có dữ liệu nhạy cảm
Tenant isolation (RLS)          ──▶  trước khi seed/backfill dữ liệu
```

- Không code module nhạy cảm (hồ sơ nhân sự, chấm công chi tiết, sau này là lương) khi `PermissionService` chưa sẵn.
- Migration: tạo **RLS policy + FORCE RLS TRƯỚC** khi backfill `company_id`.

---

## 4. Tech stack (đã chốt — xem `docs/DECISIONS/`)

| Tầng | Chọn |
| --- | --- |
| Backend | NestJS + TypeScript (modular monolith), `nestjs-zod` |
| DB | PostgreSQL 16/17 self-host, **RLS** + FORCE, UUID PK |
| ORM | **Drizzle** (KHÔNG Prisma — phá outbox + rò tenant trên pool) |
| Pooling | **PgBouncer transaction-mode** + `set_config('app.current_company_id', $1, true)`; pool direct riêng cho LISTEN/NOTIFY + BullMQ |
| Cache/Queue/Presence | **Valkey** + BullMQ |
| Realtime | NestJS WebSocketGateway + Socket.IO + Valkey adapter, room `co:{companyId}:…` |
| Storage | Cloudflare R2 / MinIO (qua `@aws-sdk/client-s3`) |
| Frontend | **Vite + React 19 SPA** + TanStack Router/Query + Zustand |
| UI | **shadcn/ui** + Tailwind v4 + React Hook Form + Zod |
| Data grid | TanStack Table v8 (headless) — KHÔNG MUI X Pro/AG Grid Enterprise (bẫy license) |
| Charts | Recharts + Tremor |
| i18n / TZ | react-i18next (vi) + date-fns v4 + @date-fns/tz (UTC-at-rest) |
| Monorepo | pnpm + Turborepo; `packages/contracts` = Zod là nguồn sự thật DTO |

**Loại bỏ:** Supabase (service_role bypass RLS), Redis 8 (AGPL), Next.js cho admin (SSR rò dữ liệu nhạy cảm), Typesense (GPL-3).

---

## 5. Quy tắc code

**Backend:** business logic ở Service (không ở Controller); Repository/ORM lo DB; DTO validate input; mọi API check `company_id`; API nhạy cảm check permission; không hard-code workflow/role/phòng ban.

**Frontend:** không hard-code permission (dùng `<PermissionGate>` + `useCan()`); dữ liệu nhạy cảm **mask mặc định** (masking là việc của SERVER — client không nhận được thì không render được); form có validation; table có pagination/filter; status/text dùng constants chung (theo trạng thái chuẩn SPEC-01 §17).

**File:** nhiều file nhỏ (200–400 dòng, max 800), tổ chức theo feature/domain.

**Realtime:** payload WS PHẢI qua cùng DTO/masking layer như REST — cấm `io.emit` thẳng row.

**Quy ước mã (SPEC-01 §9):** chức năng `MODULE-FUNC-XXX` · màn hình `MODULE-SCREEN-XXX` · API `MODULE-API-XXX` · quyền `MODULE.RESOURCE.ACTION` · lỗi `MODULE-ERR-XXX` · sự kiện thông báo `NOTI-EVENT-XXX`. Dùng đúng mã của spec khi đặt tên.

---

## 6. Review gate PHÂN TẦNG (kiểm soát chi phí)

- **FULL gate** — diff chạm `permission / RLS / secret / audit / auth / migration`:
  `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (+ `santa-method` cho logic crown-jewel).
- **LIGHT gate** — CRUD/UI thường:
  `typescript-reviewer` + `quality-gate`.
- **Test deny-path TRƯỚC** (RED) cho permission/workflow phê duyệt (nghỉ phép, điều chỉnh công). Coverage ≥80% (ngưỡng riêng cho module nhạy cảm).

**Model routing (tự động trong `parallel-lanes`):** quyết định "thận trọng chất lượng — KHÔNG dùng Haiku."

| Loại việc | Phát hiện | Model | Plan-step |
| --- | --- | --- | --- |
| **Crown-jewel** | `tier:'crown'` HOẶC task khớp: permission/RLS/policy · secret/encrypt/KMS · audit append-only · auth/token · workflow phê duyệt (FSM nghỉ phép/điều chỉnh công) · ADR · **(Phase 2: payroll/payslip)** | **Opus** | ✅ planner (Opus) lập micro-plan trước khi code |
| **Việc thường** (CRUD/UI/docs) | mặc định | **Sonnet** | ❌ code thẳng |
| **Override tay** | `lane.model` · `skipPlan:true` | dùng đúng giá trị | theo tier |

- Workflow `parallel-lanes` **tự gọi `pickModel()`** — không cần chọn tay. `gate` (FULL/LIGHT) **tách bạch** với model.
- Xem trước không tốn token: bung `parallel-lanes` với `args.dryRun:true`.
- Việc **solo 1 phiên**: dùng skill `/ecc:model-route` nếu có.

**Agent/skill routing (Hybrid) — lane tự nhận reviewer/skill theo domain của `task`:**

| Domain (phát hiện trên `task`) | Reviewer / skill |
| --- | --- |
| DB · migration · RLS · schema · repository | `database-reviewer` |
| permission · secret · encrypt · audit · auth · **hoặc gate=FULL** | `security-reviewer` + `silent-failure-hunter` |
| FE · React · `.tsx` · component · form | `react-reviewer` |
| mọi lane có code (baseline) | `typescript-reviewer` |
| crown-jewel | + `santa-method` (review kép hội tụ) |
| mọi lane | + `quality-gate` |
| build/typecheck ĐỎ (auto-fix) | FE → `react-build-resolver` · API/TS → `build-error-resolver` |

- **Auto build-fix:** build/typecheck đỏ → ưu tiên sửa root-cause hoặc route build-resolver TRƯỚC khi báo `needs_human` (cấm `@ts-ignore`/`eslint-disable`).
- **Override per-lane:** `reviewers:[...]` ép danh sách · `noReview:true` tắt. `dryRun:true` in cả reviewers/skills/build.

---

## 7. Lệnh dự án

> Node ≥20, pnpm 11. Lần đầu: `cp .env.example .env`.

```bash
pnpm install                       # cài deps (allowBuilds: esbuild/swc/nest)
pnpm dev                           # chạy api + web song song (turbo)
pnpm build                         # build contracts (dual ESM/CJS) + api (nest) + web (vite)
pnpm lint                          # eslint flat config toàn workspace
pnpm typecheck                     # tsc --noEmit (contracts build trước qua turbo)
pnpm test                          # vitest run mọi package
pnpm format                        # prettier --write .

# Hạ tầng + DB (cần Docker)
pnpm db:up                         # docker compose up -d (Postgres/PgBouncer/Valkey/MinIO)
pnpm db:down                       # docker compose down
pnpm --filter @mediaos/api db:generate   # drizzle-kit generate (sinh migration từ schema)
pnpm db:migrate                    # áp migration qua DATABASE_DIRECT_URL

# Lẻ từng app
pnpm --filter @mediaos/api dev|build|test|typecheck
pnpm --filter @mediaos/web dev|build|test|typecheck
```

> **Cấu trúc:** Backend `apps/api` (NestJS modular monolith — DUY NHẤT). Frontend Vite+React19 SPA: `apps/auth` (đăng nhập) · `apps/console` (quản trị hệ thống) · `apps/app` (vỏ nghiệp vụ hợp nhất). Packages: `packages/contracts` (Zod = nguồn sự thật DTO, dual-build) · `packages/ui` (shadcn primitives + layout) · `packages/web-core` (auth store · api-client · use-can · i18n). Health: `GET /api/v1/health` + `/health/db`.
>
> _Ghi chú: cây code hiện còn một số app/module của hướng cũ (media/finance/operator-plane) đang được park hoặc gộp dần — xem `harness/backlog.mjs`. Lấy `docs/spec/` làm chuẩn khi có mâu thuẫn._

---

## 8. Definition of Done

Code xong · migration nếu đổi DB · validation input · permission guard nếu cần · FE xử lý loading/error/empty · có test · **audit log nếu hành động quan trọng** (SPEC-01 §16.3) · QA pass · không phá luồng chính · cập nhật `harness/backlog.mjs`.

---

## 9. Vận hành — tuần tự 1 tính năng/phiên

> Mô hình mặc định (v2, owner 2026-06-19): **đơn giản hoá để KIỂM SOÁT** — làm tuần tự **đúng 1 Work Order/phiên**, không fan-out nhiều lane song song như giai đoạn build G1–G16 trước. Đa-agent chỉ bật khi việc đỏ/phức tạp (qua `parallel-lanes`).

1. **1 Work Order tại 1 thời điểm.** Item `in_progress` trong `harness/backlog.mjs`; sửa trong `paths` của nó (hook `guard-scope` cảnh báo khi ra ngoài).
2. **Migration đánh số tiếp tục** theo head hiện tại (xem STATUS). Tạo **RLS policy + FORCE TRƯỚC** backfill `company_id`.
3. **Hot-file = append, KHÔNG rewrite.** audit `object_types` CHECK = UNION · permission seed `ON CONFLICT DO NOTHING` · `schema/index.ts` + `app.module.ts` khối additive.
4. **Vòng tự động:** RED (deny-path test trước cho việc nhạy cảm) → GREEN → gate → checkpoint. Xanh + non-sensitive → auto-commit; đỏ/CRITICAL/nhạy cảm → người chốt.
5. **DB cô lập khi verify có Postgres:** chạy test trên DB riêng `bash scripts/lane-db-setup.sh <lane>` → `export LANE_DB=mediaos_<lane>` → `pnpm --filter @mediaos/api test`. Không set → fallback `mediaos`. Lý do: drizzle migrator áp migration đơn điệu theo `when` → DB chung bị skip migration band thấp ⇒ test xanh-giả/đỏ-giả.

---

## 10. Điều hướng code — codebase-memory MCP (tuỳ máy, KHÔNG bắt buộc)

> Tuỳ chọn dev-local: cấu hình qua `.mcp.json` (đã gitignore, đường dẫn binary theo máy) — KHÔNG phải máy nào cũng có.

**NẾU** phiên có MCP `codebase-memory` (xuất hiện tool `mcp__codebase-memory__*`): **ưu tiên** dùng nó để **định vị symbol · lần call-chain · map diff→symbol · tổng quan kiến trúc** TRƯỚC khi đọc dàn trải nhiều file — tiết kiệm token, điều hướng monolith nhanh hơn.

- Định vị: `search_graph` · impact trước khi sửa crown-jewel: `trace_path` · diff→symbol (ghép review gate): `detect_changes` · onboard: `get_architecture` · lấy đoạn theo symbol: `get_code_snippet`.
- Project index = **`C-dev-2-MediaOS`**. Index có thể CŨ → **re-index sau thay đổi lớn**: `codebase-memory-mcp cli index_repository '{"repo_path":"c:/dev 2/MediaOS"}'` (JSON dùng forward-slash `/`).
- Graph chỉ là **chỉ mục, KHÔNG thay nguồn sự thật** — khi cần độ chính xác từng dòng (đụng bất biến/permission/migration) vẫn xác minh bằng Read.

**NẾU KHÔNG** có MCP → dùng Grep/Read như thường, bỏ qua mục này.
