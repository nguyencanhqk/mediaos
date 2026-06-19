# CLAUDE.md — MediaOS

> Hợp đồng vận hành cho mọi phiên Claude Code làm việc trên dự án này.
> Đọc file này TRƯỚC khi sửa code. Các quy tắc ở đây **ghi đè** thói quen mặc định.

---

## 1. Dự án là gì

**MediaOS** — hệ thống quản trị nội bộ công ty media (~200 nhân sự, 100 kênh, 300 video/tháng), kiến trúc **Modular Monolith + API-first + SaaS-ready**. Sẽ mở rộng thành SaaS sau khi vận hành nội bộ ổn.

**HARNESS (cách làm việc — cập nhật 2026-06-19):** mở phiên bằng `bash harness/init.sh`. Contract gọn cross-tool: `AGENTS.md`. Cách làm + 6 cơ chế: `harness/README.md`. Luật tự động (zone→model/gate/autonomy + thang leo): `harness/policy.md`.

Điểm khởi đầu mỗi phiên — "đang ở đâu, làm gì tiếp": **`docs/STATUS.md` (TỰ SINH bởi `harness/gen-status.mjs` — KHÔNG sửa tay)**. Nguồn việc máy-đọc (Work Order): **`harness/backlog.mjs`** (thay cho tiến độ prose trong `TASKS.md` — `TASKS.md` còn lưu DAG/band lịch sử). Tài liệu thiết kế hợp nhất: `docs/SYSTEM-DESIGN.md`. ERD đầy đủ: `docs/erd-current.md`. Spec phân quyền: `docs/permission-matrix-spec.md`. Quyết định kiến trúc: `docs/adr/`.

> Bản gốc MVP v1 (PRD, ERD, design màn hình/workflow, role matrix, kế hoạch phase) đã được hợp nhất vào `docs/SYSTEM-DESIGN.md` và xóa khỏi repo (còn trong lịch sử git nếu cần tra cứu).

---

## 2. BẤT BIẾN — không bao giờ được phá

1. **`company_id` ở MỌI query** dữ liệu nghiệp vụ. Tenant isolation ép ở tầng DB bằng **RLS**, KHÔNG dựa vào kỷ luật dev. Mọi repository đi qua `withTenant(companyId, fn)`.
2. **Không hard-delete** dữ liệu quan trọng. Dùng `deleted_at` (soft delete). Bảng audit/snapshot (`audit_logs`, `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`, …) là **append-only** — app role không có quyền UPDATE/DELETE.
3. **Không secret plaintext.** Mật khẩu user → hash. Mật khẩu tài khoản kênh (`platform_accounts`) → **envelope encryption + KMS/Vault**, mã hóa **phía app**, không bao giờ pgcrypto-in-SQL, không log, không vào DTO của role không quyền.

> 3 bất biến này được ép tự động bởi hook trong `.claude/hooks/` (xem mục 6).

---

## 3. Luật phụ thuộc (thứ tự bắt buộc)

```text
Audit log + Event bus (outbox)  ──▶  PHẢI có trước mọi module
Permission engine               ──▶  trước mọi module có dữ liệu nhạy cảm
Tenant isolation (RLS)          ──▶  trước khi seed/backfill dữ liệu
```

- Không code module nhạy cảm (lương, tài khoản kênh, tài chính) khi `PermissionService` chưa xong.
- Migration: tạo **RLS policy + FORCE RLS TRƯỚC** khi backfill `company_id` (nếu không sẽ có cửa sổ rò rỉ chéo tenant).

---

## 4. Tech stack (đã chốt — xem `docs/adr/`)

| Tầng                 | Chọn                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend              | NestJS + TypeScript (modular monolith), `nestjs-zod`                                                                            |
| DB                   | PostgreSQL 16/17 self-host, **RLS** + FORCE, UUID PK                                                                            |
| ORM                  | **Drizzle** (KHÔNG Prisma — phá outbox + rò tenant trên pool)                                                                   |
| Pooling              | **PgBouncer transaction-mode** + `set_config('app.current_company_id', $1, true)`; pool direct riêng cho LISTEN/NOTIFY + BullMQ |
| Cache/Queue/Presence | **Valkey** + BullMQ                                                                                                             |
| Realtime             | NestJS WebSocketGateway + Socket.IO + Valkey adapter, room `co:{companyId}:…`                                                   |
| Secrets              | Envelope encryption + KMS/Vault (app-side)                                                                                      |
| Storage              | Cloudflare R2 / MinIO (qua `@aws-sdk/client-s3`)                                                                                |
| Frontend             | **Vite + React 19 SPA** (1 trust boundary) + TanStack Router/Query + Zustand                                                    |
| UI                   | **shadcn/ui** + Tailwind v4 + React Hook Form + Zod                                                                             |
| Data grid            | TanStack Table v8 (headless) — KHÔNG MUI X Pro/AG Grid Enterprise (bẫy license)                                                 |
| Workflow canvas      | React Flow / @xyflow/react                                                                                                      |
| Charts               | Recharts + Tremor                                                                                                               |
| i18n / TZ            | react-i18next (vi) + date-fns v4 + @date-fns/tz (UTC-at-rest)                                                                   |
| Monorepo             | pnpm + Turborepo; `packages/contracts` = Zod là nguồn sự thật DTO                                                               |

