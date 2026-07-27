# RELEASE-02 — KNOWN ISSUES & DEFER LIST (MVP)

> Sổ vấn đề đã biết tại thời điểm chốt cổng Sprint 5 → Sprint 6. Sinh trong `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **0529**.
> Cập nhật: `S6-STAB-1` (KI-021…023) · **`S6-QA-FINAL-1` (KI-024…026)** — `master` `c845a777`.
> Thang mức: `QA-08 §9` (S0 Blocker · S1 Critical · S2 Major · S3 Minor · S4 Trivial).
>
> **Quy tắc của sổ này:** chỉ ghi vấn đề đã **kiểm chứng** (có lệnh/truy vấn/số đo/file:dòng). Không
> ghi nghi ngờ. Mỗi mục có **workaround** và **chủ** — không có mục nào "để đó xem sao".

---

## 1. Bảng tổng hợp

| ID | Vấn đề | Mức | Loại | Chặn UAT | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- | --- |
| ~~KI-001~~ | ~~Tài khoản `uat.*` chưa gắn hồ sơ nhân viên~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| ~~KI-002~~ | ~~Chưa có số dư phép trong công ty `demo`~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| KI-003 | Loại nghỉ phép có 3 bản trùng chữ thường | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-004 | Chưa nhập ngày lễ | S3 | Dữ liệu | ❌ | ⚠️ | Owner/HR |
| KI-005 | Widget "Thông báo" trên dashboard trễ tối đa ~10s | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-006 | LMS→NOTI chưa hoạt động — **migration `0529` ĐÃ áp cho cả PROD+UAT 2026-07-26**; còn thiếu `LMS_NOTI_TOKEN` + deploy | S2→S3 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-007 | CI `Security / Dependency scan` đỏ do lỗi công cụ | S3 | CI | ❌ | ⚠️ | Owner/DevOps |
| KI-008 | Chưa có bằng chứng diễn tập **khôi phục** backup | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-009 | Log chưa có cấu trúc JSON | S3 | Quan sát | ❌ | ❌ | Sprint 6 |
| KI-010 | Endpoint cũ `GET /employees` chưa phân trang thật (mới chặn bằng cap 2000) | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-011 | Chưa có cảnh báo tự động (5xx-rate, disk, backup-fail, SSL) | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-012 | Accepted-risk **D3**: widget headcount count-only xuyên phòng ban cho HR scope Department | S3 | Bảo mật (đã chấp nhận) | ❌ | ⚠️ cần chữ ký | Owner |
| KI-013 | `refresh` / `resetPassword` không throttle (theo thiết kế, có mitigation) | S3 | Bảo mật (theo thiết kế) | ❌ | ❌ | — |
| KI-014 | Chạy cả suite trong 1 tiến trình bị crash `ERR_IPC_CHANNEL_CLOSED` — **cập nhật 2026-07-26: chạm CẢ `@mediaos/app`, và CHỈ ở máy local Windows (CI ubuntu xanh)** | S2 | Hạ tầng test (local) | ❌ | ❌ | Sprint 6 |
| KI-015 | Nhiễu log `OutboxNotificationBridge … intake THẤT BẠI` khi chạy test | S3 | Vệ sinh test | ❌ | ❌ | Sprint 6 |
| KI-016 | PROD dùng chung `apps/api/dist` với dev-online | S2 | Hạ tầng | ❌ | ✅ | Owner/DevOps |
| KI-017 | Refresh materialized view dashboard qua `workerDb` hỏng từ G14 ("must be owner") | S3 | Sản phẩm (ngủ) | ❌ | ⚠️ | Sprint 6 |
| KI-018 | Dữ liệu demo có trạng thái đơn nghỉ lẫn hoa/thường | S3 | Dữ liệu | ❌ | ❌ | Sprint 6 |
| KI-019 | Chỉ 1 ca làm việc + 1 quy tắc chấm công + 0 phân ca trong DB UAT | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-020 | Chưa có dữ liệu GOAL để nghiệm thu | S3 | Dữ liệu | ❌ | ❌ | Owner |
| KI-021 | 3 sự kiện NOTI của ATT bật trong danh mục nhưng **không có producer** (`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED`) | S2 | Sản phẩm | ❌ | ❌ | Sau MVP |
| ~~KI-022~~ | ~~`outboxOf` trong `goal-be2-link.int-spec` không lọc `company_id` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-023~~ | ~~Đua teardown `audit_logs → companies` trong `cleanupTenants` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-024~~ | ~~`foundation-audit.e2e-spec` dùng `action` cố định + đếm tuyệt đối ở System scope ⇒ đỏ-giả **vĩnh viễn** sau một lần chạy bị ngắt~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| KI-025 | **98/346 đường dẫn API (28%) không có test HTTP nào chạm** — phủ ở tầng service (`T-svc`) nên guard/DTO/envelope của route chưa từng chạy. Nặng nhất: `user-invites` (`/users/invite`, `/users/:id/approve`…) + `POST/GET /hr/profile-change-requests` | S2 | Độ phủ test | ❌ | ❌ | Sau MVP |
| ~~KI-026~~ | ~~Nhãn `[BLOCKED — service.ts bug]` + chú thích "KNOWN BROKEN" nằm trên một test ĐANG XANH (`attendance-adjustment.int.spec.ts`) — bug đã sửa cùng PR #81 nhưng chú thích không gỡ~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S3 | Vệ sinh test | — | — | ✔ xong |
| **KI-027** | **2FA KHÔNG được ép ở PROD** cho `company-admin` dù role khai `requires_two_factor=true` (env `false` + company policy NULL + user flag `false`) | **S1** | Bảo mật (cấu hình) | ❌ | ✅ | Owner |
| ~~**KI-028**~~ | **ĐÃ ĐÓNG 2026-07-27** (owner chạy `scripts/s6sec1-contain-test-tenants.sql`; verify PROD: operator-grant ngoài funtime = **0**, user tenant test còn active = **0**, funtime nguyên vẹn 46 user / 0 dòng bị script chạm). Còn lại chỉ là **vệ sinh dữ liệu** (purge 16 company) → `S6-PERF-DB-1`. ~~16 tenant TEST + 25 user còn sống trong DB PROD~~ — trong đó **3 tài khoản `platform-admin` (audience operator, ĐỌC CHÉO TENANT theo thiết kế) đang `active`, `must_change_password=false`, mật khẩu = `Passw0rd!test99` có trong 86 file của repo PUBLIC** (đã verify argon2 trên hash PROD) | **S0** | Bảo mật | ✅ | ✅ | **Owner — GẤP** |
| ~~**KI-032**~~ | ~~**Tenant admin XOÁ được `role_permissions` của role hệ thống TOÀN CỤC**~~ — **ĐÃ ĐÓNG 2026-07-27** (mig `0530` RESTRICTIVE FOR DELETE + gỡ `DELETE ON roles` + guard `isSystem` ở 2 hàm; RED→GREEN 6/6). **`0530` ĐÃ áp cho PROD** — verify: policy `role_permissions_no_delete_system` cmd=`d` permissive=`f`, grant app trên `roles` = `INSERT,SELECT,UPDATE` (hết `DELETE`). — RLS `USING` cho `company_id IS NULL` mà **DELETE không xét `WITH CHECK`**; service thiếu guard `isSystem`. Ghi chéo tenant, **INSERT khôi phục bị chặn ⇒ không hoàn tác qua app**. PROD: 785 grant toàn cục, `funtime` dùng 2 role toàn cục | **S0** | Bảo mật | ✅ | ✅ | **Owner — GẤP** |
| ~~KI-033~~ | **ĐÃ VÁ 2026-07-27** — thêm audit in-tx cho **CẢ HAI** endpoint report. *Đính chính phạm vi so với bản gate:* không phải "leave lạc đàn giữa hai sibling cùng cổng" — `attendance-report` cũng không audit, và nó gate bằng `view-company:attendance` chứ **không** phải `export`. Đúng là: 2 bản CSV có audit, 2 bản report JSON thì không | S1 | Bảo mật (audit) | — | — | ✔ xong |
| KI-034 | Audit của `notifications.service.create` **KHÔNG cùng transaction** dù docstring khẳng định có ⇒ audit + outbox có thể mất chỉ với một dòng warn. **Vá một phần 2026-07-27:** `markRead` nay `await` promise audit (hết đua với `return`), và docstring sai đã sửa cho khớp code. **Còn lại:** gộp insert+outbox+audit vào MỘT tx — refactor chạm đường nóng mọi module gọi ⇒ WO riêng có RED test | S1 | Bảo mật (audit) | ❌ | ⚠️ | WO mới |
| ~~KI-035~~ | **ĐÃ VÁ 2026-07-27** + **HẠ MỨC S1 → S3**. *Hai claim của gate đều SAI, đã tự kiểm chứng:* (1) nhánh `if (!db) return;` chỉ chạy cho login **THẤT BẠI pre-auth** (`companyId: null` ở `:202`/`:222`) — hai đường login **thành công** (`:375`/`:507`) đều truyền `companyId` thật nên đi nhánh `withTenant`, KHÔNG có chuyện "cấp token mà không có log"; (2) `emitAccountLocked` **có** log ERROR đầy đủ trong catch (chú thích tại chỗ ghi rõ "KHÔNG nuốt câm"). Lỗi thật còn lại: chỗ bỏ ghi đó **im lặng tuyệt đối** ⇒ đã thêm `logger.warn` | S3 | Bảo mật (quan sát) | — | — | ✔ xong |
| ~~KI-036~~ | ~~`.env.example:91` ship `TWO_FACTOR_ENFORCEMENT_ENABLED=false`~~ — **ĐÃ VÁ 2026-07-27** (đổi thành `true` + cảnh báo thứ tự thao tác) — `cp .env.example .env` là bước cài chuẩn ⇒ **gốc rễ tái diễn** của KI-027 ở mọi deploy mới | S2 | Bảo mật (cấu hình) | ❌ | ⚠️ | WO mới |
| ~~KI-038~~ | **ĐÃ VÁ 2026-07-27** (mig `0531`) — **cùng họ lỗi với KI-032, trên hai bảng khác**: `notification_events` (59 hàng toàn cục PROD) + `notification_templates` (45) cho phép một tenant `UPDATE … SET company_id=<mình> WHERE company_id IS NULL` ⇒ **cướp trọn danh mục NOTI dùng chung**, commit được, **không hoàn tác qua app**; mọi tenant khác mất catalog ⇒ không tạo nổi thông báo. Hai reviewer độc lập cùng tìm ra ở vòng re-gate. Vá = gắn trigger `enforce_company_id_immutable` (mig 0436) | **S0** | Bảo mật | — | — | ✔ xong |
| ~~KI-039~~ | **ĐÃ VÁ 2026-07-27** — `rls-coverage-assert` assert (b) chỉ kiểm **chuỗi** (`WITH CHECK` có nhắc GUC là xanh) nên **mù** với lớp lỗi KI-038. Thêm **assert (c)**: bảng vừa có khe hở `IS NULL` trong `USING` vừa cho app role `UPDATE` thì bắt buộc phải có trigger bất biến. Đã chứng minh đỏ khi gỡ trigger | S2 | Độ phủ test | — | — | ✔ xong |
| ~~KI-040~~ | **ĐÃ VÁ 2026-07-27** — assertion cô lập tenant mà **chính WO này viết** khi vá KI-033 **không thể đỏ được** (`filter(includes("tenant A"))` không khớp fixture nào); reviewer chứng minh spec vẫn 11/11 xanh giữa một vụ rò audit chéo tenant thật. Đã khôi phục đếm tuyệt đối + nghiệm thu bằng cách gieo policy rò (4 case đỏ) | S1 | Độ phủ test | — | — | ✔ xong |
| KI-041 | Matview `mv_dashboard_output`/`mv_dashboard_task_status` mang `company_id` nhưng **Postgres không hỗ trợ RLS trên matview** ⇒ nằm ngoài phép đo 153/153; ranh giới duy nhất là `WHERE company_id = $1` trong service | S2 | Bảo mật | ❌ | ⚠️ | WO mới |
| KI-042 | `login_logs`: hàng `company_id IS NULL` (lần thử đăng nhập pre-auth, có email + IP) **đọc được chéo tenant**. Vế GHI đã đóng — đính chính so với vòng 1 | S3 | Bảo mật | ❌ | ❌ | WO mới |
| KI-037 | Bộ `tenant-isolation.int-spec` (465 ca) **chỉ SELECT** — không có một ca deny GHI chéo tenant nào. Là lớp lỗ hổng đã để lọt KI-032, không phải một bug lẻ | S2 | Độ phủ test | ❌ | ❌ | WO mới |
| KI-029 | `PERMISSION_GUARD_ENABLED` — kill-switch **fail-OPEN toàn hệ**, đọc thẳng `process.env`, KHÔNG có trong `env.schema` lẫn `.env.example` (hiện KHÔNG đặt ở PROD) | S2 | Bảo mật (tiềm ẩn) | ❌ | ❌ | Sau MVP / CR |
| KI-030 | `GET /org/employees` trả **danh bạ toàn tenant** (email·tên·trạng thái·team) cho mọi user đã đăng nhập — lệch với `/hr/employees` vốn ép data_scope | S2 | Bảo mật (phân quyền) | ❌ | ❌ | CR chờ owner |
| KI-031 | `INTERNAL_API_KEY` ngoài `env.schema`/`.env.example` (guard **fail-CLOSED** nên chỉ mất tính năng) | S3 | Vận hành | ❌ | ❌ | Sau MVP |

> **Đánh số:** `S6-QA-FINAL-1` (PR #294) chiếm **KI-024…026**; `S6-SEC-1` (PR #295) tiếp
> **KI-027…042**. Hai PR merge vào cùng bảng này — đã **giữ cả hai khối, không đánh số lại**
> (tài liệu khác đã trỏ tới số hiệu).

**Tổng (cập nhật 2026-07-27 sau re-gate vòng 2 của `S6-SEC-1`):**
`S0 = **0 mở trong code**` — KI-028 · KI-032 · **KI-038** đều đã vá; KI-028/032 **đã verify trên PROD**, còn **KI-038 chỉ đóng ở PROD sau khi áp migration `0531`** (xem cảnh báo dưới) · `S1 = **3 mở**` (KI-027 · KI-030 · KI-034) — KI-033 **đã vá**; KI-035 **đã vá + hạ xuống `S3`** (hai claim của gate đều sai, xem dòng của nó); KI-034 **vá một phần** (còn phần gộp transaction). KI-027 nay chỉ còn chờ admin enroll 2FA rồi bật cờ, vì gốc rễ KI-036 đã vá ·
`S2 = **9 mở**` (KI-008 · KI-011 · KI-014 · KI-016 · KI-021 · **KI-025** · KI-029 · KI-037 · KI-041) · `S3 = 17`.

> ✅ **KHÔNG CÒN `S0` MỞ (2026-07-27).** Hai lỗ `S0` do FULL gate của `S6-SEC-1` tìm ra đã đóng và
> **đã verify trực tiếp trên PROD**:
>
> | | Đóng bằng | Verify trên PROD |
> | --- | --- | --- |
> | KI-028 | `scripts/s6sec1-contain-test-tenants.sql` | operator-grant ngoài `funtime` = 0 · user tenant test active = 0 · `funtime` nguyên vẹn |
> | KI-032 | migration `0530` (+ guard `isSystem`, code ở PR #295) | policy `…no_delete_system` `d`/permissive=`f` · grant `roles` hết `DELETE` |
>
> Lưu ý: **guard tầng app** của KI-032 chỉ live sau khi PR #295 merge + deploy; hiện PROD đang được
> **tầng DB** chặn — đó là lý do vá hai tầng. Chi tiết:
> `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §0.1 · §7d.

