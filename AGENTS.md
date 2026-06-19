# AGENTS.md — MediaOS (contract gọn cho mọi agent)

> Cổng vào chuẩn cross-tool. Đọc file này TRƯỚC khi sửa code. Đầy đủ: [`CLAUDE.md`](CLAUDE.md).
> **Đang ở đâu / làm gì kế:** [`docs/STATUS.md`](docs/STATUS.md) (tự sinh). **Cách làm:** [`harness/README.md`](harness/README.md).

## 0. Vòng một phiên (luôn theo)

```
bash harness/init.sh     → mở phiên: đang ở đâu · làm gì · sửa ở đâu
   làm ĐÚNG 1 Work Order (item in_progress trong harness/backlog.mjs)
bash harness/check.sh    → lint + typecheck + test
bash harness/finish.sh   → cập nhật backlog · ghi handoff · commit-if-safe
```

## 1. 3 BẤT BIẾN — không bao giờ phá (ép bằng hook `.claude/hooks/`)

1. **`company_id` ở MỌI query** nghiệp vụ. Tenant isolation ép ở DB bằng **RLS + FORCE**, không dựa kỷ luật dev. Mọi repo qua `withTenant(companyId, fn)`.
2. **Không hard-delete** dữ liệu quan trọng (`deleted_at`). Bảng audit/snapshot (`audit_logs`, `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`…) **append-only** — app role không UPDATE/DELETE.
3. **Không secret plaintext.** Mật khẩu user → hash. Mật khẩu kênh → **envelope encryption + KMS**, mã hoá **app-side**, không log, không vào DTO role không quyền.

(BẤT BIẾN #4 — Task Hub hợp nhất: mọi nguồn việc → chung bảng `tasks`, phân biệt `task_type`.)

## 2. Luật phụ thuộc (thứ tự bắt buộc)

```
Audit + Event bus (outbox)  ──▶  trước mọi module
Permission engine           ──▶  trước module có dữ liệu nhạy cảm
Tenant isolation (RLS)      ──▶  policy + FORCE TRƯỚC khi backfill company_id
```

## 3. Tech stack (đã chốt — `docs/adr/`)

NestJS + TypeScript (modular monolith, `apps/api` DUY NHẤT) · PostgreSQL 16/17 + RLS · **Drizzle** (KHÔNG Prisma) ·
PgBouncer transaction-mode · Valkey + BullMQ · Vite + React 19 SPA + TanStack + Zustand · shadcn/ui + Tailwind v4 ·
TanStack Table v8 · `packages/contracts` (Zod = nguồn sự thật DTO). pnpm + Turborepo.

## 4. Quy tắc code

- **Backend**: logic ở Service; Repository lo DB; DTO validate input; mọi API check `company_id`; API nhạy cảm check permission; không hard-code workflow/role/phòng ban.
- **Frontend**: không hard-code permission (`<PermissionGate>` + `useCan()`); dữ liệu nhạy cảm **mask ở SERVER**; form có validation; table có pagination/filter.
- **File**: nhiều file nhỏ (200–400 dòng, max 800), theo feature/domain.
- **Realtime**: payload WS qua cùng DTO/masking như REST — cấm `io.emit` thẳng row.

## 5. Review gate phân tầng (chi tiết `harness/policy.md`)

- **FULL** (diff chạm permission/RLS/secret/payroll/audit/finance/migration): `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (+ `santa-method` crown-jewel). Model **Opus**. **Người chốt.**
- **LIGHT** (CRUD/UI thường): `typescript-reviewer` + `quality-gate`. Model **Sonnet**.
- **Test deny-path TRƯỚC** (RED) cho permission/workflow/payroll. Coverage ≥80%.
- KHÔNG vá triệu chứng: cấm `@ts-ignore`/`eslint-disable`/`catch{}` rỗng/sửa test cho khớp bug (hook ép).

## 6. Definition of Done

Code xong · migration nếu đổi DB · validate input · permission guard nếu cần · FE xử lý loading/error/empty ·
có test · **audit log nếu hành động quan trọng** · check xanh · không phá luồng chính · cập nhật `harness/backlog.mjs`.

## 7. Lệnh

```
pnpm dev | build | lint | typecheck | test | format     # turbo toàn workspace
pnpm db:up | db:down | db:migrate                        # hạ tầng + DB (Docker)
bash harness/init.sh | check.sh | finish.sh              # vòng đời phiên
node harness/gen-status.mjs                              # tái sinh docs/STATUS.md
```

> Điều phối đa-agent (decompose/route/review/escalate) khi cần: `.claude/workflows/parallel-lanes.mjs`.
