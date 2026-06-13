# PLAN — G13 Finance: Revenue · Cost · Profit · Expense

> Lane song song, worktree `feat/g13-finance`. Dải migration **0070–0079**.
>
> **Cơ chế drizzle migrator (xác minh từ `PgDialect.migrate` + đối chiếu DB):** migrator đọc `_journal.json` theo thứ tự entry, và CHỈ áp entry có `when` (folderMillis) **lớn hơn `created_at` của bản ghi cuối** trong `drizzle.__drizzle_migrations` (hash được lưu nhưng KHÔNG phải tiêu chí skip). DB dev chung hiện có 38 bản ghi, `max(created_at) = 1717500045000` (lane khác đã áp `when` 1717500040000–45000; journal local kết thúc idx=32/when=1717500035000). ⇒ Journal G13 thêm **idx 33–37, `when` = 1717500070000–1717500074000** (đơn điệu tăng, không trùng, khớp dải file 0070+). **Trước merge:** chạy `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at` trên DB đích để xác minh không đụng; renumber tag/idx lúc merge do người tích hợp master làm — DB dev chấp nhận reset nếu hash lệch (chưa có production).

## Meta

- **Mã:** G13-1..4 · **Phase:** G13 · **Mốc:** M4
- **Vùng rủi ro chủ đạo:** 🔴 đỏ (append-only + immutability + mask tài chính = crown-jewel của phase)
- **Model chính:** Fable (G13-1/3 🛠️) · các phần 🤖 (G13-2/4) cùng phiên
- **Ước lượng:** L (4 task: M+M+M+S)

## 1. Mục tiêu

Xong G13 thì hệ thống ghi nhận được doanh thu/chi phí đa chiều (nền tảng/kênh/project/video), phân bổ chi phí theo 5+ phương pháp, chốt lợi nhuận bất biến theo scope, và luồng đề xuất chi duyệt qua Task Hub sinh cost record — toàn bộ mask theo quyền, 3 bảng sổ cái append-only ở tầng DB grant.

## 2. Scope

**Trong:**
- DB: `revenue_records` · `cost_records` · `cost_allocations` · `profit_snapshots` · `expense_requests` · `expense_approvals` (theo ERD §13, cột khớp ERD trừ chỗ ghi rõ lý do lệch).
- API: module `finance` (controllers revenue/costs/profit/expenses), masking server-side, audit mọi ghi/sửa/lộ số.
- Web: Revenue List/Entry · Cost List/Entry · Cost Allocation (dialog trong Cost) · Profit Dashboard · Expense Request/Approval.
- Test: deny-path UPDATE/DELETE 3 bảng append-only (RED trước), RLS registry 6 bảng, unit allocation/profit/money ≥80%.

**Ngoài (không làm):**
- Upload file thật lên R2/MinIO (chỉ lưu `attachment_url` — URL do user dán; upload flow chung của hệ thống chưa có ở master).
- `by_work_hours` đọc từ attendance (G11 chưa merge) → nhận `hours` thủ công per target, TODO G11.
- `project_id` trên task (chờ G9) → task duyệt chi không gắn project, TODO G9.
- Notification cho người duyệt (outbox → G10), object-scoped finance visibility (V-Channel nếu được cấp — object_permissions đã hỗ trợ sẵn ở engine, FE/seed chưa làm).
- Multi-level approval (`current_approval_level` giữ mặc định 1, schema sẵn cột theo ERD).

**Acceptance (TASKS.md G13):** FIN-003 (5 phương pháp phân bổ); revenue đa chiều + audit sửa/xoá; profit = Doanh thu − CP trực tiếp − CP phân bổ, snapshot bất biến; đề xuất chi qua Task Hub (`task_type='finance'`, CẤM bảng approval workflow riêng — `expense_approvals` chỉ là **log quyết định**, không phải engine duyệt); mask theo quyền.

## 3. Phụ thuộc

- Có sẵn: withTenant (G2-2), audit+outbox (G2-4), PermissionService + `can()` sensitive (G3), RLS harness (G2-5), `platforms/channels/projects/content_items` (G6), `tasks` với CHECK chứa `'finance'` + `workflow_step_id/content_item_id` nullable (**migration 0008 — KHÔNG phụ thuộc G9 merged**, chỉ phụ thuộc schema 0008 đã có trên master; G9 chỉ cần cho `tasks.project_id` → TODO), catalog permission `create/read/update/delete:finance` + `view-finance:finance` (sensitive) **đã seed từ 0005**, company-admin đã có 4 quyền non-sensitive finance.
- Không đụng schema/lõi chung ngoài: mở rộng CHECK `audit_logs.object_type` (pattern 0011/0014/0020 — additive), thêm permission `*:expense-request` + system role `finance-manager` (additive, ON CONFLICT DO NOTHING).