~~Không có defect sản phẩm mức S0/S1 nào đang mở.~~ — **câu này đúng tới trước FULL gate 2026-07-26,
nay KHÔNG còn đúng** (xem trên). KI-001/KI-002 **đã đóng**; KI-006 hạ xuống S3 (chỉ còn bước cấu hình
token + deploy). Giữ nguyên số hiệu KI để tài liệu khác trỏ tới không bị gãy.

> **Ngưỡng RC** (`RELEASE-05` §5.3) cho phép **≤3** mục S2 mở, mỗi mục có owner + workaround. Hiện
> **8** ⇒ trước khi tạo RC phải đóng bớt hoặc owner ký waiver tường minh cho phần vượt. Bốn mục nằm
> trong tầm đóng ở Sprint 6: **KI-008** (diễn tập restore — `S6-PERF-DB-1`) · **KI-016** (tách `dist`
> — cần mở `S6-OPS-DISTSPLIT-1`) · **KI-028** (dọn 16 tenant test khỏi PROD) · **KI-030** (gate
> `read:user`, đường sửa đã khảo sát ở `S6-SEC-1` §6.4).
>
> **Và một mục `S1` mới: KI-027.** Không chặn RC theo chữ nghĩa của `RELEASE-05` §5.3, nhưng **nên
> đóng trước go-live** — thao tác ~10 phút của owner, không cần sửa code (thứ tự bắt buộc ở
> `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §6.1: **enroll 2FA TRƯỚC, bật cờ SAU** — làm ngược
> là tự khoá mình ra khỏi hệ thống).
---

## 2. Chi tiết

### KI-001 — Tài khoản UAT chưa gắn hồ sơ nhân viên · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** tạo `UAT-EMP-01` (phòng Nội Dung, quản lý trực tiếp = `uat.manager`) · `UAT-MGR-01` ·
> `UAT-HR-01` (phòng Nhân Sự) trong `mediaos_dev`, set **cả** `direct_manager_id` **lẫn**
> `employee_manager_relations`. Bơm bằng SQL idempotent ⇒ **không có vết `audit_logs`** (đánh đổi đã
> ghi rõ ở `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §0).

