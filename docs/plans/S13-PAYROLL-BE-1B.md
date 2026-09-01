# Micro-plan — `S13-PAYROLL-BE-1B` (🔴 red · FULL gate · code + SPEC, KHÔNG migration)

> **WO:** Đầu vào phép theo NỬA NGÀY. Sửa **SPEC-11 §13.4 TRƯỚC** (định nghĩa `paid_leave_days`/`unpaid_leave_days`/`present_days` sang numeric), rồi vá `PayrollInputsRepository`. Hiện mọi đơn nghỉ nửa buổi bị đếm **tròn 1 ngày**.
> **Nguồn sự thật:** [SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) §13.4 · [DB-05 §7.6](<../DB/DB-05 LEAVE Database Design.md>) · [S13-PAYROLL-BE-1](S13-PAYROLL-BE-1.md).
> **Nhánh:** `wo/s13-payroll-be-1b` từ `master` (BE-1 đã merge #456). Vùng 🔴 ⇒ **người chốt merge**, KHÔNG nhãn auto-merge.
> **Không migration:** cột đích đã là `numeric(8,2)` (`payroll_period_lines`/`payslips` — `schema/payroll.ts:215-217, 316-318`); contract đã là `z.number()` (`packages/contracts/src/payroll.ts:307-310, 382-385`). Chỉ SQL trong repository ép `::int`.

---

## 0. ĐO THẬT (01/09/2026) — không suy từ tài liệu

Chạy **đường ghi THẬT** (`LeaveRequestService.createDraft` → `writeDayRows`) trên lane DB sạch, công ty `working_days_json={"days":[1..5]}`, kỳ `2027-11`:

| Đơn (thật, tạo qua service) | `leave_requests.total_days` `numeric(5,1)` | `leave_request_days` (Active) |
| --- | --- | --- |
| 03/11 HalfDay Morning | **0.5** | 1 hàng · `leave_days=0.50` · `is_working_day=true` |
| 04/11 FullDay | 1.0 | 1 hàng · `1.00` |
| 05/11 Hourly 09:00→12:00 | **0.4** ⚠️ (giá trị thật 0.375 — bị `numeric(5,1)` làm tròn) | 1 hàng · **`0.38`** (`numeric(8,2)`) |
| 11→16/11 MultipleDays (bắc T7/CN) | 4.0 | **4 hàng** — cuối tuần KHÔNG đẻ hàng |
| 29/11→03/12 MultipleDays (**bắc biên THÁNG**) | 5.0 | 5 hàng: **2 trong T11**, 3 trong T12 |

Đo tiếp trên cùng dữ liệu:

- `PayrollInputsRepository` hiện tại: `paidLeaveDays = 9` — **sai**; con số đúng theo ngày = `0.5 + 1 + 0.38 + 4 + 2 = 7.88`.
- Ứng viên A (`leave_request_days ⋈ cal_work`, chỉ T11) = **7.88** ✓.
- Đường ghi `leave_requests` **DUY NHẤT** còn sống là `LeaveRequestService.createDraft` (`leave-request.service.ts:82`) và nó **luôn** ghi day-rows trong CÙNG tx (`:110`); `leave.repository.insertRequestTx` là code chết (0 caller). ⇒ đơn tạo bởi ứng dụng **luôn có** day-rows.

## 0b. Quyết định — nguồn nào THẮNG

**`leave_request_days` THẮNG.** Hai lý do ĐO ĐƯỢC, không phải khẩu vị:

1. **Quy kết theo KỲ.** `total_days` là con số của **cả đơn**; đơn 29/11→03/12 mang `5.0` trong khi kỳ T11 chỉ được hưởng `2`. Muốn tách vẫn phải bung ngày ⇒ `total_days` không thể là nguồn.
2. **Độ chính xác.** `total_days` là `numeric(5,1)`: Hourly 0.375 ngày bị lưu **0.4** (sai số 0.025 ngày/đơn, đi thẳng vào tiền). `leave_request_days.leave_days` là `numeric(8,2)` → `0.38`.

**Khi LỆCH / khi THIẾU:** một đơn đã duyệt mà **không có** day-rows Active nào (dữ liệu di sản/nhập tay ngoài ứng dụng — không sinh ra được qua API hôm nay) ⇒ **rơi về** cách cũ: bung đơn trên `cal_work`, mỗi ngày = `1.00`. Lý do: nguồn day-row là **rỗng**, không phải **bằng 0**; đọc rỗng thành 0 là mất lặng lẽ một khoản tiền (nghỉ không lương biến mất khỏi khấu trừ). Fallback ở **mức ĐƠN**, không mức ngày — một đơn có day-rows thì day-rows quyết TOÀN BỘ đơn đó (không trộn hai nguồn trong một đơn ⇒ không đẻ ngày ma).

> ⚠️ Lệch so với `done_when` của WO ("bội của 0.5"): **đo được 0.38** cho đơn Hourly ⇒ SPEC phải viết **numeric 2 chữ số thập phân** (thường là bội 0.5, nhưng `Hourly` cho phân số bất kỳ). Ghim "bội của 0.5" vào SPEC là ghim một điều SAI.

## 1. `present_days` — quy tắc mới (tử số pro-rate)

Trước: `COUNT(DISTINCT d)` trên `att ∪ (lv paid)` ⇒ nửa buổi phép = **1**.
Sau: cộng theo NGÀY, mỗi ngày lấy **`GREATEST(công_ngày, phép_có_lương_ngày)` rồi clamp trần 1**:

| Ngày | công | phép có lương | present |
| --- | --- | --- | --- |
| có bản ghi công + phép nửa buổi có lương | 1 | 0.5 | **1** (đúng `done_when`: KHÔNG thành 1.5) |
| chỉ phép nửa buổi có lương | 0 | 0.5 | **0.5** |
| chỉ phép nguyên ngày có lương | 0 | 1 | 1 |
| chỉ công | 1 | 0 | 1 |

`GREATEST` (không phải `SUM`) giữ nguyên bất biến "một ngày đếm một lần" mà BE-1 đã đóng bằng `UNION`; clamp trần 1 chặn đơn chồng đơn (hai đơn nửa buổi cùng ngày) đẩy một ngày lên > 1.

## 2. Thi công

1. **SPEC-11 §13.4 TRƯỚC** — bảng đại lượng: `paid_leave_days`/`unpaid_leave_days`/`present_days` là **numeric(8,2)**; nguồn = `leave_request_days` (Active, `deleted_at IS NULL`) ⋈ đơn đã duyệt (union hoa/thường) ⋈ `cal_work`; luật fallback ở §0b; luật `GREATEST` ở §1; hệ quả lên clamp `LEAST(present_days/NULLIF(work_days,0),1)` (tử số nay có thể là số lẻ — clamp KHÔNG đổi); vị từ SQL bắt buộc viết ra nguyên văn.
2. `payroll-inputs.repository.ts`: CTE `lv` đọc `leave_request_days`; CTE `lv_legacy` cho đơn không có day-rows; `present`/`paid`/`unpaid` tính theo §1; bỏ `::int` → `::numeric(8,2)`; cập nhật `PRESENT_DAYS_RULE` (đi vào `input_snapshot_json`, phải mô tả luật MỚI).
3. Ca test mới ở `payroll-be1-inputs-audit.int-spec.ts` (§3).
4. `PayrollUserInputs`: kiểu đã là `number`; rà consumer — chỉ `readinessTx` (`presentDays === 0`, vẫn đúng: 0.5 ≠ 0) + `snapshotMetaTx`.

## 3. Test (RED trước)

| Ca | Kỳ vọng |
| --- | --- |
| nghỉ **nửa buổi CÓ lương** (day-row 0.5) | `paidLeaveDays = 0.5` |
| nghỉ **nửa buổi KHÔNG lương** | `unpaidLeaveDays = 0.5` |
| ngày vừa có **bản ghi công** vừa có **phép nửa buổi có lương** | `presentDays` đếm **đúng 1** (không 1.5) |
| chỉ có phép nửa buổi có lương, không công | `presentDays = 0.5` |
| ALLOW đối chứng: nghỉ **nguyên ngày** | `paidLeaveDays = 1.0` (không hồi quy) |
| đơn đã duyệt **KHÔNG có day-rows** (di sản) | fallback: đếm 1.0/ngày — KHÔNG rơi về 0 lặng lẽ |
| đơn bắc **biên tháng** có day-rows | chỉ phần ngày trong kỳ được tính |
| **hai đơn nửa buổi cùng một ngày** | ngày đó `present ≤ 1`; `paid_leave_days = 1.0` |
| day-row `deleted_at`/`status<>'Active'` | KHÔNG được tính |

## 4. Rủi ro / không làm

- **KHÔNG** đổi `packages/contracts` (đã `z.number()`), **KHÔNG** migration, **KHÔNG** đụng LEAVE.
- Ca cũ của BE-1 seed `leave_requests` bằng INSERT thô (không day-rows) ⇒ chúng chạy nhánh **fallback** và giữ nguyên kỳ vọng — đúng ý đồ: nhánh fallback có ca thật, không phải nhánh chết.
- **Ghi nhận cho BE-2 (KHÔNG sửa ở đây):** `present_days` đã loại ngày nghỉ KHÔNG lương khỏi tử số pro-rate, mà PAY-DEC-004 lại còn trừ `unpaid_leave_days` ở khấu trừ ⇒ **có thể trừ hai lần**. Là quyết định công thức của BE-2/owner, không phải của WO đầu-vào này.
