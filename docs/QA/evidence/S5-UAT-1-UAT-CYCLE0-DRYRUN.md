# S5-UAT-1 — UAT Cycle 0 (readiness / dry-run) — BIÊN BẢN

> Deliverable **B** của Work Order `S5-UAT-1`. `QA-09 §13.1` Cycle 0 · `IMPLEMENTATION-08 §23.2` T015.
> Chạy: **2026-07-26** · nhánh `master` `153e2101` · migration journal head **idx 196 / `0529`** (197 entry).
> Người chạy: phiên Claude Code (dry-run kỹ thuật). **Cycle 1–3 với business user chưa chạy.**
>
> **Nguyên tắc:** Cycle 0 KHÔNG nghiệm thu nghiệp vụ. Nó trả lời đúng một câu: *"Bật UAT lên bây giờ
> thì business user có chạy được script không, hay sẽ kẹt ngay bước 3?"* — và câu trả lời là
> **chưa chạy được**, vì 3 chặn ở §4.

---

## 1. Kết luận điều hành

| Câu hỏi | Trả lời |
| --- | --- |
| Chất lượng code có đủ để mở UAT? | ✅ **CÓ** — 10.086 test xanh, 0 fail; 0 lỗ bảo mật CRITICAL/HIGH mở |
| Môi trường UAT có sẵn sàng? | ❌ **CHƯA** — API UAT (:3200) đang tắt; DB UAT **thiếu 1 migration** |
| Dữ liệu UAT có đủ để chạy script? | ❌ **CHƯA** — 4 tài khoản `uat.*` chưa gắn hồ sơ nhân viên; chưa có số dư phép |
| Có được phép bắt đầu Cycle 1 chưa? | ⛔ **CHƯA** — phải đóng UAT-BLOCK-001/002/003 trước (đều là **dữ liệu/vận hành**, KHÔNG phải lỗi code) |

**Ước lượng công để mở được Cycle 1:** ~30–60 phút thao tác của owner (áp 1 migration, gắn 3 hồ sơ
nhân viên + 1 quan hệ quản lý, cấp số dư phép, bật stack). Không cần sửa code.

---

## 2. Bằng chứng tự động (đã chạy trong phiên này)

### 2.1 Lint · typecheck

`bash harness/check.sh --lane-db=uat1` → **lint ✅ · typecheck ✅**.

### 2.2 Test — chạy THẬT trên Postgres, DB cô lập theo lane

| Gói | Test file | Test | Kết quả |
| --- | ---: | ---: | --- |
| `@mediaos/contracts` | 32 | 536 | ✅ |
| `@mediaos/web-core` | 39 | 635 | ✅ |
| `@mediaos/ui` | 16 | 98 | ✅ |
| `@mediaos/auth` | 4 | 23 | ✅ |
| `@mediaos/console` | 23 | 179 | ✅ |
| `@mediaos/app` | 199 | 1.502 | ✅ |
| `@mediaos/api` (6 chunk, `LANE_DB`) | 445 passed + 1 skipped | **7.113 passed** · 1 todo · 15 skipped | ✅ **0 fail** |
| **TỔNG** | **759** | **10.086 passed** | ✅ |

API chạy như CI (`LANE_DB` set ⇒ deny-path / IDOR / cross-tenant **thực thi thật**, không skip).

```bash
# tái lập (đúng cách — xem §2.3 về vì sao phải chia chunk)

bash scripts/lane-db-setup.sh uat1
cd apps/api
LANE_DB=mediaos_uat1 pnpm exec vitest run <danh-sách-file-chunk>   # 6 chunk × ~75 file
```

### 2.3 Hai bẫy gặp phải khi lấy số — ghi lại để lần sau không mất thời gian

