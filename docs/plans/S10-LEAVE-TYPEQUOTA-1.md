# S10-LEAVE-TYPEQUOTA-1 — `annualQuota` của `leave_types`: KHÔNG phải "route đọc bỏ sót", mà là **cột GHI-RỒI-BỎ** (KI-081)

> 🟡 Vùng vàng · LIGHT gate (`typescript-reviewer` + `quality-gate`). Không chạm permission/RLS/secret/migration.
> Plan viết SAU khi đo bằng HTTP thật trên lane DB `mediaos_typequota` 2026-08-26
> ([[wo-plans-built-on-code-comments]]) — không dựng trên chú thích code, không dựng trên mô tả của KI-081.

## §0 — PHÁT BIỂU MỨC ĐỘ TRƯỚC (điều kiện nghiệm thu #1)

**Trôi hợp đồng đọc/ghi ⇒ KHÔNG phải lỗ bảo mật.** Route đọc trả **THIẾU** một trường, không **RÒ** trường
nào. Không có dữ liệu của tenant khác, không có trường nhạy cảm nào lọt ra. Mức S4 giữ nguyên.

## §1 — SỐ ĐO: hình dạng THẬT của 4 route loại nghỉ

Đo bằng probe HTTP trên lane DB `mediaos_typequota` (actor `company-admin` có đủ cặp quyền), 26/08:

| Route                              | Mã  | Số trường | Có `annualQuota`? |
| ---------------------------------- | --- | --------- | ----------------- |
| `POST /leave/types`                | 201 | 6         | ✅ **có** (= 9)   |
| `PATCH /leave/types/:id`           | 200 | 6         | ✅ **có** (= 15)  |
| `GET /leave/types` (đọc chính tắc) | 200 | 18        | ❌ **không**      |
| `GET /leave/admin/types` (màn QT)  | 200 | 19        | ❌ **không**      |

WO yêu cầu kiểm CẢ HAI route đọc trước khi kết luận — đã kiểm: **cả hai đều không có**, và chúng chỉ khác
nhau đúng một trường (`allowNegativeBalance`, chỉ mặt admin). Không có route đọc nào trả `annualQuota`.

### Bảng CHÊNH LỆCH TRƯỜNG (điều kiện nghiệm thu #2)

| Nhóm                              | Trường                                                                                                                                                                                                                                     | Số  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| Chung cả ghi lẫn đọc              | `id` · `name` · `code` · `paid` · `status`                                                                                                                                                                                                 | 5   |
| **CHỈ có ở đường GHI**            | **`annualQuota`**                                                                                                                                                                                                                          | 1   |
| Chỉ có ở đường ĐỌC                | `description` · `deductBalance` · `balanceUnit` · `allowFullDay` · `allowHalfDay` · `allowHourly` · `allowMultipleDays` · `requireReason` · `requireAttachment` · `minNoticeDays` · `maxDaysPerRequest` · `maxHoursPerRequest` · `sortOrder` | 13  |
| Chỉ có ở `GET /leave/admin/types` | `allowNegativeBalance`                                                                                                                                                                                                                     | 1   |

⇒ **`annualQuota` là trường DUY NHẤT** đường ghi có mà đường đọc không có. WO hỏi "có thể không phải trường
duy nhất" — đã đo: **đúng là duy nhất**. Chiều ngược lại lệch 13–14 trường, nhưng đó là chủ ý (view giàu
theo mig 0453), không phải nợ.

## §2 — LẬT NGƯỢC CHẨN ĐOÁN: lỗi KHÔNG nằm ở route đọc

KI-081 phát biểu "route đọc **bỏ sót**". Census cho thấy chẩn đoán này **ngược**:

**1. `leave_types.annual_quota` KHÔNG nằm trong thiết kế chuẩn.**
`docs/DB/DB-05 §7.1` liệt kê đủ 26 cột của `leave_types` — **không có `annual_quota`**. Nó là cột di sản
thời G11, có trong `db/schema/hr.ts:337` nhưng chưa bao giờ có trong `docs/DB`. Theo CLAUDE.md: mâu thuẫn
code↔thiết kế thì **`docs/DB` là chuẩn**, không phải code.

