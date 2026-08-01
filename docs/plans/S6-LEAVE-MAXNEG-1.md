# S6-LEAVE-MAXNEG-1 — Ép trần số ngày âm ở đường quyết định đơn nghỉ

> WO: `S6-LEAVE-MAXNEG-1` · zone **đỏ** · FULL gate · **KHÔNG migration** (cột đã có)
> Loại CR (RELEASE-05 §4.1): **Data integrity fix** · owner chốt 2026-08-01 vá TRONG cửa sổ RC
> Đo trên PROD `mediaos` 2026-08-01, master `01cc901e`, migration head repo `0537`

---

## 1. Vấn đề — đo được, không suy đoán

`leave_policies.max_negative_days` tồn tại ở DB, được `leave-admin.repository` đọc, được
`leave-admin.service` ghi/chiếu, được `leave-policy-form.ts` cho HR nhập — **nhưng không có mặt trong
`leave-request.service.ts`**, tức đường DUY NHẤT quyết định chặn hay cho qua.

```ts
// leave-request.service.ts:534-555 (nguyên trạng)
const allowNegative = policy?.allowNegativeBalance ?? type.allowNegativeBalance ?? false;
if (!allowNegative) {
  const available = round2(remaining - pending);
  if (calculatedDays > available) throw 422 BALANCE_NOT_ENOUGH;
}
// allowNegative === true ⇒ KHÔNG còn nhánh kiểm nào ⇒ âm KHÔNG GIỚI HẠN
```

Hệ quả: bật cho-âm với trần 5 ngày thì hệ thống vẫn nhận đơn 500 ngày. Giao diện hứa một ràng buộc
mà backend không thực hiện — **cùng họ với `accrual_method`** đã vá ở `S6-LEAVE-ACCRUAL-1`.

### 1.1 Phát hiện thứ hai: hai đầu luồng không khớp

| Đầu | Ràng buộc thực tế |
| --- | --- |
| `submit` → `reserveIfNeeded` | `allowNegative=true` ⇒ không kiểm ⇒ âm vô hạn |
| `approve` → `convertReserveToUseByBalanceIdTx` (`leave-approval.repository.ts:84`) | `WHERE used_days + delta <= total_days` — **chặn cứng ở total, không đọc `allow_negative_balance` lẫn `max_negative_days`** |

⇒ `allow_negative_balance = true` **hỏng đầu-cuối**: đơn âm nộp được nhưng **không bao giờ duyệt
được**; người duyệt bấm thì rơi vào nhánh rollback "concurrent double-use / over-quota". Vá mỗi đầu
`submit` sẽ để lại một tính năng bấm-không-chạy — đúng loại lỗi WO này sinh ra để diệt.

### 1.2 Số đo cho phép chọn phương án sạch

```sql
SELECT (SELECT count(*) FROM leave_policies WHERE allow_negative_balance IS TRUE) AS policy_cho_am,
       (SELECT count(*) FROM leave_policies WHERE max_negative_days IS NOT NULL)  AS policy_co_tran,
       (SELECT count(*) FROM leave_types    WHERE allow_negative_balance IS TRUE) AS type_cho_am;
-- 0 | 0 | 0
```

**Không cấu hình nào đang bật cho-âm** ⇒ mọi lựa chọn ngữ nghĩa dưới đây đều **không gây hồi quy**.

---

## 2. Quyết định

### D-1 — `max_negative_days = NULL` khi `allow_negative = true` nghĩa là **0** (fail-closed)

Không chọn "không trần". Lý do:

1. Mục đích của chính WO này là đóng lỗ âm-không-biên. Để NULL = vô hạn là giữ nguyên lỗ và chỉ đóng
   khi HR nhớ điền — biến an toàn thành việc-phải-nhớ.
2. Đo được **0 hàng** đang bật cho-âm ⇒ fail-closed không chặn oan ai.
3. Repo này theo phản xạ fail-closed ở mọi vị từ chặn.

Hệ quả phải chấp nhận và **ghi rõ**: `allow_negative=true` + `max=NULL` sẽ hành xử **giống hệt**
`allow_negative=false`. Để cấu hình đó không âm thầm vô nghĩa, FE **bắt buộc** nhập trần khi bật
cho-âm (§3.3), và jsdoc tại điểm quyết định nói thẳng nghĩa của NULL.

> `leave_types` **KHÔNG có** cột `max_negative_days` (chỉ có `allow_negative_balance`) ⇒ chuỗi phân giải
> trần chỉ **2 tầng**: `policy?.maxNegativeDays ?? 0`. Đây là sửa lại `done_when` của WO (viết lúc seed
> là "3 tầng" — sai, viết theo trí nhớ về `allowNegative` chứ không phải theo schema thật).

### D-2 — Vá **cả hai đầu**, không chỉ `submit`

| Đầu | Trần mới |
| --- | --- |
| `submit` | `calculatedDays > available + maxNegative` ⇒ 422 |
| `approve` | `used_days + delta <= total_days + maxNegative` |

Chỉ vá `submit` thì `allow_negative` vẫn là nút bấm-không-chạy. Mở rộng sang `approve` **nằm trong**
mục tiêu "làm cho thiết lập có thật", không phải scope creep — nhưng được ghi ở đây để reviewer soi
đúng chỗ.