**(a) `check.sh` báo ĐỎ nhưng KHÔNG có test nào fail.** Chạy cả suite `@mediaos/api` trong một tiến
trình → vitest chết giữa chừng với `ERR_IPC_CHANNEL_CLOSED` (`Unhandled Rejection: Channel closed`),
**0 ca test đỏ**, chỉ có worker chết. `--no-file-parallelism` **KHÔNG** cứu được (đã thử — chết ở
file thứ 61). Chỉ chia **chunk** (6 lệnh vitest riêng) mới ra số xác định. Đây là bẫy đã có trong sổ
(`vitest-worker-crash-chunked-runs`), lần này tái hiện đúng nguyên văn.

**(b) Lane DB BẨN gây đỏ-giả.** Chunk 04 đỏ **1 ca** trên lane `mediaos_uat1` (lane đã bị 2 lần chạy
crash trước đó làm bẩn):

```
× goal-be2-link.int-spec.ts > L4 ... payload goal.assigned/goal.finalized KHỚP TỪNG KHOÁ
  → expected 'Hệ thống' to be 'Trưởng phòng A'
```

Chạy lại **cùng chunk 04, cùng 69 file** trên lane **sạch** `mediaos_uatgoal` → **69/69 file ·
1.503 test PASS**. Chạy riêng file đó trên lane sạch → 10/10 PASS. ⇒ **đỏ-giả do trạng thái DB tồn
dư**, không phải regression trên master. (Kết luận này rút ra bằng chạy lại, không bằng suy đoán.)

---

## 3. Đối chiếu Entry Criteria QA-09 §11

| Mã | Điều kiện | Trạng thái | Bằng chứng / việc còn thiếu |
| --- | --- | --- | --- |
| QA09-ENTRY-001 | Build candidate đã deploy lên UAT | ❌ **CHƯA** | Cổng **:3200 (UAT) không lắng nghe**; chỉ :3100 (PROD) và :3400 (LMS) đang chạy. Owner bật bằng `m dev-online-fast` (đọc cảnh báo landmine ở plan §4) |
| QA09-ENTRY-002 | Migration + seed chạy thành công | ❌ **CHƯA** | `mediaos_dev` áp **196/197** migration → thiếu `0529`. Kiểm chứng: `SELECT event_code FROM notification_events WHERE event_code LIKE 'LMS%'` trả **0 dòng** ở CẢ `mediaos_dev` LẪN `mediaos` (PROD). ⇒ **UAT-BLOCK-003** |
| QA09-ENTRY-003 | Smoke pass AUTH/HOME/ATT/LEAVE/TASK/NOTI | ⚠️ **PASS-tự-động** | `qae2e1-full-journey.int-spec.ts` 7/7 (đăng nhập → my-apps → chấm công → nghỉ phép → duyệt → sync ATT → task → thông báo → dashboard → đăng xuất). **Chưa smoke trên UI môi trường UAT** |
| QA09-ENTRY-004 | E2E P0 pass hoặc có exception được duyệt | ✅ | như trên + `qa2-e2e-task-noti-dash` 6/6 · `leave-att-sync-qa2` · `att-noti-e2e` |
| QA09-ENTRY-005 | Không còn bug Blocker/Critical mở | ✅ | `S5-SEC-1` báo cáo: **0 CRITICAL · 0 HIGH** mở; 1 accepted-risk D3 chờ owner ký |
| QA09-ENTRY-006 | Regression chính pass ≥95% | ✅ | 100% ca đã chạy pass (§2.2); ma trận module × P0/P1 phủ 10/10 module (`S5-QA-REG-1`) |
| QA09-ENTRY-007 | Known issues đã công bố | ✅ | `RELEASE-02_Known_Issues_MVP.md` (giao trong WO này) |
| QA09-ENTRY-008 | Tài khoản UAT + test data sẵn sàng | ❌ **CHƯA** | Tài khoản CÓ (§3.1); **dữ liệu THIẾU** → UAT-BLOCK-001/002 |
| QA09-ENTRY-009 | UAT scenario sheet được Product/Business duyệt | ⏳ **CHỜ KÝ** | Bản thảo đủ: `S5-UAT-1-UAT-KIT.md` §5 (30+18+19+17 = 84 scenario) |
| QA09-ENTRY-010 | Người dùng UAT đã được hướng dẫn | ⏳ **CHỜ** | Ghi chú hướng dẫn nhanh: KIT §6; owner phổ biến trước buổi UAT |

