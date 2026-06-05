# MediaOS — MASTER PLAN MVP v1

> **Bản kế hoạch hợp nhất** (single source cho việc lập kế hoạch). Tổng hợp từ: PRD, ERD v2, Ma trận quyền, Thiết kế workflow/màn hình, Kế hoạch chia phase, 16 ADR, và `TASKS.md`.
> Khi mâu thuẫn: **`TASKS.md` (G-mã) > roadmap-mapping.md > Kế hoạch chia phase > PRD**. ERD chuẩn = **`docs/erd-v2.md`**.
> Cập nhật: 2026-06-05.

---

## 0. Phân biệt MVP-0 vs MVP v1 (quan trọng — hay nhầm)

| | **MVP-0** (G4) | **MVP v1** (G1→G16) |
| --- | --- | --- |
| Là gì | Lát cắt dọc mỏng: **1 video trọn vòng đời**, 1 workflow hard-code, pilot 1 team | **20 module đầy đủ**, sản phẩm vận hành nội bộ hoàn chỉnh |
| Phạm vi | 8 task (G4-1 → G4-8) | 16 G-phase theo 5 mốc release |
| Mục đích | Chứng minh hệ thống "sống" sau khi qua nền bảo mật | SaaS-ready nội bộ |

**Nguyên tắc vàng:** đạt MVP-0 (1 video chạy) **trước**, rồi mới bung đầy đủ. Đừng làm G5+ trước khi G4 xong.

---

## 1. Mục tiêu & phạm vi MVP v1

**MediaOS** = hệ quản trị nội bộ công ty media (~200 nhân sự · 100 kênh · 300 video/tháng). Modular Monolith + API-first + SaaS-ready.

**Có trong MVP v1 (20 module):** Auth · Org/Team/Position/Employee · Role/Permission · Channel/Platform Account · Project/Content/Asset · Workflow Builder · Task Hub · Approval/Revision/Defect · Evaluation/KPI · Chat/Notification/Meeting · Attendance/Leave · Payroll/Bonus · Finance (Revenue/Cost/Profit) · Dashboard · Mobile · Audit Log.

**Hoãn sau MVP v1:** SaaS billing/self-onboarding · YouTube/TikTok API tự động · AI analytics nâng cao · LMS/ATS · white-label · marketplace template.

---

## 2. BẤT BIẾN (ép bằng hook — không bao giờ phá)

1. **`company_id` ở MỌI query** nghiệp vụ → RLS + FORCE RLS ở tầng DB, mọi repo qua `withTenant(companyId, fn)`. *(RLS policy + FORCE TRƯỚC khi backfill company_id.)*
2. **Không hard-delete** dữ liệu quan trọng (`deleted_at`). Bảng audit/snapshot (`audit_logs`, `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`) = **append-only**, app role không UPDATE/DELETE.
3. **Không secret plaintext.** User pw → hash. `platform_accounts` → **envelope encryption + KMS/Vault**, mã hóa app-side, không log, reveal cần re-auth + audit.

## 3. Luật phụ thuộc (thứ tự bắt buộc)

```
Audit log + Event bus (outbox)  ──▶  TRƯỚC mọi module
Permission engine               ──▶  TRƯỚC mọi module nhạy cảm (lương/secret/tài chính)
Tenant isolation (RLS)          ──▶  TRƯỚC khi seed/backfill dữ liệu
```

---

## 4. Lộ trình theo MỐC (full MVP v1)

| Mốc | Phase | Đầu ra dùng được | Ước lượng (solo+AI) | Năng lượng |
| --- | --- | --- | --- | --- |
| 🏁 **M1 Lõi sống** | G1→G4 | 1 video trọn vòng đời, pilot 1 team | ~6–9 tuần | 🔋🔋 (thung lũng G2/G3 → đỉnh G4) |
| **M2 Sản xuất thật** | G5·G6·G7·G9 | Channel/Project/Content + Workflow Builder + Task Hub | +2.5–3.5 tháng | 🔋 (G6-2, G7) |
| **M3 Chất lượng & giao tiếp** | G8·G10 | Duyệt 1–3 cấp, KPI, chat, noti, họp | +1.5–2 tháng | 🟢🔋 |
| **M4 HR·Lương·Tài chính** | G11·G12·G13 | Chấm công, lương bất biến, lợi nhuận | +2.5–3 tháng | 🔋🔋 (G12 crown jewel) |
| **M5 Dashboard·Mobile·SaaS** | G14·G15·G16 | Dashboard theo role, mobile, multi-tenant ready | +2.5–3.5 tháng | 🟢 (trừ G16) |

> Chi tiết từng task G1-1…G16-4 + "Done khi" → xem **`TASKS.md`** (đã đầy đủ, không lặp lại ở đây).
> Mốc release nội bộ R1–R8 → `TASKS.md` mục cuối.

---