**Kiểm chứng:** `SELECT u.email, e.employee_code FROM users u LEFT JOIN employee_profiles e ON e.user_id=u.id …`
→ cả 4 tài khoản `uat.*` trả `NULL`.
**Hệ quả:** `GET /attendance/today` trả rỗng kèm thông báo "chưa có hồ sơ"; `POST /attendance/check-in`
→ **403** (`attendance.service.ts:362-363`). Kéo theo chấm công · nghỉ phép · bảng công cá nhân · widget
Employee đều không chạy được.
**Workaround:** `/hr/employees` → tạo/chọn hồ sơ → **Liên kết tài khoản**; rồi `/hr/org-chart` đặt
`uat.manager` làm quản lý trực tiếp của `uat.employee`.

### KI-002 — Chưa có số dư phép · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** số dư 2026 — `uat.employee` ANNUAL 12 + SICK 5 · `uat.manager` ANNUAL 12
> (`remaining_days` là cột GENERATED `total_days - used_days`, không ghi tay).

**Kiểm chứng:** `SELECT count(*) FROM leave_balances` → **0**. `leave_types` `ANNUAL`/`SICK`/`COMPENSATORY`
có `deduct_balance = true`, `allow_negative_balance` NULL.
**Hệ quả:** tạo đơn nghỉ loại trừ phép → **422** "Số dư phép không đủ" (`leave-request.service.ts:545-552`).
**Workaround:** `/leave/balances` → cấp số dư phép năm (ghi giao dịch append-only).