**2. Hạn mức năm theo thiết kế sống ở `leave_policies`, không ở `leave_types`.**
`leave_policies.yearly_quota_days` (mig 0453 · DB-01 dòng 1240 `annual_quota_days`) mới là hạn mức thật —
scope được (Company/Department/Employee/JobLevel/ContractType), trong khi cột trên `leave_types` chỉ có một
giá trị phẳng cho cả công ty. Chính seeder đã ghi rõ: `leave-master-data.seeder.ts:46` — _"KHÔNG set
annual_quota (đặt ở policy)"_.

**3. `annual_quota` KHÔNG CÓ MỘT NGƯỜI ĐỌC NÀO trong toàn bộ app.** Census `annual_quota|annualQuota` trên
`apps/api/src` + `apps/*/src` + `packages/*/src`:

| Vai trò  | Nơi                                                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khai cột | `db/schema/hr.ts:337`                                                                                                                                                                                                                  |
| **GHI**  | `leave.service.ts:61` (create) · `:94` (update)                                                                                                                                                                                        |
| **ĐỌC**  | **KHÔNG CÓ.** Engine cộng dồn đọc `leavePolicies.yearlyQuotaDays` (`leave-accrual.repository.ts:34` → `leave-accrual.logic.ts:205`); carryover, report, balance đều vậy                                                                 |
| FE       | **KHÔNG CÓ.** Màn LEAVE-SCREEN-010 dùng `/leave/admin/types` + `leaveTypeAdminViewSchema`; `leave-type-form.ts` không có field hạn mức                                                                                                  |

**4. `leaveTypeSchema` (chỗ khai `annualQuota` "bắt buộc") KHÔNG validate gì cả.** Nó không được
`createZodDto` nào dùng, không được `apiFetch` nào dùng — DTO thật của đường ghi là
`createLeaveTypeSchema`/`updateLeaveTypeSchema`, của đường đọc là `leaveTypeViewSchema`. `leaveTypeSchema`
là một `type` mồ côi. "Contract khai bắt buộc" trong KI-081 vì thế **không có hiệu lực runtime nào**.

⇒ Sự thật: `PATCH /leave/types/:id {annualQuota:15}` ghi một con số vào một cột **không ai đọc, không có
trong thiết kế, và không ảnh hưởng tới bất kỳ phép tính nghỉ phép nào**.

## §3 — QUYẾT ĐỊNH CÓ Ý THỨC (điều kiện nghiệm thu #3)

WO cho hai nhánh. Chọn **nhánh B — sửa hợp đồng cho khớp thiết kế**, và mở rộng sang cả đường GHI:

| Nhánh                                                          | Kết cục                                                                                                                                                                                                                                                                                                     | Chốt        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **A** — bổ sung `annualQuota` vào `leaveTypeViewSchema` + view  | Đọc lại được con số, nhưng con số đó **vẫn không điều khiển gì**. Admin đặt hạn mức 15 ở màn loại nghỉ, engine cộng dồn vẫn chạy theo policy ⇒ đúng khuôn [[ui-promises-backend-never-reads]]. Còn kéo cột ngoài-thiết-kế vào **cả hai** payload đọc (view + admin view kế thừa) và vào FE.                    | ❌ **BÁC**  |
| **B** — gỡ `annualQuota` khỏi hợp đồng **và khỏi đường ghi**    | Không còn cách nào ghi một giá trị không ai đọc được. Hợp đồng khớp DB-05 §7.1. Hạn mức chỉ còn MỘT nhà: `leave_policies.yearly_quota_days`.                                                                                                                                                                 | ✅ **CHỌN** |

**Vì sao mở rộng sang đường GHI thay vì chỉ sửa chữ trong contract:** nếu chỉ gỡ trường khỏi `leaveTypeSchema`
mà vẫn để `POST/PATCH` nhận + trả nó, ta đổi một trôi **ồn ào** (đo được, đã thành KI-081) lấy một trôi **câm**
(ghi vẫn nhận, vẫn lưu, không ai thấy). Đó là cách KI-081 sinh ra lần đầu.

**KHÔNG làm migration ở WO này.** Cột `annual_quota` giữ nguyên trên DB (nullable, dữ liệu cũ còn nguyên) —
gỡ cột là việc vùng đỏ, cần WO riêng. Ở đây chỉ đóng đường ghi mới; giá trị cũ đóng băng, vốn dĩ đã không ai đọc.