## 5. Tech stack (đã chốt — `docs/adr/`)

Backend **NestJS** + nestjs-zod · DB **PostgreSQL 16/17 + RLS/FORCE** · ORM **Drizzle** · Pooling **PgBouncer transaction-mode** · Cache/Queue **Valkey + BullMQ** · Realtime **Socket.IO + Valkey adapter** · Secrets **envelope + KMS/Vault** · Storage **R2/MinIO qua S3 SDK** · Frontend **Vite + React 19 SPA** + TanStack + Zustand · UI **shadcn + Tailwind v4** · Grid **TanStack Table v8** · Canvas **React Flow** · Charts **Recharts + Tremor** · i18n **react-i18next (vi) + date-fns (UTC-at-rest)** · Monorepo **pnpm + Turborepo**, `packages/contracts` = Zod nguồn DTO.

**Loại bỏ:** Supabase · Prisma · Next.js (admin) · Redis 8 · Typesense · MUI X/AG Grid Enterprise.

### 16 ADR đã chốt (9 bất khả nghịch ⚠️)

⚠️ 0001 RLS multi-tenant · ⚠️ 0002 Drizzle · ⚠️ 0003 PgBouncer tx-mode · ⚠️ 0004 Envelope encryption · ⚠️ 0005 Payroll/Finance snapshot append-only · 0006 Vite SPA · 0007 React Native · ⚠️ 0008 UTC-at-rest TZ · ⚠️ 0009 Audit + outbox event bus · ⚠️ 0010 Permission 4-tier (nhạy cảm không kế thừa) · 0011 Zero-cost infra · 0012 NestJS modular monolith · 0013 Valkey+BullMQ+Socket.IO · 0014 R2/MinIO · 0015 shadcn+TanStack · ⚠️ 0016 Approval = single source of truth.

---

## 6. Trạng thái hiện tại (2026-06-05)

- **Đang ở G1 (~95% — gần đóng).** Nhánh `feat/g1-bootstrap`. Build verify cục bộ: `pnpm typecheck/build/test/lint` **xanh 4/4** (16 test); API runtime smoke OK (`/health` envelope · `/health/db` fail-soft · 404 qua exception filter).
- **Đã xong:** G1-1 monorepo (pnpm+Turborepo, 3 workspace) · G1-2 docker-compose (Postgres17/PgBouncer tx-mode/Valkey8/MinIO) · G1-3 Drizzle config+client+migrator+baseline · G1-4 NestJS skeleton (zod-env, health, response envelope, exception filter, ZodValidationPipe) · G1-5 web skeleton (TanStack Router/Query + Zustand + shadcn + login mock gọi /health) · G1-6 CI (lint/typecheck/test + migration trên Postgres ephemeral) · G1-8 backup script (`pg_dump -Fc` → encrypt → rclone offsite + GFS).
- **Còn lại để đóng G1:** **G1-7** — wire 3 hook guardrail còn lại vào `settings.json` (`anti-bandaid-guard` đã viết; `format-on-write`, `typecheck-changed`) + chạy CI lần đầu xác nhận xanh. _(3 hook bất biến tenant/immutability/secret đã wire.)_
- **Lưu ý Docker:** chưa chạy ở máy build → compose/migration verify end-to-end qua **CI** (Postgres ephemeral).
- **G2–G16 = 0% code**, bị G1 chặn.

---

## 7. Quyết định đã chốt phiên này

- **Lưu video = chỉ LINK** (Google Drive / YouTube unlisted) ở MVP-0/MVP v1. Storage hệ thống chỉ giữ artifact nhỏ (thumbnail, script, tài liệu) → vừa free tier. Code không đổi khi nâng cấp (vẫn S3 SDK).
- **Workflow Builder hoãn**: MVP-0 (G4-3) dùng **1 workflow hard-code** (Script→Edit→QA→Upload). Builder đầy đủ ở **G7**. (Khớp `TASKS.md` + `mvp-0-scope.md`; thắng mâu thuẫn với PRD coi là P0.)
- **ERD chuẩn = `erd-v2.md`** (vá v1: thêm outbox/processed/dead_letter events, encryption_keys, workflow_step_instance_locks; cột `effect` cho DENY; FK thật thay polymorphic ở nhóm nóng; partial unique index cho soft-delete; approval SSOT).

---

## 8. Quyết định CÒN MỞ (cần chốt trước khi tới phase liên quan)

| # | Mục | Khi nào cần | Ghi chú |
| --- | --- | --- | --- |
| 1 | ~~Infra host~~ ✅ **ĐÃ CHỐT** | — | Dev local = WSL2+Docker trên PC Windows; host pilot = Oracle A1. Xem §9 |
| 2 | **Backup RPO: daily vs +PITR** | Trước M4 (G11/G12 có dữ liệu thật) | Daily dump đủ cho M1–M3 |
| 3 | **Nơi giữ khóa mã hóa backup + break-glass** | Trước khi có dữ liệu thật | Két offline / password manager, ≥2 nơi |
| 4 | **B2 vs Google Drive làm backup chính** | Trước G1-8 | Đề xuất **B2** (S3-compatible, hợp rclone/SDK) |