## 4. Thiết kế chốt

### 4.1 Append-only correction chain (bất biến #2)

3 bảng `revenue_records`/`cost_records`/`profit_snapshots`: **GRANT SELECT, INSERT** cho `mediaos_app` — KHÔNG UPDATE/DELETE, không cột `updated_at`/`deleted_at`. "Sửa/xoá" trên revenue/cost = ghi bản ghi mới:

- `entry_kind text NOT NULL DEFAULT 'original' CHECK IN ('original','adjustment','void')`
- `replaces_record_id uuid NULL REFERENCES <bảng>(id)` + CHECK (`original` ⟺ NULL, `adjustment/void` ⟺ NOT NULL)
- **UNIQUE partial index trên `replaces_record_id`** → mỗi bản ghi chỉ bị thay đúng 1 lần (chặn race double-adjust ở DB).
- Bản ghi **hiệu lực** = `entry_kind != 'void'` AND NOT EXISTS (bản ghi khác có `replaces_record_id = id`).
- Service cấm adjust/void một bản ghi đã bị thay thế hoặc đã void (Conflict 409); audit `RevenueAdjusted/RevenueVoided` (before = bản cũ, after = bản mới) cùng tx.
- ERD có cột `status` trên revenue/cost — **bỏ** vì append-only không cho UPDATE status; trạng thái suy ra từ chain. Ghi chú lệch ERD tại migration.
- `profit_snapshots` không có chain — mỗi lần tính là một snapshot mới (`calculated_at`), "latest" = mới nhất theo thời gian.

### 4.1b Audit object_type + action map (đồng bộ CÙNG COMMIT 0070: SQL CHECK + `AUDIT_OBJECT_TYPES` const trong `apps/api/src/db/schema/audit.ts`)

**5 object_type mới (chuỗi chính xác):** `revenue_record` · `cost_record` · `cost_allocation` · `profit_snapshot` · `expense_request`. (Quyết định duyệt audit trên `expense_request`, không thêm type cho bảng log `expense_approvals`.)

| Action | objectType | Khi nào |
| --- | --- | --- |
| `RevenueCreated` / `RevenueAdjusted` / `RevenueVoided` | `revenue_record` | tạo / điều chỉnh / vô hiệu (before=bản cũ, after=bản mới) |
| `CostCreated` / `CostAdjusted` / `CostVoided` | `cost_record` | như trên |
| `CostAllocated` | `cost_allocation` | mỗi lần chạy phân bổ (after = {method, runId, targets}) |
| `ProfitSnapshotCreated` | `profit_snapshot` | chốt snapshot |
| `ExpenseRequestCreated` / `ExpenseApproved` / `ExpenseRejected` / `ExpenseCancelled` | `expense_request` | luồng đề xuất chi (approve ghi kèm costRecordId) |
| `view-finance` | `revenue_record` \| `cost_record` \| `profit_snapshot` | 1 entry/request đọc unmasked (after = {scope, rowCount}) |

### 4.2 Mask tài chính theo quyền (server-side, theo pattern salary G5)

- Mọi route finance gate `read:finance` (hoặc `create/update:finance` cho ghi). Riêng expense-request dùng resource riêng (xem 4.4).
- Số tiền (`amount`, `totalRevenue`, `profit`, …) chỉ trả về khi `can({action:'view-finance', resourceType:'finance', isSensitive:true})` ALLOW; ngược lại trả `null` (DTO khai báo nullable). FE render mask khi null.
- Reveal ⟹ audit: 1 entry `view-finance` mỗi request đọc unmasked (objectType theo resource, after = {scope, rowCount}) trong cùng tx đọc — KHÔNG per-row (khác salary: list tài chính dài, per-row flood audit; trade-off ghi rõ ở service).
- Fail-safe như salary: `allow && !auditRequired` (cấu hình sai cho sensitive) → mask, không ghi gì.

### 4.3 Phân bổ chi phí (FIN-003) — G13-2