**Loại bỏ:** Supabase (service_role bypass RLS), Redis 8 (AGPL), Next.js cho admin (SSR rò dữ liệu nhạy cảm), Typesense (GPL-3).

---

## 5. Quy tắc code

**Backend:** business logic ở Service (không ở Controller); Repository/ORM lo DB; DTO validate input; mọi API check `company_id`; API nhạy cảm check permission; không hard-code workflow/role/phòng ban.

**Frontend:** không hard-code permission (dùng `<PermissionGate>` + `useCan()`); dữ liệu nhạy cảm **mask mặc định** (masking là việc của SERVER — client không nhận được thì không render được); form có validation; table có pagination/filter; status/text dùng constants chung.

**File:** nhiều file nhỏ (200–400 dòng, max 800), tổ chức theo feature/domain.

**Realtime:** payload WS PHẢI qua cùng DTO/masking layer như REST — cấm `io.emit` thẳng row.

---

## 6. Review gate PHÂN TẦNG (kiểm soát chi phí)

- **FULL gate** — diff chạm `permission / RLS / secret / payroll / audit`:
  `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` (+ `ecc:santa-method` cho logic crown-jewel).
- **LIGHT gate** — CRUD/UI thường:
  `ecc:typescript-reviewer` + `ecc:quality-gate`.
- **Test deny-path TRƯỚC** (RED) cho permission/workflow/payroll. Coverage ≥80% (ngưỡng riêng cho module nhạy cảm).

**Model routing (tự động trong `parallel-lanes`):** quyết định 2026-06-12 — **thận trọng chất lượng: KHÔNG dùng Haiku.**

| Loại việc | Phát hiện | Model | Plan-step |
| --- | --- | --- | --- |
| **Crown-jewel** | `tier:'crown'` HOẶC task khớp: lương/payroll/payslip · permission/RLS/policy · secret/envelope/encrypt/KMS · finance/revenue/cost/profit/ledger · KPI · workflow FSM/DAG · audit append-only · ADR | **Opus** | ✅ planner (Opus) lập micro-plan trước khi code |
| **Việc thường** (kể cả 🤖 CRUD/UI/docs) | mặc định | **Sonnet** | ❌ code thẳng |
| **Override tay** | `lane.model` (`'opus'\|'sonnet'\|'haiku'`) · `skipPlan:true` bỏ plan dù crown | dùng đúng giá trị | theo tier |

- Workflow `parallel-lanes` **tự gọi `pickModel()`** — không cần chọn tay. `gate` (FULL/LIGHT) **tách bạch** với model: gate quyết cường độ review, không quyết model.
- Xem trước quyết định không tốn token: bung `parallel-lanes` với `args.dryRun:true` → in bảng routing rồi dừng.
- Việc **solo 1 phiên** (không qua workflow): dùng skill `/ecc:model-route`.

**Agent/skill routing (tự động trong `parallel-lanes`) — Hybrid:** lane tự nhận đúng reviewer/skill/build-resolver theo domain của `task`.

| Domain (phát hiện trên `task`) | Reviewer / skill |
| --- | --- |
| DB · migration · RLS · schema · repository | `ecc:database-reviewer` |
| permission · secret · encrypt · payroll · audit · auth · **hoặc gate=FULL** | `ecc:security-reviewer` + `ecc:silent-failure-hunter` |
| FE · React · `.tsx` · component · form | `ecc:react-reviewer` |
| mọi lane có code (baseline) | `ecc:typescript-reviewer` |
| crown-jewel | + `ecc:santa-method` (review kép hội tụ) |
| mọi lane | + `ecc:quality-gate` |
| build/typecheck ĐỎ (auto-fix) | FE → `ecc:react-build-resolver` · API/TS → `ecc:build-error-resolver` |

- **Hybrid:** crown-jewel → workflow **spawn reviewer agent ĐỘC LẬP** trên diff (stage Review) + `santa-method`; verdict `CRITICAL`/`blocking` → ép `needs_human`. Việc thường → danh sách reviewer/skill **chèn vào prompt** để implementer tự chạy.
- **Auto build-fix:** build/typecheck đỏ → ưu tiên sửa root-cause hoặc route build-resolver TRƯỚC khi báo `needs_human` (cấm `@ts-ignore`/`eslint-disable`).
- **Override per-lane:** `reviewers:[...]` ép danh sách · `noReview:true` tắt. `dryRun:true` in cả reviewers/skills/build.

---

## 7. Lệnh dự án

> Cập nhật G1 (đã bootstrap). Node ≥20, pnpm 11. Lần đầu: `cp .env.example .env`.