---

## 9. Infra host — ĐÃ CHỐT (2026-06-05)

**Bối cảnh:** solo dev, máy duy nhất là **PC Windows cá nhân (cũng là máy dev)** — KHÔNG có server Linux 24/7 riêng. Tách bạch 2 việc:

| | Giai đoạn | Chạy ở đâu | Lý do |
| --- | --- | --- | --- |
| **Dev local** | G1 → G4 | **PC Windows này, qua WSL2 + Docker Desktop** | Toàn bộ stack chạy Docker Compose local là đủ để code & test; chưa cần cloud |
| **Host pilot** | G4-8 (deploy cho 1 team thật) | **Oracle Cloud A1 (region Singapore)** | Máy dev cá nhân KHÔNG dùng làm server 24/7 (tắt máy = chết service, không IP public, pilot không truy cập được) |

**Quy tắc Windows bắt buộc (tránh lỗi hay gặp nhất):**

- Code & chạy Docker **BÊN TRONG WSL2 (Ubuntu)**, KHÔNG chạy thẳng trên Windows filesystem.
- Lý do: tránh lỗi **CRLF line-ending**, đường dẫn Windows↔POSIX, hiệu năng Docker bind-mount kém trên `/mnt/c`, và giữ **parity với prod Linux ARM64** (Oracle A1).
- Repo nên nằm trong WSL home (`~/dev/...`), không phải `C:\dev 2\`, khi đã vào nhịp dev nghiêm túc. *(Hiện repo ở `C:\dev 2\MediaOS` — cân nhắc chuyển vào WSL trước khi chạy Docker nhiều.)*
- `.gitattributes` ép `* text=lf` để tránh CRLF lọt vào script/migration.

**Đăng ký Oracle A1 sớm** (hay hết slot) nhưng chưa cần dùng tới khi pilot. Backup offsite (B2) vẫn bắt buộc dù host ở đâu.

**Đảo ngược rẻ:** cùng 1 Docker Compose stack chạy được cả local-WSL lẫn A1 → đổi host không phải sửa code.

---

## 10. Gap thiết kế cần đóng (trước khi code phase tương ứng)

| Gap | Đóng ở phase | Ghi chú |
| --- | --- | --- |
| **Masking layer chung** (REST + WS cùng DTO mask) | G2 (nền) | Cấm `io.emit` thẳng row; BaseDTO mask field |
| **PermissionService 4-tầng + thuật toán `can()`** + matrix chi tiết action×role×scope×object | G3 | Bám `permission-matrix-spec.md`; deny-path RED trước |
| **Lock propagation** (khóa bước theo dependency) đa nhánh | G7 (MVP-0 chỉ khóa bước sau, tuần tự) | Bảng `workflow_step_instance_locks` đã có |
| **DAG song song/hợp lưu** trên canvas | G7 | Canvas vẽ DAG từ đầu để khỏi thiết kế lại |
| **KPI formula** (task quality % + deadline % + error penalty % + attendance %) | G8 | KPI = tham khảo, HR duyệt trước khi vào lương (BR-007) |
| **Cost allocation matrix** (theo giờ/video/task/%/shared pool) | G13 | FIN-003 |
| **Channel health score formula** + nguồn dữ liệu | G6-5/G14 | feed Dashboard |
| **Mobile offline-first** (IndexedDB + sync queue cho chấm công/task) | G15 | tránh mất dữ liệu khi mất mạng |

---

## 11. Việc tiếp theo (đóng G1 → mở M1)

Theo thứ tự (có thể fan-out song song nhóm độc lập):
1. **G1-2** docker-compose: Postgres + PgBouncer + Valkey + MinIO; verify `set_config(...,true)` chạy đúng trong transaction (PgBouncer × RLS).
2. **G1-3** Drizzle migration baseline + extensions (`pgcrypto`, `citext`); client design để G2 cắm `withTenant`.
3. **G1-5** Web skeleton: TanStack Router/Query + shadcn init + login mock gọi `/health`.
4. **G1-6** CI: lint + typecheck + test trên Postgres ephemeral.
5. **G1-7** Hooks guardrail: `tenant-isolation-guard`, `no-hard-delete`, `secret-scan-gate` (làm sớm để bảo vệ phần còn lại).
6. **G1-8** Backup script `pg_dump` → B2 (chốt sau theo §8).

**Done G1 khi:** `pnpm dev` chạy · API health OK · web mở login mock · CI xanh → cập nhật mục 7 `CLAUDE.md` (lệnh dự án thật) → bắt đầu **G2 (nền bảo mật & đa-tenant)**.