`cost_allocations` (theo ERD; **mutable có kiểm soát**: GRANT SELECT, INSERT, UPDATE — không DELETE; re-allocate = soft-delete set cũ + insert set mới cùng tx + audit `CostReallocated`):
- `allocation_target_type` IN ('channel','project','content_item','team','org_unit','employee') — polymorphic `allocation_target_id` (theo ERD, không FK; service validate target tồn tại trong tenant).
- `allocation_method` IN ('equal_split','manual_percent','by_video_count','by_task_count','by_work_hours','by_revenue_ratio') — đủ 6 giá trị ERD; MVP implement cả 6 (`by_work_hours` nhận hours thủ công).
- UNIQUE (cost_record_id, target_type, target_id) WHERE deleted_at IS NULL.
- Tiền tính bằng **cент integer** (util `money.ts`: parse chuỗi numeric → cents, không float); làm tròn từng phần 2dp, **phần dư dồn vào target cuối** để SUM(allocated_amount) == amount đúng tuyệt đối (có test).
- Trọng số: equal=1/target; video = COUNT content_items theo target (channel qua `content_channels`, project qua `content_items.project_id`, có lọc period theo `created_at`); task = COUNT tasks join qua content_items (TODO G9 cho task.project_id trực tiếp); hours/percent = input; revenue_ratio = SUM revenue hiệu lực theo target trong period. Tổng trọng số = 0 → 400.
- Chỉ cho phân bổ cost **hiệu lực** (không void/superseded); cost bị void sau đó → service tự soft-delete allocations của nó trong tx void.

### 4.4 Expense → Task Hub — G13-4

- `expense_requests` (mutable: GRANT SELECT, INSERT, UPDATE — không DELETE): cột theo ERD + `task_id` FK tasks + `cost_record_id` FK cost_records (lineage sau duyệt). `status` IN ('pending','approved','rejected','cancelled').
- `expense_approvals` (log quyết định — GRANT SELECT, INSERT): theo ERD + UNIQUE (expense_request_id, approval_level) → chặn double-decision ở DB.
- Tạo request → cùng tx insert `tasks` row (`task_type='finance'`, title "Duyệt đề xuất chi: …", assignee = approverUserId do người tạo chọn từ danh sách user có quyền duyệt) + audit. **Không bảng/luồng duyệt riêng** — bất biến #4.
- Quyết định (approve/reject): kiểm `status='pending'`, **cấm tự duyệt** (approver != requested_by), insert approval log, update status, complete task (`status='completed'`), nếu approved → insert `cost_records` (cost_type = expense_type, cost_date = ngày duyệt, entered_by = approver, `expense_request_id` lineage) + gắn `cost_record_id`. Tất cả 1 tx + audit.
- Cancel: requester hủy request pending của mình; task complete + audit.
- Permission mới (`is_sensitive=false`): `create/read/approve:expense-request`. `read` logic: có `read:finance` → thấy tất; chỉ có `read:expense-request` → thấy request mình tạo (service filter). Số tiền expense-request KHÔNG mask với người liên quan (requester/approver cần thấy số mình đề xuất/duyệt — khác sổ cái).
- Cost sinh từ duyệt chi: `cost_date` = ngày duyệt; nếu cần ngày khác kế toán adjust theo chain 4.1.

### 4.5 Profit snapshot — G13-3

- `profit_snapshots` theo ERD + tách `total_direct_cost`/`total_allocated_cost` (dashboard cần; `total_cost` vẫn giữ): target IN ('company','platform','channel','project','content_item','org_unit','team') (CHECK đủ ERD; MVP compute 4: company/channel/project/content_item — còn lại 400 "chưa hỗ trợ").
- Công thức: `profit = total_revenue − total_direct_cost − total_allocated_cost`; `profit_margin = profit/total_revenue` (revenue=0 → NULL); period theo `revenue_date`/`cost_date`; chỉ tính bản ghi **hiệu lực**; allocation lọc theo `cost_date` của cost cha.
- Company scope: direct = toàn bộ cost hiệu lực, allocated = 0 (phân bổ chỉ tái phân phối nội bộ — tránh đếm đôi). Scope con: direct = cost có đúng cột target = id; allocated = allocation active trỏ tới target.
- Snapshot tạo qua `POST /finance/profit-snapshots` (permission `create:finance`); kết quả trả về mask theo 4.2.

### 4.6 Migrations (0070–0074, journal idx 33–37, when 1717500070000+)