**Hành vi quan sát được sau vá:** body gửi kèm `annualQuota` vẫn **200/201** (Zod `z.object` lược khoá lạ —
không đổi mã trả về, không phá client nào), nhưng giá trị **không được lưu** và **không có trong phản hồi**.
Đường ghi mới ⇒ cột `annual_quota` = `NULL`.

## §4 — Hộ tiêu thụ (điều kiện nghiệm thu #5)

Census toàn repo cho `POST|PATCH /leave/types` + `annualQuota`: **hộ tiêu thụ duy nhất là chính int-spec**
(`routehttp3-attendance-leave.int-spec.ts` — 3 chỗ). Không FE, không script, không seeder. `constants.ts:124`
và `sidebar-registry.ts:429` là đường **trình duyệt** `/leave/types`, không phải đường API.

⇒ Đây **KHÔNG** phải lỗi nhìn thấy được trên FE. Mức S4 của KI-081 giữ nguyên — **không nâng**.

## §5 — Ca ghim: vì sao KHÔNG lật sang `toBe(15)` (lệch với done_when #4 — khai rõ)

done_when #4 bảo "LẬT `toBeUndefined()` sang `toBe(<giá trị>)`". Câu đó **giả định nhánh A**. Đi nhánh B thì
`toBeUndefined()` chính là khẳng định **ĐÚNG và vĩnh viễn** — lật nó sang `toBe(15)` là ghim ngược lại đúng
cái nợ vừa gỡ.

Giữ `toBeUndefined()` nhưng **đổi vai của ca**, vì để nguyên nhãn `🔴 GHIM BUG` thì người sau sẽ "vá" nó theo
nhánh A ([[tests-can-pin-a-hole-open]] chiều ngược):

- Đổi tiêu đề + chú thích: từ _"ghim hành vi SAI"_ → _"khẳng định hợp đồng: hạn mức KHÔNG thuộc mặt `leave_type`"_.
- **Thêm ca mới** chứng minh đường ghi đã đóng THẬT: `POST /leave/types {annualQuota:9}` ⇒ 201, phản hồi
  không có `annualQuota`, và `SELECT annual_quota` trên DB = `NULL`. Không có ca này thì "đã gỡ" là suy luận.
- Ca đo cũ (`PATCH ... {annualQuota:15}` ⇒ phản hồi 15 + cột DB 15) phải viết lại theo sự thật mới, giữ
  vế ALLOW (PATCH `name`/`status` vẫn 200 và vẫn đọc lại được) để ca không thành xanh-rỗng
  ([[deny-cases-vacuous-without-allow-case]]).

## §6 — Danh sách sửa

| #   | File                                                       | Việc                                                                                                                                                     |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/contracts/src/leave.ts`                          | Gỡ `annualQuota` khỏi `leaveTypeSchema` · `createLeaveTypeSchema` · `updateLeaveTypeSchema`; ghi chú trỏ về `leave_policies.yearlyQuotaDays` + DB-05 §7.1 |
| 2   | `apps/api/src/leave/leave.service.ts`                      | Gỡ map `annualQuota` ở `createType` · `updateType` · `toTypeDto`                                                                                          |
| 3   | `apps/api/test/integration/routehttp3-…-leave.int-spec.ts` | Đổi vai ca ghim · viết lại ca PATCH · thêm ca chứng minh cột = NULL                                                                                       |
| 4   | `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md`              | Đóng KI-081 kèm bảng chênh lệch trường + khai rõ đi nhánh B                                                                                              |
| 5   | `harness/backlog.mjs`                                      | `status: "done"`                                                                                                                                         |

## §7 — Nghiệm thu

- `pnpm --filter @mediaos/contracts build` + `pnpm typecheck` xanh (contracts dual-build trước — [[stale-contracts-dist-typecheck-false-red]]).
- `LANE_DB=mediaos_typequota` chạy `routehttp3-attendance-leave.int-spec.ts` + `leave-*.int.spec.ts` xanh.
- `pnpm --filter @mediaos/api test` + `pnpm lint` xanh.