### KI-003 — Loại nghỉ phép trùng bản chữ thường · S3

**Kiểm chứng:** `leave_types` có cả `ANNUAL/SICK/UNPAID` (chuẩn) lẫn `annual/sick/unpaid` (`deduct_balance`
NULL) → 11 dòng.
**Hệ quả:** danh sách chọn loại nghỉ hiện lặp; chọn nhầm bản chữ thường thì **không trừ phép**.
**Workaround:** xoá mềm 3 bản chữ thường ở `/leave/types` sau khi xác nhận không đơn nào tham chiếu.

### KI-004 — Chưa nhập ngày lễ · S3

`SELECT count(*) FROM public_holidays` → **0**. Số ngày nghỉ tính không trừ ngày lễ.
**Workaround:** `/system/public-holidays` nhập lịch lễ trước khi tính công/phép cho kỳ thật.

### KI-005 — Widget "Thông báo" trễ trong TTL · S3

Widget `NOTIFICATIONS` **không tự vô hiệu cache** khi có thông báo mới ⇒ số liệu cũ trong TTL ~10s rồi
tự lành. Đã có test khoá hành vi này: `qa2-e2e-task-noti-dash.int-spec.ts` (ca E3 — "known-issue
QA2-HIGH-001"). Chuông thông báo (không qua widget) **không** bị ảnh hưởng.

### KI-006 — LMS→NOTI chưa hoạt động · S2 → S3 (một nửa đã đóng 2026-07-26)

> **Đã đóng phần migration:** `m migrate` (PROD `mediaos`) + `m dev-online-migrate` (UAT
> `mediaos_dev`) ⇒ **cả hai 197/197**, 4 mã `LMS_*` có mặt. PROD health 200 sau migrate — 0529 chỉ
> nới CHECK + INSERT catalog nên **không cần restart** service. **Còn lại:** đặt `LMS_NOTI_TOKEN`
> hai phía + deploy theo `docs/plans/S5-LMS-NOTI-2.md` §4.

**Kiểm chứng:** `mediaos_dev` **và** `mediaos` (PROD) đều áp **196/197** migration;
`SELECT event_code FROM notification_events WHERE event_code LIKE 'LMS%'` → **0 dòng** ở cả hai.
**Hệ quả:** 4 mã sự kiện `LMS_ENROLLMENT_APPROVED` · `LMS_COURSE_ASSIGNED` · `LMS_EXAM_GRADED` ·
`LMS_COURSE_DEADLINE_NEAR` chưa tồn tại ⇒ intake từ LMS sẽ **404 event không tồn tại**.
**Code đã xong cả hai phía** (`S5-LMS-NOTI-1` merged PR #291 · `S5-LMS-NOTI-2` + runbook deploy
`153e2101`); còn **thiếu bước vận hành**: (1) áp `0529`, (2) đặt `LMS_NOTI_TOKEN` vào **cả**
`.env.prod` lẫn `.env` phía MediaOS và `apps/lms/.env.production` phía LMS, (3) deploy đúng thứ tự
API → LMS.
**Workaround/cách đóng:** `m dev-online-db` (UAT) · `m prod-update` (PROD — đã ép migrate trước
restart) · làm theo `docs/plans/S5-LMS-NOTI-2.md` §4 (runbook).

### KI-007 — CI Dependency scan đỏ vì công cụ · S3

`Security` workflow: job gitleaks **xanh**, job `pnpm audit` **đỏ** với
`ERR_PNPM_AUDIT_BAD_RESPONSE` (endpoint advisory npm trả body gzip pnpm không parse được).
**Tái hiện y hệt khi chạy `pnpm audit --audit-level=high` ở local** ⇒ lỗi phía công cụ/registry, **chưa
chứng minh có lỗ hổng high/critical**. **Cảnh báo:** đừng dùng job này làm bằng chứng "sạch lỗ hổng" —
hiện nó không nói được gì cả.

### KI-008 — Chưa diễn tập khôi phục backup · S2

Có `scripts/backup-db.sh` + `scripts/backup-restore-drill.sh`, **không tìm thấy biên bản/log drill nào
trong repo**. Backup chưa restore-test thì chưa tính là backup.
**Việc:** chạy drill 1 lần trên bản sao PROD, lưu biên bản vào `docs/DEVOPS/` (Sprint 6 `S6-PERF-DB-1`).

### KI-009 / KI-010 / KI-011 — 3 khuyến nghị treo từ S5-PERF-1

Nguyên văn `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` §4.2: R1 log JSON có cấu trúc ·
R2 phân trang thật cho `GET /employees` (hiện chặn bằng cap **2000 dòng**, có warn-log khi chạm cap —
không cắt câm) · R3 cảnh báo tự động. **KI-011 là điều kiện go-live**, hai cái kia không.

### KI-012 / KI-013 — 2 quyết định bảo mật cần đóng sổ

- **D3 (KI-012):** widget `hr-overview` count-only, đã mask PII, gate bằng **quyền widget** chứ không
  theo data-scope ⇒ HR được cấp scope Department vẫn thấy **con số** headcount toàn công ty. Không lộ
  PII cá nhân. **Cần owner ký chấp nhận cho MVP** (`RELEASE-04` §3).
- **D1 (KI-013):** `refresh` không throttle nhưng có reuse-detection + `FOR UPDATE`; `resetPassword`
  không throttle nhưng token entropy cao, lưu hash, dùng-một-lần, hết hạn ngắn. Kết luận: giữ nguyên,
  không thêm throttle suy đoán vào `auth.service.ts` (crown).

### KI-014 — Suite API crash khi chạy 1 tiến trình · S2 (hạ tầng test)

Chạy cả `@mediaos/api` một lần → `Unhandled Rejection: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`,
**0 ca test đỏ**, suite chết giữa chừng. `--no-file-parallelism` **không** cứu được (chết ở file thứ 61).
**Workaround duy nhất đang có: chia chunk** (6 lệnh vitest × ~75 file → 445 file / 7.113 test, 0 fail).
**Vì sao là S2:** nó làm `check.sh` in ĐỎ khi thực chất xanh ⇒ dễ dẫn tới bỏ qua đỏ THẬT.

**Cập nhật 2026-07-26 (`S6-STAB-1` — 2 đính chính, chi tiết `RELEASE-06` §4.4):**

1. **Không riêng API.** `@mediaos/app` cũng chết y hệt (`ERR_IPC_CHANNEL_CLOSED`; qua pnpm còn thấy
   exit `3221225477` = `0xC0000005` ACCESS_VIOLATION). Chia nhỏ → **199/199 file spec xanh**. Crash phụ
   thuộc **kích thước chunk**, không gắn với file nào: gộp `routes/{tasks,hr,goals}` (64 file) chết,
   tách từng cái thì xanh.
2. **CI KHÔNG dính — đây là chuyện máy local Windows.** CI chạy `ubuntu-latest`: `ci.yml:140` gọi
   `pnpm test` toàn workspace **một lần**, `apps-frontend.yml:95` chạy từng app; cả `CI` · `API — CI` ·
   `Apps — Frontend CI` đều **success** trên `dcf85eb0`. `api.yml` cũng đã set `LANE_DB: mediaos` ở
   bước Test (từ 2026-07-10) ⇒ deny-path/IDOR **có chạy thật** trong CI.

⇒ **Hạ "chặn go-live" từ ⚠️ xuống ❌**: không chặn release (CI vẫn là cổng thật). Cái nó chặn là **cổng
verify local** — `harness/check.sh` mọi tier không thể xanh trên máy Windows này.

### KI-015 — Nhiễu log outbox bridge trong test · S3

`OutboxNotificationBridge … intake THẤT BẠI` (6 lần trên lane sạch). Truy tới gốc: nhánh `no_recipient`
→ `recordSkip` → INSERT `audit_logs` vỡ **FK `audit_logs_actor_user_id_fkey`** vì outbox drain chạy sau
khi spec đã dọn user của mình. **Production không dính** (user là xoá mềm — BẤT BIẾN #2).
**Việc:** đợi outbox drain xong trước teardown, hoặc bỏ `actorUserId` khỏi audit skip.

### KI-016 — PROD dùng chung `dist` với dev-online · S2

Service PROD `MediaOS-API` chạy thẳng `apps/api/dist/main` của repo dev. Cả `m dev-online` lẫn
`m dev-online-fast` đều biên dịch lại thư mục đó ⇒ bật môi trường UAT có thể làm PROD nạp binary mới
trong khi DB PROD chưa áp migration tương ứng (đã từng gây PROD login 500 ngày 2026-07-08).
**Việc (go-live blocker):** cấp thư mục build riêng cho PROD.

### KI-017 — Refresh MV dashboard qua workerDb hỏng từ G14 · S3

`dashboard-refresh.service.ts:19-22` ghi rõ: REFRESH đòi role **owner** của materialized view (=`mediaos`),
nhưng `refreshDb` ưu tiên `workerDb` (`mediaos_worker`) ⇒ đường refresh runtime fail "must be owner" ở
mọi môi trường có `DATABASE_WORKER_URL`. Hiện **chưa consumer nào gọi tới** nên không lộ ra người dùng.
**Cấm sửa nhanh bằng `ALTER OWNER` cho worker** — worker không BYPASSRLS + `tasks` FORCE RLS ⇒ MV sẽ
**rỗng lặng lẽ**, tệ hơn lỗi hiện tại.

### KI-018 / KI-019 / KI-020 — 3 khoảng trống dữ liệu demo · S3

Trạng thái đơn nghỉ lẫn hoa/thường (`Pending` 1 · `pending` 2 · `approved` 1 · `Draft` 1) · chỉ 1 ca +
1 quy tắc chấm công + 0 phân ca (có fallback nên không chặn) · `goals` = 0.

### KI-021 — 3 sự kiện NOTI của ATT không có producer · S2 · phát hiện 2026-07-26 (`S6-STAB-1`)

`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED` được seed `isEnabled: true` trong
`notification-event-catalog.const.ts:82-84`, nhưng **không có nơi nào phát chúng** — toàn hệ chỉ đăng ký
**3** `@SystemJobHandler` (dọn file tạm · dọn theo chính sách lưu trữ · dọn `system_job_runs`), **không
có job ATT cuối ngày**. Chính code cũng ghi nhận: `dashboard-cache-invalidation.const.ts:43` — *"KHÔNG
có producer nào"*.

**Hệ quả:** người dùng bật/tắt được 3 loại thông báo không bao giờ tới; admin thấy chúng trong danh mục
sự kiện. **KHÔNG sai dữ liệu** — cờ `is_missing_check_out` đặt **đồng bộ** ngay lúc check-in/check-out
(`attendance.builders.ts:63,104`), không chờ job. **Workaround:** đơn điều chỉnh công
(`MISSING_CHECK_OUT`) đã chạy được.

**Defer** vì làm job mới là **tính năng**, bị `RELEASE-05` §4.2 từ chối sau freeze. Sau MVP chọn một
trong hai: build job ATT cuối ngày, **hoặc** đặt `isEnabled: false` cho 3 mã để UI không hứa cái không
có — đúng mẫu `ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER` đang dùng. Chi tiết: `RELEASE-06` §4.1.

### KI-022 / KI-023 — 2 nguồn ĐỎ-GIẢ trong suite · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-STAB-1`)

Cả hai đều **không phải lỗi sản phẩm**, nhưng làm suite đỏ **ngẫu nhiên** rồi xanh lại khi chạy đơn lẻ —
dạng nguy hiểm nhất vì dẫn tới thói quen "chạy lại cho xanh".

- **KI-022:** `outboxOf` trong `goal-be2-link.int-spec` truy vấn `outbox_events` **không lọc
  `company_id`** ⇒ đếm cả sự kiện của spec chạy song song. Đây là chỗ **duy nhất** sót; mọi spec outbox
  khác đã lọc.
- **KI-023:** `cleanupTenants` quét lại `audit_logs` trước `DELETE users` nhưng **không** trước
  `DELETE companies` ⇒ outbox worker còn sống ghi thêm audit trong cửa sổ đó làm vỡ FK
  `audit_logs_company_id_fkey`.

Verify: chạy lại **nguyên chunk `f–l`** (tái tạo đúng điều kiện tranh chấp) → **44/44 file ·
1.022/1.022 test xanh**. Chi tiết: `RELEASE-06` §4.2/§4.3.

### KI-024 — `foundation-audit.e2e-spec` đỏ-giả **vĩnh viễn** · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

Cùng họ với KI-022/023 nhưng **nặng hơn**: nó **không** tự khỏi khi chạy lại. `ACTION_A`/`ACTION_B` là
hằng cố định (`BE3SecretLeakA/B`) trong khi case `3f` đọc ở **System scope** (chéo tenant, RLS không
khoanh) và assert `length === 1`. `audit_logs` **append-only** ⇒ chỉ cần một lần chạy bị ngắt (Ctrl-C
hoặc crash worker KI-014) là hàng của lần đó nằm lại DB lane **vĩnh viễn**, mọi lần sau đếm ra 2 → đỏ.

Fix: gắn `RUN_TAG = randomUUID().slice(0,8)` vào `action`, đúng idiom sẵn có
(`audit-permission-deny.int-spec.ts:66`). Verify: chạy file đó **2 lần liên tiếp không dọn gì ở giữa** →
8/8 xanh cả hai lần, `count(*) … LIKE 'BE3SecretLeak%'` = 0. Chi tiết: `S6-QA-FINAL-1-FINAL-QA-PASS` §8.1.

### KI-025 — 98/346 đường dẫn API không có test HTTP nào chạm · S2 · phát hiện 2026-07-26 (`S6-QA-FINAL-1`)

**Đo, không phải ước lượng:** 452 route thật (decorator NestJS) / 346 đường dẫn phân biệt, đối chiếu với
mọi URL literal trong 446 file spec ⇒ **72% đường dẫn có test chạm, 28% không**.

**Rủi ro thật là gì:** guard · `ZodValidationPipe` · response envelope của các route đó **chưa từng chạy
trong test**. Hai bề mặt nghiệp vụ thật nằm trong nhóm này — `user-invites` (`/users/invite`,
`/users/pending`, `/users/:id/approve|reject|suspend|reactivate`) và `POST/GET /hr/profile-change-requests`
— đều được test **rất kỹ ở tầng service** (`new UserInvitesService(...)`, `profile-change-request.int-spec`)
nên nhìn bảng coverage sẽ tưởng đã phủ.

**Rủi ro KHÔNG phải là gì:** không phải "route bỏ ngỏ quyền". Trong 134 route chưa-test chỉ **9** route
vừa thiếu `@RequirePermission` vừa thiếu `@Public()`, và đều thuộc nhóm self-scoped có chủ đích
(`/auth/2fa/*`, `/auth/sessions/*`, `/me/*`) hoặc module CONTENT đã park — nhóm sau đã bị
`route-guard-coverage.e2e-spec.ts` chặn hồi quy.

**Workaround:** sweep tĩnh `route-guard-coverage.e2e-spec.ts` bắt được route MỚI quên gate.
**Chủ:** Sau MVP (thêm test = việc mới, `RELEASE-05` §4.2 chặn sau freeze).
**Bàn giao:** phán quyết từng dòng trong 35 route không-`@RequirePermission` thuộc `S6-SEC-1` (WS4 §13.2).

### KI-026 — Nhãn `[BLOCKED]` trên test ĐANG XANH · S3 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

`attendance-adjustment.int.spec.ts` mang 9 dòng chú thích "KNOWN BROKEN" + tên test
`… → 200 [BLOCKED — see comment above, service.ts bug]`, mô tả `detailInScope()` hard-code
`orgUnitId/directManagerUserId = null`. **Bug đã sửa trong CHÍNH commit đưa test vào** (`80a1bcd5`,
PR #81, 2026-07-02 — `detailInScope()` nạp employee thật qua `resolveRequestEmployee()`); chú thích
không được gỡ. Test XANH suốt từ đó.

Không phải defect, nhưng đủ để làm người đọc kết luận sai là ATT còn lỗi mở — đúng lớp rủi ro mà
`RELEASE-06` §1 cảnh báo, chỉ theo chiều ngược lại: **"code đọc có vẻ hỏng" cũng không phải bằng chứng**.
Fix: thay bằng ghi chú lịch sử + bỏ nhãn.

### KI-027 — 2FA không được ép ở PROD cho company-admin · **S1** · phát hiện 2026-07-26 (`S6-SEC-1`)

**Kiểm chứng (truy vấn read-only trên PROD `mediaos`):** `roles` có `requires_two_factor = true` cho
**`company-admin`** và **`platform-admin`**. Nhưng **cả ba lớp ép đều tắt**: (1) `.env` **và**
`.env.prod` đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=false` (schema default là `"true"`);
(2) `company_security_policies.two_factor_enforced = NULL` cho `funtime`; (3) user
`admin@funtimemediacorp.com` có `require_two_factor = false`.

Guard tính `effective2FA = globalEnv || policy.two_factor_enforced` ⇒ global OFF thì **chỉ** ép khi
công ty tự bật; công ty không bật ⇒ **không ép ai**.

**Hệ quả:** tài khoản quản trị công ty **duy nhất** của production (quản lý user · vai trò · quyền ·
nhật ký audit) vào được **chỉ bằng mật khẩu**.
**KHÔNG phải:** không phải bypass đăng nhập — ai **đã** enroll TOTP vẫn bị challenge. Vấn đề là
**không ai bị bắt buộc enroll**.
**Cách đóng (thứ tự BẮT BUỘC):** admin enroll 2FA ở `/me/security` → đặt cờ `=true` ở **cả** `.env`
lẫn `.env.prod` (nhớ `m prod-env` ghi đè `.env.prod`) → restart API → smoke login. **Đảo thứ tự = admin
ăn 403 `TWO_FACTOR_SETUP_REQUIRED` trên mọi route.**

### KI-028 — 16 tenant TEST + 25 user còn sống trong DB PROD · S2 · (`S6-SEC-1`)

**Kiểm chứng:** `select count(*) from companies` → **17**; khớp mẫu tenant test
`slug ~ '-[0-9a-f]{8}$'` → **16**; công ty thật duy nhất **`funtime`**. User thuộc 16 tenant đó: **25**.
**Hệ quả:** tài khoản **đăng nhập được** trong DB production với mật khẩu seed test.
**Giới hạn thiệt hại:** RLS giữ — phiên đó bị khoá trong tenant test của nó, **không** thấy dữ liệu
`funtime`; leo thang chéo tenant đã bị chặn (`rbac-operator-escalation.int-spec:92`).
**Lưu ý:** tái diễn lớp sự cố đã dọn 2026-07-22 (122 công ty test lọt PROD) ⇒ **nguồn rò chưa bịt**.
**Workaround/cách đóng:** xoá 16 tenant test + chặn test trỏ DB `mediaos`. Gợi ý gộp vào `S6-PERF-DB-1`.

### KI-029 — `PERMISSION_GUARD_ENABLED`: kill-switch fail-OPEN không validate · S2 · (`S6-SEC-1`)

`permission.guard.ts:57-68` đọc thẳng `process.env['PERMISSION_GUARD_ENABLED']`; `=== 'false'` ⇒
`return true` cho **mọi** route đã gate, chỉ để lại một dòng `logger.warn`. Biến **không** có trong
`env.schema.ts` lẫn `.env.example` ⇒ zod không validate, không ai biết nó tồn tại.
**Đã kiểm:** `.env` và `.env.prod` **không** chứa biến này ⇒ guard đang BẬT ở PROD.
**Đề xuất:** đưa vào schema (default `"true"`) + `.env.example`, và **fail-loud lúc boot** nếu
`NODE_ENV=production` mà cờ `false`. Là thay đổi hành vi sau freeze ⇒ cần owner duyệt.

### KI-030 — `GET /org/employees` trả danh bạ toàn tenant · S2 · (`S6-SEC-1`)

`org.controller.ts:173` không `@RequirePermission`; `org.repository.ts:322` trả `id · email ·
fullName · status` + team membership của **mọi** user chưa xoá trong tenant, cho **mọi** user đã đăng
nhập. Lệch với `/hr/employees` vốn ép data_scope (Employee Own chỉ thấy hồ sơ mình).
**Vì sao lọt lưới:** `route-guard-coverage.e2e-spec.ts:148` lọc `httpMethod !== "GET"` ⇒ sweep tĩnh
chỉ soi mutation.
**Vì sao không cao hơn:** danh bạ tài khoản, **không** phải hồ sơ HR (không lương/CCCD/công/phép);
`withTenant` + RLS giữ, không rò chéo tenant; FE chỉ gọi từ `apps/console`.
**Đường sửa đã khảo sát:** gate `read:user` — PROD đã cấp cho `company-admin`/`SA`/`project-manager`;
caller FE chỉ có 2 màn console của company-admin ⇒ siết không gãy UI.

### KI-031 — `INTERNAL_API_KEY` ngoài `env.schema`/`.env.example` · S3 · (`S6-SEC-1`)

`internal.guard.ts:23` đọc thẳng `process.env`. Guard **fail-CLOSED** (thiếu biến ⇒ 403 mọi route
`/internal/**`), nên hậu quả là **mất tính năng** (recalculate thủ công, invalidate cache), không phải
mất kiểm soát. **Đề xuất:** ghi vào `.env.example` + schema optional để lỗi hiện ra lúc boot.
---

## 3. Cái KHÔNG được defer

| Không được defer | Lý do |
| --- | --- |
| Bug lộ dữ liệu ngoài phạm vi quyền | Vi phạm BẤT BIẾN #1 |
| Hard-delete dữ liệu nghiệp vụ / ghi đè bảng append-only | Vi phạm BẤT BIẾN #2 |
| Secret dạng plaintext trong code/log/DTO | Vi phạm BẤT BIẾN #3 |
| Migration chưa áp ở PROD khi code đã yêu cầu | Chính là KI-006 — gây 500 hàng loạt |
| Bug chặn login / phiên / phân quyền | Không dùng được hệ thống |

---

## 4. Defer list — chuyển sang sau MVP

| Hạng mục | Chuyển tới | Lý do defer |
| --- | --- | --- |
| Throttle `refresh`/`resetPassword` | Phase sau (nếu nâng threat-model) | Đã có mitigation tương đương (KI-013) |
| Count theo Department cho widget `hr-overview` | Phase sau | Count-only, không lộ PII (KI-012) |
| Log JSON có cấu trúc (R1) | Sprint 6 `DEVOPS-MON-002` | Blast radius rộng, không phải rủi ro release |
| Phân trang thật `GET /employees` (R2) | WO `HR-PAGINATE-LEGACY` | Đã có cap 2000 chặn rủi ro |
| Realtime WebSocket đầy đủ | Post-MVP | MVP dùng polling/refresh thủ công |
| Load test quy mô lớn | Release phase | MVP chỉ smoke/baseline |
| Đa công ty (SaaS) | Post-MVP | Đang chạy N=1; hạ tầng RLS giữ nguyên để mở sau |
| Module Payroll · Recruit · Asset · Room · Chat · Social · Mobile | Phase 2–5 | Ngoài phạm vi MVP theo SPEC-01 §7 |