| File | Nội dung |
| --- | --- |
| `0070_g13_revenue.sql` | Mở rộng CHECK `audit_logs.object_type` (+5 type finance) · `revenue_records` + RLS/FORCE/policy + GRANT SELECT,INSERT · index (company, revenue_date), (company, channel_id), … |
| `0071_g13_cost.sql` | `cost_records` (GRANT SELECT,INSERT) + `cost_allocations` (GRANT SELECT,INSERT,UPDATE) + RLS/FORCE |
| `0072_g13_profit.sql` | `profit_snapshots` + RLS/FORCE + GRANT SELECT,INSERT |
| `0073_g13_expense.sql` | `expense_requests` (GRANT S,I,U) + `expense_approvals` (GRANT S,I) + `ALTER cost_records ADD expense_request_id` FK + RLS/FORCE |
| `0074_g13_finance_seed.sql` | permission `create/read/approve:expense-request` · system role `finance-manager` (`…000a`) · grant: non-sensitive finance+expense cho finance-manager & company-admin (phần mới), `view-finance` (sensitive, explicit) cho finance-manager · `create/read:expense-request` cho role `employee` |

Mọi bảng: `company_id uuid NOT NULL DEFAULT current_setting(...) REFERENCES companies`, policy USING+WITH CHECK theo GUC, FORCE RLS, RLS **trước** khi bất kỳ seed/insert nào (bảng mới rỗng — không có cửa sổ backfill).

## 5. Rủi ro & giảm thiểu

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| App role UPDATE/DELETE được sổ cái (vi phạm bất biến #2) | thấp | 🔴 | GRANT chỉ SELECT,INSERT; **deny-path test RED trước**; FULL gate |
| Rò chéo tenant bảng mới | thấp | 🔴 | RLS+FORCE ngay trong migration tạo bảng; +6 case `rls-registry.ts` |
| Số tiền lộ cho role không quyền (mask hỏng) | vừa | 🔴 | mask ở SERVICE (server), DTO nullable, test masking; reveal ⟹ audit cùng tx |
| Double-adjust / double-approve race | vừa | 🟡 | UNIQUE partial `replaces_record_id`; UNIQUE (request, level); test |
| Sai số làm tròn phân bổ (SUM ≠ amount) | vừa | 🟡 | tính cents integer + dồn dư target cuối + unit test biên |
| Đếm đôi direct vs allocated trong profit | vừa | 🟡 | quy ước company-scope allocated=0; service cảnh báo khi phân bổ cost có direct target; doc + test formula |
| Drizzle skip migration mới (journal when < DB max) | chắc chắn nếu quên | 🟡 | when=1717500070000+ (kiểm tra DB max=…45000 rồi) |
| Tự duyệt đề xuất chi | vừa | 🟡 | service chặn requester==approver + test |
| Task Hub bị bypass (duyệt không qua tasks) | thấp | 🟡 | tạo task cùng tx tạo request; `expense_approvals` chỉ là log; review gate soi |

## 6. Test plan

- **RED trước (G13-1/3):** `finance-append-only.int-spec.ts` — app role `UPDATE/DELETE revenue_records|cost_records|profit_snapshots` → expect lỗi `permission denied` (42501); INSERT+SELECT trong tenant OK. (Trước migration: fail vì bảng chưa có = RED.)
- RLS: +6 case vào `rls-registry.ts` (harness 2-tenant tự chạy).
- Unit: `money.spec.ts` (parse/round/cents) · `allocation.spec.ts` (6 method, dư làm tròn, weight=0, percent≠100) · `profit-calc.spec.ts` (formula, margin NULL, lọc hiệu lực/period, company-scope) · `finance-mask` (allow/deny/fail-safe) · `expenses.service.spec.ts` (transitions, tự duyệt, double-decision, sinh cost đúng).
- Coverage ≥80% cho allocation + profit + mask.
- Regression: suite hiện có (`pnpm --filter @mediaos/api test`) + typecheck + lint toàn workspace.

## 7. Commit & merge

- Nhánh: `feat/g13-finance` (đang ở). Commit theo task: `feat(g13-1): …` → `feat(g13-2)…` → `feat(g13-3)…` → `feat(g13-4)…` + `docs(g13): plan/handoff`.
- Gate: G13-1+3 FULL (`ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter`), G13-2+4 LIGHT (`ecc:typescript-reviewer` + quality). Sửa hết CRITICAL/HIGH trước khi tick TASKS.md.

## 8. Rollback

- Mỗi task 1 commit — revert được độc lập (web/contract/module additive, không sửa module cũ ngoài: export schema index, audit CHECK additive, router/nav web).
- Migration: bảng mới → `DROP TABLE` ngược thứ tự (ghi chú Down ở cuối file như 0005); CHECK audit revert về danh sách 0020; DB dev chung — không rollback tự động, chỉ khi hỏng nặng.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

_(chờ)_

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

_(điền khi đóng phase)_