**Kết luận Entry:** 4/10 chưa đạt ⇒ **chưa được mở Cycle 1**. Cả 4 đều nằm ở **môi trường/dữ liệu**,
không có cái nào đòi sửa code.

### 3.1 Tài khoản UAT — đã kiểm chứng tồn tại

Truy vấn read-only trên `mediaos_dev` (2026-07-26):

| Email | Vai trò gắn thật | Có hồ sơ nhân viên? |
| --- | --- | --- |
| `uat.employee@demo.local` | `employee` | ❌ KHÔNG |
| `uat.manager@demo.local` | `manager` | ❌ KHÔNG |
| `uat.hr@demo.local` | `hr` | ❌ KHÔNG |
| `uat.admin@demo.local` | `company-admin` | ❌ KHÔNG (không cần cho script Admin) |
| `sa@demo.local` | `super-admin` | ❌ KHÔNG (không cần) |

---

## 4. Phát hiện Cycle 0 — triage

| ID | Phát hiện | Loại | Mức | Chặn UAT? | Chủ |
| --- | --- | --- | --- | --- | --- |
| **UAT-BLOCK-001** | 3 tài khoản `uat.employee/manager/hr` **không có hồ sơ nhân viên** (`employee_profiles.user_id`) và `uat.manager` **không có cấp dưới** | Dữ liệu | S2 | ✅ CHẶN | Owner/HR |
| **UAT-BLOCK-002** | `leave_balances` = **0 dòng** toàn công ty `demo` | Dữ liệu | S2 | ✅ CHẶN (nghỉ phép) | Owner/HR |
| **UAT-BLOCK-003** | `mediaos_dev` **và** `mediaos` (PROD) đều thiếu migration `0529` ⇒ chưa có 4 mã sự kiện `LMS_*` | Vận hành | S2 | ✅ CHẶN (LMS→NOTI) | Owner/DevOps |
| UAT-OBS-004 | 3 loại nghỉ phép **trùng bản chữ thường** (`annual`/`sick`/`unpaid`) tồn tại song song với `ANNUAL`/`SICK`/`UNPAID`, `deduct_balance` = NULL | Dữ liệu | S3 | ❌ | Owner/HR |
| UAT-OBS-005 | `public_holidays` = **0** ⇒ tính ngày nghỉ không trừ ngày lễ | Dữ liệu | S3 | ❌ | Owner/HR |
| UAT-OBS-006 | Chỉ **1 ca làm việc** + **1 quy tắc chấm công**, **0 phân ca** (QA-09 §10.3 yêu cầu ≥2) | Dữ liệu | S3 | ❌ (đã có fallback ca/quy tắc mặc định — xác minh ở `attendance.service.ts:384-419`) | Owner/HR |
| UAT-OBS-007 | 5 đơn nghỉ có **trạng thái lẫn hoa/thường** (`Pending` 1 · `pending` 2 · `approved` 1 · `Draft` 1) — dữ liệu demo cũ | Dữ liệu | S3 | ❌ | Sprint 6 triage |
| UAT-OBS-008 | `goals` = 0 ⇒ module GOAL chưa có dữ liệu để nghiệm thu | Dữ liệu | S3 | ❌ (P2) | Owner |
| UAT-NOTE-009 | Log `OutboxNotificationBridge … intake THẤT BẠI` xuất hiện **6 lần** trong chạy chunk-04 trên lane **sạch** | Vệ sinh test | S3 | ❌ | Sprint 6 |

### 4.1 UAT-NOTE-009 — đã truy tới gốc, KHÔNG phải lỗi production

Chuỗi: `OutboxWorker → OutboxNotificationBridge.handle → NotificationEngine.intake` →
nhánh `no_recipient` → `recordSkip` → `AuditService.record` → **INSERT `audit_logs` thất bại** →
bridge ném lỗi → outbox retry.