### D-3 — Mã lỗi riêng, không tái dùng `BALANCE_NOT_ENOUGH`

Thêm `NEGATIVE_LIMIT_EXCEEDED: "LEAVE-ERR-NEGATIVE-LIMIT-EXCEEDED"`. Hai tình huống khác nhau về
nghiệp vụ (hết phép vs vượt trần nợ phép) phải phân biệt được ở client và ở log. Đường
`allowNegative=false` **giữ nguyên** mã + thông điệp cũ để không phá test/UX đang có.

---

## 3. Thay đổi theo file

### 3.1 `apps/api/src/leave/leave-request.logic.ts`
- Thêm `NEGATIVE_LIMIT_EXCEEDED` vào `LEAVE_ERR`.
- Thêm hàm thuần `resolveNegativeAllowance(policy, type)` → `{ allowNegative, maxNegative }`, có unit
  test riêng (logic thuần, không DB).

### 3.2 `apps/api/src/leave/leave-request.service.ts` — `reserveIfNeeded`
- Tính `available = remaining - pending` như cũ.
- `allowNegative=false` → nhánh cũ, mã cũ, thông điệp cũ (không đổi hành vi).
- `allowNegative=true` → chặn khi `calculatedDays > available + maxNegative`, ném
  `NEGATIVE_LIMIT_EXCEEDED` với thông điệp nêu **trần**, **mức khả dụng**, **số ngày yêu cầu**.
- jsdoc ghi rõ nghĩa NULL (D-1) ngay tại điểm quyết định — chống vá mù về sau.

### 3.3 `apps/app/src/routes/leave/leave-policy-form.ts` + i18n
- Ràng buộc chéo: `allowNegativeBalance === true` ⇒ `maxNegativeDays` **bắt buộc**, `>= 0`.
- Chuỗi vi giải thích: bỏ trống = không cho nợ phép.

### 3.4 `apps/api/src/leave/leave-approval.repository.ts`
- `convertReserveToUseByBalanceIdTx` nhận thêm `maxNegative` (mặc định `0` — giữ nguyên hành vi hiện
  tại cho mọi caller chưa truyền) và nới vị từ thành
  `used_days + delta <= total_days + maxNegative`.
- Vị từ vẫn nằm trong `WHERE` của `UPDATE` (fail-closed ở tầng DB, an toàn với ca đua) — **không**
  chuyển thành kiểm tra ở tầng app.

### 3.5 `apps/api/src/leave/leave-approval.service.ts`
- Phân giải policy của loại nghỉ để lấy `maxNegative`, truyền xuống repo.

---

## 4. Test — RED trước

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| R1 | policy `allow_negative=true`, `max=5`, số dư 0, xin **500 ngày** | **ĐỎ hôm nay** (được tạo) → sau vá: 422 `NEGATIVE_LIMIT_EXCEEDED` |
| R2 | như R1 nhưng xin đúng **5 ngày** | 201 — đúng trần thì phải qua |
| R3 | xin **5.5 ngày** với trần 5 | 422 |
| 4 | `allow_negative=true`, `max=NULL` | hành xử như `false`: xin 1 ngày khi số dư 0 ⇒ 422 (D-1) |
| 5 | `max=0` tường minh | như trên |
| 6 | đã âm sẵn −3, trần 5, xin 3 ngày | 422 (vượt tổng, không phải tính từng đơn) |
| 7 | `pending` cộng dồn vượt trần qua **nhiều đơn** | đơn cuối bị 422 — chứng minh dùng `available` chứ không phải `remaining` |
| 8 | `allow_negative=false` | giữ **nguyên** mã `BALANCE_NOT_ENOUGH` (chống hồi quy) |
| 9 | **duyệt** đơn âm trong trần | thành công (đóng lỗ §1.1) |
| 10 | **duyệt** khi số dư bị điều chỉnh xuống, vượt trần | fail-closed, rollback |
| 11 | hai đơn nộp **song song** cùng đẩy qua trần | đúng một đơn qua — vị từ ở tầng DB |

Chạy trên lane DB cô lập (`LANE_DB=mediaos_maxneg`), không dùng DB dùng chung.

---

## 5. Rủi ro

| Rủi ro | Xử lý |
| --- | --- |
| Đổi nghĩa NULL chặn oan cấu hình đang chạy | Đo được **0 hàng** bật cho-âm ⇒ không có cấu hình nào để chặn oan |
| Nới vị từ `approve` làm lọt over-quota cho đường **không** cho-âm | Mặc định tham số `maxNegative = 0` ⇒ caller cũ giữ **nguyên** vị từ cũ; test #8/#10 khoá |
| Sửa vị từ SQL trong `WHERE` của `UPDATE` | Giữ nguyên **vị trí** (tầng DB, atomic), chỉ đổi vế phải; test #11 chứng minh còn an toàn với ca đua |
| `round2` và numeric của PG lệch nhau ở 0.5 ngày | Ca #3 dùng 5.5 để chạm đúng biên nửa ngày |

---

## 6. Ngoài phạm vi

- Không đụng `accrual` / `carryover` (đã ship).
- Không thêm cột, không migration.
- Không đổi hành vi khi `allow_negative=false` — đường đang dùng thật hôm nay.
