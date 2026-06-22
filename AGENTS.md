# AGENTS.md — Hệ thống Quản lý Doanh nghiệp (contract gọn cho mọi agent)

> Cổng vào chuẩn cross-tool. Đọc file này TRƯỚC khi sửa code. Đầy đủ: [`CLAUDE.md`](CLAUDE.md).
> **Nguồn sự thật sản phẩm = bộ `docs/`** — chỉ mục trung tâm [`docs/README.md`](docs/README.md) (mỗi module ghép cặp qua PRD · SPEC · DB · API · UI · FRONTEND · BACKEND · QA). Định hướng cấp cao: [`PRD-00`](<docs/PRD/PRD-00 Enterprise Management System .md>). Đặc tả nghiệp vụ: [`docs/SPEC/`](docs/SPEC/) (SPEC-01…08). **KHÔNG chỉ đọc SPEC** — cần schema/API/impl/test thì tra `docs/README.md` để ra đúng nhóm tài liệu.
> **Đang ở đâu / làm gì kế:** [`docs/STATUS.md`](docs/STATUS.md) (tự sinh). **Cách làm:** [`harness/README.md`](harness/README.md).

## 0. Vòng một phiên (luôn theo)

```text
bash harness/init.sh     → mở phiên: đang ở đâu · làm gì · sửa ở đâu
   làm ĐÚNG 1 Work Order (item in_progress trong harness/backlog.mjs)
bash harness/check.sh    → lint + typecheck + test
bash harness/finish.sh   → cập nhật backlog · ghi handoff · commit-if-safe
```

## 1. Dự án

**Hệ thống quản lý doanh nghiệp nội bộ** (Enterprise Management System) — đơn-công-ty (N=1), modular monolith + API-first. MVP = **AUTH · HR · ATT · LEAVE · TASK · DASH · NOTI** (bản đồ ghép cặp PRD · SPEC · DB · API · UI · FRONTEND · BACKEND · QA theo module ở [`docs/README.md`](docs/README.md) §9). KHÔNG còn media/kênh/content; payroll/finance/KPI/SaaS/operator-plane là hướng cũ đã **park (out-of-scope)**, đang dọn dần — lấy bộ `docs/` làm chuẩn khi mâu thuẫn với code cũ.

## 2. 3 BẤT BIẾN — không bao giờ phá (ép bằng hook `.claude/hooks/`)

1. **`company_id` ở MỌI query** nghiệp vụ. Cô lập ở DB bằng **RLS + FORCE**, không dựa kỷ luật dev. Mọi repo qua `withTenant(companyId, fn)`. _Chạy ở N=1; hạ tầng giữ để sẵn sàng mở rộng._
2. **Không hard-delete** dữ liệu quan trọng (`deleted_at`). Bảng **audit/snapshot append-only** — app role không UPDATE/DELETE. Hiện: `audit_logs` (+ các bảng log/ledger: `attendance_audit_logs`, `task_activity_logs`, `leave_balance_transactions`, `notification_logs`…). _(Phase 2 thêm `payslips`/`kpi_results` khi build.)_
3. **Không secret plaintext.** Mật khẩu user → **hash**. Secret hệ thống → env/secret manager, không log, không vào DTO role không quyền.

## 3. Luật phụ thuộc (thứ tự bắt buộc)

```text
Audit + Event bus (outbox)  ──▶  trước mọi module ghi dữ liệu
Permission engine           ──▶  trước module có dữ liệu nhạy cảm
Tenant isolation (RLS)      ──▶  policy + FORCE TRƯỚC khi backfill company_id
```

## 4. Tech stack (đã chốt — `docs/DECISIONS/`)

NestJS + TypeScript (modular monolith, `apps/api` DUY NHẤT) · PostgreSQL 16/17 + RLS · **Drizzle** (KHÔNG Prisma) ·
PgBouncer transaction-mode · Valkey + BullMQ · Vite + React 19 SPA + TanStack + Zustand · shadcn/ui + Tailwind v4 ·
TanStack Table v8 · `packages/contracts` (Zod = nguồn sự thật DTO). pnpm + Turborepo.

## 5. Quy tắc code

- **Backend**: logic ở Service; Repository lo DB; DTO validate input; mọi API check `company_id`; API nhạy cảm check permission; không hard-code role/phòng ban/workflow.
- **Frontend**: không hard-code permission (`<PermissionGate>` + `useCan()`); dữ liệu nhạy cảm **mask ở SERVER**; form có validation; table có pagination/filter.
- **Realtime**: payload WS qua cùng DTO/masking như REST — cấm `io.emit` thẳng row.
- **File**: nhiều file nhỏ (200–400 dòng, max 800), theo feature/domain.
- **Mã quy ước** (SPEC-01 §9): quyền `MODULE.RESOURCE.ACTION` · API `MODULE-API-XXX` · lỗi `MODULE-ERR-XXX` · event `NOTI-EVENT-XXX`.

## 6. Review gate phân tầng (chi tiết `harness/policy.md`)

- **FULL** (diff chạm permission/RLS/secret/audit/auth/migration): `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (+ `santa-method` crown-jewel). Model **Opus**. **Người chốt.**
- **LIGHT** (CRUD/UI thường): `typescript-reviewer` + `quality-gate`. Model **Sonnet**.
- **Test deny-path TRƯỚC** (RED) cho permission + workflow phê duyệt (nghỉ phép, điều chỉnh công). Coverage ≥80%.
- KHÔNG vá triệu chứng: cấm `@ts-ignore`/`eslint-disable`/`catch{}` rỗng/sửa test cho khớp bug (hook ép).

## 7. Definition of Done

Code xong · migration nếu đổi DB · validate input · permission guard nếu cần · FE xử lý loading/error/empty ·
có test · **audit log nếu hành động quan trọng** · check xanh · không phá luồng chính · cập nhật `harness/backlog.mjs`.

## 8. Lệnh

```text
pnpm dev | build | lint | typecheck | test | format     # turbo toàn workspace
pnpm db:up | db:down | db:migrate                        # hạ tầng + DB (Docker)
bash harness/init.sh | check.sh | finish.sh              # vòng đời phiên
node harness/gen-status.mjs                              # tái sinh docs/STATUS.md
```

> Điều phối đa-agent (decompose/route/review/escalate) khi việc đỏ/phức tạp: `.claude/workflows/parallel-lanes.mjs`.