Truy nguyên bằng cách dựng lại đúng câu INSERT trên DB lane:

```sql
-- actor_user_id KHÔNG tồn tại trong users
INSERT INTO audit_logs (action, object_type, module_code, actor_user_id, metadata)
VALUES ('notification_skipped','notification','NOTI','e2e16090-…','{}');
-- ERROR: insert or update on table "audit_logs" violates foreign key constraint
--        "audit_logs_actor_user_id_fkey"
```
(Cùng câu INSERT với `actor_user_id` hợp lệ → **thành công**; `object_type='notification'` NẰM TRONG
CHECK hợp lệ; RLS/quyền `mediaos_app` đều OK.)

⇒ Nguyên nhân: outbox drain **chạy sau khi spec đã dọn user của mình** — actor không còn trong `users`
nên FK vỡ. **Production không dính** vì user là **xoá mềm** (BẤT BIẾN #2), hàng `users` vẫn còn.
Xếp loại: **nhiễu log trong test**, cần dọn ở Sprint 6 (đợi outbox drain xong trước khi teardown),
KHÔNG phải defect sản phẩm.

### 4.2 Cách đóng 3 blocker

| Blocker | Cách làm |
| --- | --- |
| UAT-BLOCK-003 | `m dev-online-db` (áp `0529` cho `mediaos_dev`). **PROD**: `m prod-update` — script đã ép migrate TRƯỚC restart (fail-closed, `S5-DEVOPS-DEPLOYMIG-1`) |
| UAT-BLOCK-001 | UI: `/hr/employees` → tạo/chọn 3 hồ sơ → **Liên kết tài khoản** (`LinkUserDialog`) cho `uat.employee`/`uat.manager`/`uat.hr`; rồi `/hr/org-chart` đặt `uat.manager` làm quản lý trực tiếp của `uat.employee` |
| UAT-BLOCK-002 | UI: `/leave/balances` → cấp số dư phép năm cho `uat.employee` (và `uat.manager`); mỗi lần cấp đều ghi giao dịch số dư (append-only) |

> Cả 3 việc trên **cố ý KHÔNG tự động hoá trong WO này**: đụng dữ liệu môi trường UAT sống
> (`mediaos_dev` là DB thật đang dùng, không drop/wipe) — để owner tự làm qua đường UI có audit,
> đúng tinh thần "UAT dùng đường thật của sản phẩm".

---

## 5. Phạm vi thao tác của Cycle 0 (an toàn)

- Trên `mediaos_dev` (UAT) và `mediaos` (PROD): **chỉ SELECT**. Không INSERT/UPDATE/DELETE, không
  drop, không seed, không restart service nào.
- Trên lane DB dùng-một-lần `mediaos_uat1` / `mediaos_uatgoal`: chạy test + 1 hàng `companies` thăm dò
  (đã xoá sau khi dùng). Hai lane DB này dọn sau phiên (chống phình `pgdata`).
- **Không tự bật dev-online** — vì `apps/api/dist` dùng chung với service PROD `MediaOS-API` (:3100
  đang phục vụ công ty `funtime`); build lại có thể làm PROD lỗi. Việc bật để owner quyết (plan §4).

---

## 6. Đề nghị

1. Owner đóng **UAT-BLOCK-003** trước (1 lệnh, đồng thời gỡ nợ migration cho PROD).
2. Owner đóng **UAT-BLOCK-001/002** qua UI (~30 phút) → chụp lại làm bằng chứng UAT-DEL-003.
3. Bật UAT, chạy `bash scripts/canary-watch.sh` (health + readiness) → chỉ khi xanh mới mở Cycle 1.
4. Chạy Cycle 1 theo KIT §5, ghi vào KIT §7, ký ở `RELEASE-04`.
5. Sprint 6 nhận: UAT-OBS-004/005/006/007/008 + UAT-NOTE-009 + 2 bẫy hạ tầng test ở §2.3.