```bash
pnpm install                       # cài deps (allowBuilds: esbuild/swc/nest)
pnpm dev                           # chạy api (:3100) + web (:5273) song song (turbo)
pnpm build                         # build contracts (dual ESM/CJS) + api (nest) + web (vite)
pnpm lint                          # eslint flat config toàn workspace
pnpm typecheck                     # tsc --noEmit (contracts build trước qua turbo)
pnpm test                          # vitest run mọi package (api dùng swc cho DI)
pnpm format                        # prettier --write .

# Hạ tầng + DB (cần Docker)
pnpm db:up                         # docker compose up -d (Postgres/PgBouncer/Valkey/MinIO)
pnpm db:down                       # docker compose down
pnpm --filter @mediaos/api db:generate   # drizzle-kit generate (sinh migration từ schema)
pnpm db:migrate                    # áp migration qua DATABASE_DIRECT_URL

# Lẻ từng app
pnpm --filter @mediaos/api dev|build|test|typecheck
pnpm --filter @mediaos/web dev|build|test|typecheck

# Backup (G1-8)
bash scripts/backup-db.sh          # pg_dump → encrypt → rclone offsite (xem .env BACKUP_*)
```

> **Cấu trúc (9 apps + 3 packages):** Backend `apps/api` (NestJS modular monolith — DUY NHẤT, không tách microservices). Frontend multi-SPA (Vite+React19, kết quả `docs/frontend-split-plan.md`): `apps/auth` (SSO đăng nhập trung tâm) · `apps/web` (launcher root-domain) · `apps/studio` (work/process/goals) · `apps/people` (hr/attendance/payroll) · `apps/console` (system tenant, `aud=user`) · `apps/admin` (operator plane, `aud=operator` — cross-tenant) · `apps/projects` (PM app kiểu Plane, backend dùng chung) · `apps/mobile` (Expo). Packages: `packages/contracts` (Zod = nguồn sự thật DTO, dual-build) · `packages/ui` (shadcn primitives + layout) · `packages/web-core` (auth store · api-client · use-can · i18n). Health: `GET /api/v1/health` + `/health/db` (fail-soft).

---

## 8. Definition of Done

Code xong · migration nếu đổi DB · validation input · permission guard nếu cần · FE xử lý loading/error/empty · có test · **audit log nếu hành động quan trọng** · QA pass · không phá luồng chính · cập nhật `TASKS.md`.

---

## 9. Vận hành SONG SONG (multi-lane) — cập nhật 2026-06-12

> Mô hình mặc định giờ là **fan-out song song**, KHÔNG còn "tuần tự 1 task". Chi tiết đầy đủ: `TASKS.md §5`. Hợp đồng tối thiểu mỗi phiên:

1. **1 worktree / 1 lane.** Làm trong worktree `mediaos-<lane>` của phase đó. **CẤM 2 phiên cùng working tree** (shared git index → hỏng commit chéo). Hook `guard-claim` **phát hiện sớm** khi hai phiên cùng giữ một Work Order (claim-on-touch theo `session_id`, sổ chung mọi worktree ở `.git/mediaos-claims/`) — warn-only; xem `node harness/claim.mjs list`.
2. **Band migration riêng.** Mỗi lane chỉ đánh số migration trong band của mình: G9 `0040s` · G10 `0050s` · G11 `0060s` · G13 `0070s` · G8 `0080s` · G12 `0090s` · G14 `0100s` · G15 `0110s` · G16 `0120s`. Hook `guard-migration-band` **chặn** file ngoài band.
3. **Hot-file = append, KHÔNG rewrite.** audit `object_types` CHECK = **UNION** mọi lane · permission seed `ON CONFLICT DO NOTHING` · `schema/index.ts`+`app.module.ts` khối additive · `tasks` **chỉ G9** đổi shape.
4. **Merge theo thứ tự phụ thuộc.** Land **G9-1 trunk** trước → rebase + gate + merge từng lane Wave A → rồi Wave B (G12/G14). Mỗi merge: chain migration `0000→latest` apply sạch + test xanh.
5. **Vòng tự động mỗi lane:** RED→GREEN→gate→checkpoint. Xanh + non-sensitive → auto-commit `wip(gN): …`; đỏ/CRITICAL/🛠️ → người chốt. Fan-out 1 lượt: Workflow `parallel-lanes`.
6. **DB CÔ LẬP mỗi lane (BẮT BUỘC khi verify có Postgres).** Mỗi lane chạy test trên DB riêng `mediaos_<lane>`, KHÔNG dùng chung `mediaos`. Lý do: drizzle migrator áp migration **đơn điệu theo `when`** → khi lane band cao (vd G8 `0080s`) đã migrate DB chung, mọi migration band thấp (`0050/0060/0070s`) bị **SKIP** vĩnh viễn ⇒ bảng vắng, test xanh-giả/đỏ-giả. Quy trình: `bash scripts/lane-db-setup.sh <lane>` (tạo + chain-migrate `0000→latest`) → `export LANE_DB=mediaos_<lane>` → `pnpm --filter @mediaos/api test`. `vitest.config.ts` đọc `LANE_DB` (không set → fallback `mediaos` chung cho CI ephemeral/master). `--reset` để làm lại sạch.
