# S6-LEAVE-CARRYOVER-1 — Chuyển tiếp phép chưa nghỉ + hết hạn theo mốc CẤU HÌNH ĐƯỢC

> Work Order: `harness/backlog.mjs` → `S6-LEAVE-CARRYOVER-1` · zone **ĐỎ** (crown-jewel) · gate **FULL**
> `depends_on`: **S6-LEAVE-ACCRUAL-1** — đã merge (PR #317, `788ca962`), migration head hiện tại **0536**.
> Nguồn: RELEASE-05 §4.1 (Data integrity) · SPEC-05 §13.9/§15.4/§16.2/§16.3 · DB-05 §7.2/§7.3/§7.4
> Quyết định owner 2026-08-01 **D-A3**: mốc hết hạn + trần số ngày chuyển **CẤU HÌNH ĐƯỢC**, mặc định
> **31/03 năm sau**, mặc định **không trần**.
>
> **Bản v2** — v1 đã bị `plan-reviewer` BLOCK với 2 lỗi CRITICAL. Xem §11 để biết đổi gì và vì sao.

---

## 1. Vấn đề (đo lại trên code + PROD 2026-08-01, KHÔNG chép số của WO)

| Đo                                                    | Kết quả                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `leave_balances.carried_over_days` · `expired_days`   | **CÓ CỘT** (mig 0453:397, `numeric(8,2)`, **nullable**, NULL trên mọi dòng)           |
| Số nơi ĐỌC/GHI hai cột đó trong toàn repo             | **0** — chỉ khai trong `schema/hr.ts:544-545`                                         |
| `leave_policies` — cột cấu hình carry-over            | **KHÔNG CÓ CỘT NÀO**                                                                  |
| SPEC-05 §16.2 yêu cầu                                 | `allow_carry_forward` · `max_carry_forward_days` · `carry_forward_expiry_date`        |
| `leave_balance_transactions` CHECK `transaction_type` | **ĐÃ có** `'CARRY_OVER'`/`'EXPIRE'` (schema/leave.ts:173) — không cần migration CHECK |
| `uq_leave_balance_tx_accrual_period` (mig 0536)       | PARTIAL `WHERE transaction_type='ACCRUAL'` ⇒ **không ràng buộc** CARRY_OVER/EXPIRE    |

**Đúng như WO nói: có chỗ GHI SỐ mà không có chỗ KHAI LUẬT.** Sau S6-LEAVE-ACCRUAL-1, phép được cấp đều đặn
vào `total_days` nhưng **không bao giờ được dọn**: 31/12 không có gì chuyển sang năm sau, cũng không có gì
hết hạn.

### 1.1 Sáu phát hiện đổi thiết kế (F1–F3 từ khảo sát, F6–F8 từ vòng review đối kháng)

**F1 — `remaining_days` là CỘT GENERATED `total_days − used_days`, KHÔNG phải công thức của DB-05.**
DB-05 §7.3 đề xuất `remaining = opening + granted + adjusted + carried_over − used − pending − expired`;
code thì `remaining_days` GENERATED ALWAYS AS `(total_days − used_days)` với dấu **⛔ GIỮ NGUYÊN**
(`schema/hr.ts:529`). Đường kiểm tra số dư thật (`leave-request.service.ts:546-548`) đọc
`remaining_days − pending_days`.

⇒ **Ghi vào `carried_over_days` thôi thì KHÔNG một ngày phép nào khả dụng thêm.** Hai cột đó là **phân rã
(breakdown)**; nguồn khả dụng là `total_days` — đúng quy ước S6-LEAVE-ACCRUAL-1 đã lập (`granted_days` =
phân rã, `total_days` = tổng chạy).

| Nghiệp vụ   | `total_days`                | Cột phân rã                              |
| ----------- | --------------------------- | ---------------------------------------- |
| Chuyển tiếp | năm sau **+**, năm cũ **−** | `carried_over_days` **+** (dòng năm sau) |
| Hết hạn     | **−**                       | `expired_days` **+**                     |

**F2 — Chuyển tiếp phải GHI NỢ năm cũ, không chỉ ghi có năm mới.** Chỉ cộng cho năm Y+1 mà không trừ năm Y
thì cùng số ngày tồn tại ở HAI dòng balance. Đơn nghỉ **lùi ngày** đọc dòng balance theo
`yearOf(request.startDate)` (`leave-request.service.ts:536`) ⇒ **tiêu hai lần cùng một ngày phép**.

**F3 — `pending_days` phải bị loại khỏi phần được chuyển.** `CHECK leave_bal_used_check: used_days <=
total_days`. Đơn 12/2026 còn chờ duyệt lúc chuyển đã giữ chỗ ở `pending_days` nhưng chưa vào `used_days`;
chuyển hết `total − used` thì lúc đơn được duyệt `used_days` tăng ⇒ **vỡ CHECK ở tầng DB** (đơn duyệt
không được). Phần chuyển được = `total − used − **pending**`.

**F6 — Số dư năm cũ KHÔNG đóng băng sau khi chuyển; "chạy một lần rồi thôi" là sai.** Ba đường có thật kéo
`used_days`/`pending_days` **xuống** sau đó:

| Đường                                              | Tác dụng                        |
| -------------------------------------------------- | ------------------------------- |
| `leave-approval.service.ts:443` `releaseReserve`   | từ chối đơn ⇒ `pending_days −`  |
| `leave-revoke.service.ts:252` `refundUsed…`        | huỷ/thu hồi đơn ⇒ `used_days −` |
| `leave-admin.repository.ts:266` `applyAdjustment…` | HR điều chỉnh ⇒ `total_days ±`  |

⇒ Thiết kế v1 ("mỗi (NV, loại, năm) đúng MỘT dòng CARRY_OVER, tính lại từ trạng thái hiện tại") tự mâu
thuẫn: hoặc engine **đâm vào unique index mỗi 60 giây mãi mãi**, hoặc **bỏ rơi số ngày vừa được trả về**.
Cả hai đều là lỗi. Sửa gốc ở §3.2 + §3.3: **sổ cái ghi theo NGÀY PHÁT HIỆN và cho phép bù thêm (top-up)**,
chốt an toàn là **ràng buộc SỐ NGÀY** chứ không phải số dòng.

**F7 — Ghi nợ năm cũ ngay 01/01 làm hỏng đường nhập đơn lùi ngày.** Không có bất kỳ chặn ngày-quá-khứ nào
trong `apps/api/src/leave/`. Chuyển sạch số dư 2026 vào ngày 01/01/2027 ⇒ đơn nhập ngày 05/01/2027 cho ngày
nghỉ 20/12/2026 đọc dòng 2026 thấy `available = 0` ⇒ **422 BALANCE_NOT_ENOUGH** trong khi ngày phép của
người ta đang nằm ở dòng 2027. Nhập đơn tháng 12 vào đầu tháng 1 là việc HR làm hằng năm. Sửa ở §3.3
(**mốc chốt sổ 01/02**).

**F8 — Mốc hết hạn KHÔNG thể là một cột `date` như SPEC-05 §16.2 viết.** Chính sách sống nhiều năm; một
`carry_forward_expiry_date = '2027-03-31'` là mốc CHẾT, năm 2028 sai. Mô hình đúng là **mốc lặp theo năm**
(SPEC-05 §13.9 ghi kiểu `Date/Month`): lưu **tháng + ngày**, dựng ngày thật theo từng năm (§3.1).

---

## 2. Phạm vi

**LÀM:** cột cấu hình carry-over trên `leave_policies` (+ CHECK) · engine chuyển tiếp · engine hết hạn theo
mốc cấu hình · chốt an toàn ở tầng DB · job nền + route dry-run · trường mới trên màn Chính sách
(**cả đường ĐỌC lẫn đường GHI** — §6) · nhãn vi cho 2 loại giao dịch mới · test biên.

**KHÔNG LÀM (ranh giới rõ, nói trước):**

- **Đóng năm** (`leave_balances.status='Closed'`): DB-05 §7.3 rule 6 là WO "đóng kỳ" riêng. Đổi `status` ở
  đây sẽ chặn đúng những đường trả-ngày-về ở F6 mà không ai yêu cầu.
- **Sửa công thức `remaining_days`** / bỏ cột GENERATED (F1 — có dấu ⛔).
- **CHECK non-negative của DB-05 §7.3** cho `carried_over_days`/`expired_days`: đụng `hr.ts` — **ngoài
  `paths` của WO**. Engine luôn ghi ≥ 0 (§3.3/§3.5 có cận dưới).
- **Hiển thị `carried_over_days`/`expired_days` trên màn Số dư phép** (LEAVE-SCREEN-012): `done_when` chỉ
  yêu cầu màn **Chính sách**. → §8 việc-còn-lại.
- **Chuyển tiếp giữa các LOẠI nghỉ**, quyết toán thôi việc, chặn đơn lùi ngày — không phải WO này.

---

## 3. Thiết kế

### 3.1 Cột cấu hình mới trên `leave_policies` (migration 0537)

| Cột                          | Kiểu           | Ràng buộc                    | Ý nghĩa                                                      |
| ---------------------------- | -------------- | ---------------------------- | ------------------------------------------------------------ |
| `allow_carry_forward`        | `boolean`      | **NOT NULL** DEFAULT `false` | Công tắc — mặc định TẮT ⇒ **merge PR không đổi hành vi nào** |
| `max_carry_forward_days`     | `numeric(8,2)` | NULL cho phép                | Trần ngày chuyển. `NULL` = **không trần** (owner D-A3)       |
| `carry_forward_expiry_month` | `integer`      | **NOT NULL** DEFAULT `3`     | Tháng của mốc hết hạn (1..12)                                |
| `carry_forward_expiry_day`   | `integer`      | **NOT NULL** DEFAULT `31`    | Ngày của mốc hết hạn (1..31)                                 |

`NOT NULL` là bắt buộc chứ không phải cho đẹp: CHECK dạng `BETWEEN` **PASS trên NULL**, mà
`leave-admin.service.ts` ghi thẳng giá trị DTO (`dto.x ?? null`) ⇒ không NOT NULL thì một PATCH có thể
nhét NULL vào sau khi DEFAULT đã backfill, và engine mất mốc trong im lặng.

CHECK mới `chk_leave_policies_carry_forward`:

```sql
(max_carry_forward_days IS NULL OR max_carry_forward_days >= 0)
AND carry_forward_expiry_month BETWEEN 1 AND 12
AND carry_forward_expiry_day   BETWEEN 1 AND 31
```

Cặp tháng-ngày **vô nghĩa về lịch** (31/02, 31/04) bị chặn ở DTO (§6); engine vẫn clamp phòng thủ (§3.5).
Muốn "không hết hạn trong năm" thì đặt **31/12**.

**Thuần additive:** `ADD COLUMN IF NOT EXISTS` + 1 CHECK + 2 index. KHÔNG đụng RLS/FORCE, KHÔNG đụng grant,
KHÔNG DROP/ALTER cột hay ràng buộc cũ, KHÔNG backfill dữ liệu nghiệp vụ.

### 3.2 Chốt an toàn: ràng buộc **SỐ NGÀY** (chính) + unique index chống trùng-trong-ngày (phụ)

> Đây là chỗ v1 sai (F6). Ghi lại nguyên tắc: **thứ phải bị chặn là "chuyển/hết hạn QUÁ SỐ", không phải
> "ghi quá một dòng".** Trạng thái nguồn còn đổi được sau khi chạy, nên khoá theo số dòng vừa chặn nhầm
> việc đúng (bù phần vừa được trả về) vừa không chặn được việc sai.

**(a) Ràng buộc số ngày — ép trong `WHERE` của lệnh UPDATE, không phải trong if của TypeScript:**

```sql
-- ghi nợ (chuyển đi / hết hạn): không bao giờ vượt phần THẬT SỰ còn khả dụng
UPDATE leave_balances SET total_days = total_days − :amount, …
 WHERE id = :id AND company_id = :cid
   AND (total_days − COALESCE(used_days,0) − COALESCE(pending_days,0)) >= :amount

-- riêng hết hạn, thêm trần theo phần ĐÃ CHUYỂN VÀO (không thể hết hạn nhiều hơn số đã nhận):
   AND (COALESCE(carried_over_days,0) − COALESCE(expired_days,0)) >= :amount
```

`UPDATE` không đổi dòng nào ⇒ engine **ném lỗi** ⇒ SAVEPOINT của hồ sơ đó rollback, `failed += 1`, không
ghi sổ cái. Không có đường nào ghi thừa dù logic app có sai.

**(b) Ngày ghi sổ = NGÀY PHÁT HIỆN (`today`), kỳ nằm ở `reason`/`metadata`.** Đây cũng đúng tiền lệ sẵn có:
`ADJUSTMENT` đã ghi `transactionDate = hôm nay` (`leave-admin.service.ts:523`), và sổ cái vốn ghi
"chuyện xảy ra lúc nào". Kỳ vẫn đọc được: `reason = 'CARRY_OVER 2026→2027'`, `metadata.periodKey`.

**(c) Hai unique index PARTIAL — chống ghi trùng TRONG CÙNG NGÀY:**

```sql
CREATE UNIQUE INDEX uq_leave_balance_tx_carryover_daily
  ON leave_balance_transactions (company_id, leave_balance_id, transaction_date)
  WHERE transaction_type = 'CARRY_OVER';

CREATE UNIQUE INDEX uq_leave_balance_tx_expire_daily
  ON leave_balance_transactions (company_id, leave_balance_id, transaction_date)
  WHERE transaction_type = 'EXPIRE';
```

Khoá theo **`leave_balance_id`** (KHÔNG theo `employee_id`) vì ba lý do:

1. Hai chân của một khoản chuyển ghi **cùng ngày** nhưng **khác dòng balance** (nợ ở năm Y, có ở năm Y+1)
   ⇒ không tự đụng nhau.
2. `leave_balances` là duy nhất theo `(company_id, **user_id**, leave_type_id, year)` (`hr.ts:564`) trong
   khi sổ cái mang `employee_id`. Một user có hai hồ sơ nhân sự (tái tuyển) sẽ chui qua khoá theo
   `employee_id` mà vẫn ghi hai lần vào **cùng một dòng** balance. Khoá theo `leave_balance_id` đóng lỗ đó.
3. Hết hạn quét nhiều năm balance trong một nhịp ⇒ mỗi dòng balance một khoá riêng (v1 dùng chung
   `transaction_date` của mốc ⇒ đụng khoá ngay lần chạy đầu có 2 năm).

Ngày hôm sau, nếu phần khả dụng năm cũ tăng lại (F6), engine ghi **dòng bù (top-up)** với ngày mới — hội tụ,
không mất ngày nào, và (a) vẫn chặn tổng vượt.

### 3.3 Chuyển bao nhiêu, và chuyển KHI NÀO

**Mốc chốt sổ (F7):** chỉ chuyển năm `Y` khi `today >= (Y+1)-02-01` — hằng số
`CARRYOVER_SETTLEMENT_MONTH_DAY = (2, 1)`. Tháng 1 để trống cho HR nhập nốt đơn tháng 12 (đường lùi ngày
vẫn đọc dòng năm Y). Con số 31 ngày **không tuỳ tiện**: nó nằm gọn trong cửa sổ ân hạn 45 ngày của engine
cộng dồn (`ACCRUAL_YEAR_GRACE_DAYS`), nên tại thời điểm chốt sổ, accrual vẫn còn thẩm quyền cấp bù cho năm
Y ⇒ hai engine không đá nhau (§3.6).

Với mỗi dòng balance năm `Y` của một `(nhân viên, loại nghỉ)` mà chính sách bật `allow_carry_forward`:

```text
khả_dụng_Y = total_days − COALESCE(used_days,0) − COALESCE(pending_days,0)     // F3 + NULL-safe
đã_chuyển  = − Σ amount_days của các dòng CARRY_OVER ÂM trên chính dòng balance Y
chuyển     = sàn_1_chữ_số( min( khả_dụng_Y, (trần ?? ∞) − đã_chuyển ) )
```

- **`COALESCE` bắt buộc**: `ensureBalanceTx` (accrual repo) tạo dòng mới với `pending_days`/`carried_over_days`/
  `expired_days` = **NULL**; `x − NULL = NULL` sẽ nuốt sạch phép tính trong im lặng.
- **`sàn_1_chữ_số` (làm tròn XUỐNG)**: `total_days` là `numeric(5,1)`; làm tròn lên có thể vượt phần khả
  dụng thật (trần `numeric(8,2)` và `pending_days` `numeric(8,2)` đều đẻ số lẻ 2 chữ số) ⇒ vỡ ràng buộc
  §3.2(a). Phần lẻ ≤ 0.05 ngày ở lại năm cũ, vẫn nằm trong sổ.
- **Trần trừ phần đã chuyển**: nếu không, dòng bù (top-up) sẽ được cấp lại trọn trần lần nữa.
- `chuyển <= 0` ⇒ **không ghi dòng nào** (không rác sổ cái 0 ngày).
- Ghi nợ năm Y + ghi có năm Y+1 trong **cùng một SAVEPOINT** ⇒ không có trạng thái nửa vời.
- Vì `chuyển ≤ total − used − pending` ⇒ `total_mới ≥ used + pending ≥ used ≥ 0` ⇒ **cả hai CHECK
  `leave_bal_used_check` VÀ `leave_bal_total_check (total_days >= 0)` đều không thể vỡ**.

### 3.4 Ai KHÔNG được chuyển (nói lý do, không im lặng)

Kế thừa nguyên tắc S6-LEAVE-ACCRUAL-1: mọi trường hợp không xử lý được đều ra `skipped[]` kèm mã lý do.

| Mã lý do            | Khi nào                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(không báo)_       | `allow_carry_forward = false` — lựa chọn của HR, giống `None`/`Manual` của accrual; báo ra sẽ thành 45 dòng nhiễu mỗi nhịp                                                                                                                                                                                         |
| `BEFORE_SETTLEMENT` | chưa tới mốc chốt sổ 01/02 (§3.3) — trạng thái BÌNH THƯỜNG suốt tháng 1, KHÔNG phải lỗi                                                                                                                                                                                                                            |
| `NOTHING_TO_CARRY`  | `khả_dụng_Y <= 0` sau khi trừ used + pending                                                                                                                                                                                                                                                                       |
| `EMPLOYEE_LEFT`     | `end_date < (Y+1)-01-01` — đã rời công ty trước năm mới; phần chưa nghỉ thuộc **quyết toán thôi việc**                                                                                                                                                                                                             |
| `MISSING_EMPLOYEE`  | dòng balance không map được về hồ sơ nhân sự còn sống                                                                                                                                                                                                                                                              |
| `RESERVE_DISABLED`  | chính sách `reserve_balance_on_pending = false` ⇒ `used_days`/`pending_days` KHÔNG được đường duyệt cập nhật (`leave-request.service.ts:557` trả `"None"`, `leave-approval.service.ts:132` chỉ quy đổi khi `Reserved`) ⇒ "khả dụng" không đáng tin, chuyển = chuyển cả ngày đã tiêu. **Không đoán — dừng và báo.** |
| `ACCRUAL_PENDING`   | engine cộng dồn còn kỳ chưa cấp của năm Y (§3.6) — tạm hoãn, nhịp sau tự chạy                                                                                                                                                                                                                                      |

### 3.5 Hết hạn — mốc cấu hình, FIFO, có bù thêm

Ngày mốc của một năm `B`: `mốc(B) = clamp(B, tháng, ngày)` — `clamp` cắt về ngày cuối tháng thật (29/02 ở
năm không nhuận → 28/02). Lưới an toàn cho dữ liệu cũ; DTO đã chặn cặp vô nghĩa (§6).

**Điều kiện kích hoạt — CẢ HAI phải đúng:**

1. `today > mốc(balance_year)` — **đúng ngày mốc vẫn dùng được** ("hạn dùng" = dùng được hết ngày đó).
2. `ngày_ghi_có_CARRY_OVER <= mốc(balance_year)` — **ngày được chuyển vào SAU mốc thì mốc đó không áp
   dụng**. Thiếu điều kiện này thì: owner bật công tắc ngày 01/06/2027 ⇒ nhịp T chuyển 12 ngày vào 2027,
   nhịp T+1 (60 giây sau) thấy `today > 31/03/2027` ⇒ **xoá sạch 12 ngày vừa chuyển**. Một cái tích chuột
   thổi bay nguyên năm phép của người ta trong 60 giây, không có đường hoàn tác (sổ append-only).

**Số ngày hết hạn — FIFO (phần chuyển tiếp được TIÊU TRƯỚC):**

```text
còn_lại_phần_chuyển = COALESCE(carried_over_days,0) − COALESCE(expired_days,0)
                       − COALESCE(used_days,0) − COALESCE(pending_days,0)
hết_hạn = sàn_1_chữ_số( max(0, min( còn_lại_phần_chuyển,
                                    total_days − COALESCE(used_days,0) − COALESCE(pending_days,0) )) )
```

- **FIFO là giả định của plan, ghi rõ để owner lật được (§9).** Có lợi cho người lao động và là thông lệ:
  ngày sắp hết hạn thì dùng trước. LIFO sẽ làm hết hạn NHIỀU HƠN trên cùng dữ liệu — quyết định chính sách,
  không phải kỹ thuật.
- Trừ cả `pending_days`: đơn đang chờ duyệt sẽ tiêu vào phần chuyển tiếp ⇒ cho nó hết hạn thì lúc duyệt vỡ
  CHECK (cùng lớp lỗi F3).
- **Có bù thêm (F6):** từ chối/huỷ đơn sau mốc làm `used`/`pending` giảm ⇒ `còn_lại_phần_chuyển` dương trở
  lại ⇒ nhịp NGÀY HÔM SAU ghi thêm một dòng EXPIRE. Không vỡ khoá (§3.2c khoá theo ngày), không rò ngày.
- **Hết hạn KHÔNG phụ thuộc công tắc `allow_carry_forward`** — chỉ phụ thuộc `carried_over_days > 0` và
  mốc của chính sách. Tắt công tắc sau khi đã chuyển mà cũng tắt luôn hết hạn thì số ngày đó sống mãi.

### 3.6 Thứ tự chạy — chống đua với engine cộng dồn, chống "hết hạn bị chuyển tiếp"

Trong MỘT nhịp, đúng thứ tự:

```text
1. HẾT HẠN   cho balance năm Y1 = năm(today)  VÀ  năm Y = năm(today) − 1
2. CHUYỂN TIẾP  Y → Y1   (chỉ khi today >= mốc chốt sổ 01/02)
```

- **Vì sao hết hạn TRƯỚC và quét CẢ HAI năm:** job chết từ trước mốc 31/03/2026 tới 2027 thì ngày lẽ ra đã
  hết hạn của 2026 sẽ được chuyển sang 2027 = cấp lại quyền lợi đã mất. Quét cả hai năm đóng cửa sổ đó.
- **Chống đua với accrual:** trước khi chuyển năm Y, engine hỏi kế hoạch cộng dồn; còn kỳ nào **thuộc năm Y**
  chưa cấp ⇒ **HOÃN** (`ACCRUAL_PENDING`), nhịp sau tự chạy. Không dựa vào thứ tự đăng ký job.
  - ⚠️ **Gọi bằng đường NHẬN `tx`, KHÔNG gọi `previewCompany()`**: `previewCompany` tự mở `withTenant` =
    transaction THỨ HAI trên connection THỨ HAI trong khi tx hiện tại đang giữ `FOR UPDATE` — đúng cái
    "tx LỒNG = treo" mà chính plan accrual cấm. ⇒ nới `LeaveAccrualService.plan()` (đang `private`) thành
    **`planWithTx(companyId, today, tx)` public**, thân hàm GIỮ NGUYÊN 100%, `previewCompany` gọi lại nó.
    Đây là sửa file crown-jewel vừa ship ⇒ khai ở §4 và chạy lại trọn `leave-accrual.int.spec.ts` (22 ca).
  - Cửa sổ này chỉ có nghĩa trong ~45 ngày ân hạn của accrual. Sau đó năm Y **đóng băng với accrual** (floor
    đã trôi qua) nên chuyển là an toàn; ngày tháng 12 bị accrual bỏ lỡ là **giới hạn đã biết của accrual**
    (`S6-LEAVE-ACCRUAL-1.md` §3.5), HR vá bằng `adjust` — và **dòng bù ở §3.2 sẽ chuyển nốt phần đó** ở
    nhịp sau. Đây chính là lý do cơ chế top-up không phải thứ trang trí.
- **Cửa sổ năm quét:** nguồn `Y = năm(today) − 1` (một năm duy nhất). Chết trọn một năm vắt qua giao thừa
  ⇒ xử lý tay qua `POST /leave/admin/balances/:id/adjust` — **giới hạn đã biết, ghi ra chứ không giấu**.

### 3.7 Ghi gì, ở đâu

Mirror `LeaveAccrualService.runCompany`: MỘT `withTenant(companyId)` cho cả vòng (JobRunner đã đóng tx
enumerate trước khi gọi `run()`; PgBouncer transaction-mode + tx LỒNG = treo), cô lập lỗi từng hồ sơ bằng
`tx.transaction` (SAVEPOINT).

**Thứ tự khoá TOÀN CỤC — `SELECT … FOR UPDATE` theo `balance_year` TĂNG DẦN** (năm Y trước, năm Y+1 sau).
Đối thủ thật sự không phải chính nó (job lock đã chặn) mà là **job `LEAVE_ACCRUAL`** — `jobCode` khác ⇒ khoá
`system_job_locks` khác ⇒ chạy thật sự song song — cùng đường duyệt/điều chỉnh của người dùng. Accrual khoá
đúng một dòng mỗi lần nên nó tự thoả thứ tự này.

Audit: **CHỈ khi thực sự có thay đổi** (`carried > 0 || expired > 0`), 1 dòng/tenant/lần chạy,
`action='leave_carryover_run'`, `objectType='leave_balance'` (đã trong CHECK union — không cần migration
audit), `actorType='Job'`, `metadata` = **chỉ số đếm** (BẤT BIẾN #3). `carried=0 && expired=0` là trạng thái
bình thường 99.99% nhịp; audit ở đó = ~526k dòng rác/năm trong bảng append-only.

---

## 4. File đụng tới

| File                                                                                                                                                                  | Loại | Ghi chú                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `apps/api/migrations/0537_s6leavecarryover1_carry_forward.sql`                                                                                                        | MỚI  | §3.1 + §3.2(c) — nối tiếp head **0536**                                              |
| `apps/api/migrations/meta/_journal.json`                                                                                                                              | SỬA  | append entry (hot-file — CHỈ THÊM)                                                   |
| `apps/api/src/db/schema/leave.ts`                                                                                                                                     | SỬA  | 4 cột + CHECK + 2 index (additive)                                                   |
| `apps/api/src/leave/leave-carryover.logic.ts`                                                                                                                         | MỚI  | **THUẦN**, không DB — mốc · số ngày · điều kiện                                      |
| `apps/api/src/leave/leave-carryover.logic.spec.ts`                                                                                                                    | MỚI  | unit, **RED trước**                                                                  |
| `apps/api/src/leave/leave-carryover.repository.ts`                                                                                                                    | MỚI  | truy vấn + UPDATE **có guard §3.2(a)** + ghi sổ                                      |
| `apps/api/src/leave/leave-carryover.service.ts`                                                                                                                       | MỚI  | `previewCompany()` (dry-run) + `runCompany()`                                        |
| `apps/api/src/leave/leave-carryover.job-handler.ts`                                                                                                                   | MỚI  | `jobCode = 'LEAVE_CARRYOVER'`                                                        |
| `apps/api/src/leave/leave-carryover.int.spec.ts`                                                                                                                      | MỚI  | integration (LANE_DB)                                                                |
| `apps/api/src/leave/leave-carryover.job-handler.spec.ts`                                                                                                              | MỚI  | unit — chống-lặp cảnh báo (alert-fatigue) + hình dạng metadata                       |
| `apps/app/src/routes/leave/leave-policy-form.spec.ts`                                                                                                                 | MỚI  | unit — vòng ĐI-VỀ 4 field (chống tự tắt cấu hình)                                    |
| `packages/contracts/src/leave.spec.ts` · `packages/web-core/src/lib/leave-api.spec.ts` · `apps/app/src/routes/leave/Leave{Policies,BalanceTransactions}Page.spec.tsx` | SỬA  | ca mới + fixture buộc phải cập nhật (xem §10b.3)                                     |
| `apps/api/src/leave/leave-accrual.service.ts`                                                                                                                         | SỬA  | **CROWN vừa ship** — chỉ nới `plan` → `planWithTx` public, thân hàm KHÔNG đổi (§3.6) |
| `apps/api/src/leave/leave.module.ts`                                                                                                                                  | SỬA  | + 3 provider (khối additive)                                                         |
| `apps/api/src/leave/leave.controller.ts`                                                                                                                              | SỬA  | + `GET admin/carryover/preview` (`view:leave-balance`)                               |
| `apps/api/src/leave/leave-admin.service.ts` + `.repository.ts`                                                                                                        | SỬA  | ghi **và ĐỌC** 4 cột mới (create · update · **select của view**)                     |
| `packages/contracts/src/leave.ts`                                                                                                                                     | SỬA  | 4 field ở create/update **và `leavePolicyViewSchema`** + refine mốc + schema preview |
| `apps/app/src/routes/leave/leave-policy-form.ts`                                                                                                                      | SỬA  | 4 field + gương ràng buộc + **pre-fill từ view** (chống reset)                       |
| `apps/app/src/routes/leave/LeavePoliciesPage.tsx`                                                                                                                     | SỬA  | 4 ô nhập                                                                             |
| `apps/app/src/routes/leave/leave-master-data-i18n.ts`                                                                                                                 | SỬA  | nhãn 4 trường + lỗi validate + **nhãn vi cho CARRY_OVER/EXPIRE**                     |
| `apps/app/src/routes/leave/LeaveBalanceTransactionsPage.tsx`                                                                                                          | SỬA  | dùng nhãn thay vì in thô `transactionType`                                           |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`                                                                                                                    | SINH | regen `ROUTE_CENSUS_WRITE=1` (route mới ⇒ cổng route-guard)                          |
| `harness/backlog.mjs`                                                                                                                                                 | SỬA  | đóng WO (DoD §8 CLAUDE.md)                                                           |

> **Lệch `paths` của WO — khai trước, không giấu:** `docs/_review/…route-census.json` là artifact BẮT BUỘC
> regen khi thêm route (cổng runtime `route-guard-coverage`), không nằm trong `paths` (cùng tiền lệ
> S6-LEAVE-ACCRUAL-1). `apps/api/src/scheduler/**` có trong `paths` nhưng **không cần sửa file nào** —
> `DiscoveryService` tự gom handler.
>
> **Vì sao `leavePolicyViewSchema` phải sửa (không phải "cho đủ bộ"):** view hiện là **tập con** của cột
> policy, và `leavePolicyToForm` đã có tiền lệ pre-fill rỗng cho field BE không trả (`accrualDayOfMonth`).
> Nếu 4 field mới chỉ có ở create/update, HR sửa **bất kỳ** field nào khác trên màn Chính sách sẽ gửi
> `allowCarryForward = false` ⇒ **tự tắt carry-over trong im lặng** — đúng lớp lỗi cả họ WO này đi vá.

---

## 5. Kế hoạch test (RED trước — done_when #5)

**Unit (`leave-carryover.logic.spec.ts`, không DB) — viết & chạy ĐỎ trước khi có engine:**

1. Mốc: `(3,31)`/2027 ⇒ `2027-03-31`; `(2,29)`/2027 ⇒ `2027-02-28`; `(2,29)`/**2028** ⇒ `2028-02-29`.
2. `today` **đúng mốc** ⇒ chưa hết hạn; mốc + 1 ngày ⇒ hết hạn.
3. Mốc chốt sổ (F7): `today = 2027-01-31` ⇒ `BEFORE_SETTLEMENT`, 0 kỳ; `2027-02-01` ⇒ chuyển.
4. Số ngày chuyển: không trần ⇒ toàn bộ khả dụng; trần 5 ⇒ 5; trần 0 ⇒ 0 (không ghi dòng).
5. `pending_days` bị loại (F3): total 12, used 2, pending 3 ⇒ chuyển 7.
6. **NULL-safe**: `used/pending/carried/expired` đều NULL (đúng hình dòng `ensureBalanceTx` vừa tạo) ⇒
   tính đúng, KHÔNG ra `NaN`/`null`.
7. Làm tròn **xuống** ở chỗ nó thật sự xảy ra: trần `5.25` với khả dụng 7 ⇒ chuyển **5.2** (không phải 5.3).
8. Trần trừ phần đã chuyển: trần 5, đã chuyển 3 ⇒ lần bù chỉ được thêm 2.
9. Khả dụng ≤ 0 ⇒ `NOTHING_TO_CARRY`. `reserve_balance_on_pending=false` ⇒ `RESERVE_DISABLED`.
10. `end_date` trước 01/01 năm mới ⇒ `EMPLOYEE_LEFT`; `end_date` trong năm mới ⇒ VẪN chuyển.
11. Hết hạn FIFO: carried 5/used 6 ⇒ **0**; carried 5/used 0 ⇒ **5**; carried 5/used 2/pending 1 ⇒ **2**.
12. `expired_days` đã = 5 ⇒ lần sau **0** (hội tụ).
13. **Chuyển vào SAU mốc thì mốc đó không áp dụng** (§3.5 đk 2): ghi có ngày 01/06/2027, mốc 31/03/2027 ⇒
    hết hạn **0**.
14. Mốc `31/12` ⇒ không hết hạn trong năm.

**Integration (`leave-carryover.int.spec.ts`, LANE_DB — `hasDb && LANE_DB`):**

1. **Chuyển đúng + bảo toàn**: `total_days` năm Y giảm đúng bằng phần tăng năm Y+1; `carried_over_days`
   năm Y+1 = số chuyển; **hai** dòng sổ cái (âm/dương) cùng ngày, khác `leave_balance_id`.
2. **Idempotent trong ngày**: chạy 1 → N lần ⇒ số dòng và mọi cột **không đổi** sau lần 1.
3. **Chốt DB — ràng buộc SỐ NGÀY (§3.2a)**: gọi thẳng repo xin chuyển nhiều hơn khả dụng ⇒ UPDATE đổi 0
   dòng ⇒ engine ném lỗi, **không có dòng sổ cái nào được ghi**.
4. **Chốt DB — trùng trong ngày (§3.2c)**: INSERT tay dòng CARRY_OVER/EXPIRE trùng
   `(company, balance, date)` ⇒ **unique violation**.
5. **Bù thêm (F6 — ca chứng minh v1 sai)**: chuyển xong ⇒ **từ chối** đơn pending của năm Y ⇒ chạy lại với
   `today` + 1 ngày ⇒ phần vừa được trả về **được chuyển nốt**, tổng khớp, không lỗi.
6. **Append-only**: role app UPDATE/DELETE dòng CARRY_OVER/EXPIRE ⇒ lỗi quyền (BẤT BIẾN #2).
   Đếm dòng sổ cái chỉ TĂNG qua mọi bước (done_when #3 "KHÔNG xoá dòng cũ").
7. **Trần**: `max_carry_forward_days = 3`, khả dụng 7 ⇒ chuyển 3, năm cũ còn 4.
8. **Hết hạn**: đúng ngày mốc ⇒ 0 dòng EXPIRE; sau mốc ⇒ 1 dòng, `total_days` giảm đúng, `expired_days`
   tăng đúng, và **số khả dụng nhìn từ đường đặt đơn** (`remaining − pending`) giảm theo.
9. **Hai năm balance trong MỘT nhịp**: cả 2026 và 2027 đều có phần chuyển quá hạn ⇒ 2 dòng EXPIRE, không
   đụng khoá (ca giết thiết kế v1).
10. **Năm nhuận**: mốc `(2,29)`, năm 2028 ⇒ hết hạn từ 01/03/2028.
11. **Đơn pending vắt qua giao thừa (F3)**: pending > 0 ⇒ chuyển ít hơn; **duyệt đơn sau khi chuyển vẫn
    thành công** (CHECK `used_days <= total_days` không vỡ).
12. **NV nghỉ việc giữa chừng**: `end_date` 06/2026 ⇒ không chuyển sang 2027, có lý do trong `skipped[]`.
13. **Đua với accrual**: còn kỳ accrual chưa cấp của năm Y ⇒ carry HOÃN (`ACCRUAL_PENDING`, 0 dòng); chạy
    accrual xong rồi chạy lại ⇒ chuyển ĐỦ (gồm ngày tháng 12).
14. **Cô lập tenant**: tenant B có chính sách bật ⇒ chạy cho tenant A không đẻ dòng nào của B.
15. **Deny-path**: `GET /leave/admin/carryover/preview` không có `view:leave-balance` ⇒ **403**.
16. **Audit**: không đổi gì ⇒ **0 dòng**; có đổi ⇒ đúng 1 dòng, `metadata` chỉ số đếm.
17. **Công tắc tắt** ⇒ 0 dòng, không rác `skipped[]`. **Tắt SAU khi đã chuyển** ⇒ hết hạn VẪN chạy (§3.5).
18. **Đối soát sổ**: với mỗi dòng balance, `total_days == Σ amount_days` của mọi dòng sổ cái ảnh hưởng
    `total` (ACCRUAL + CARRY_OVER + EXPIRE + ADJUSTMENT) — bắt mọi lệch giữa sổ và số dư.
19. **Hồi quy accrual**: chạy lại trọn `leave-accrual.int.spec.ts` (22 ca) sau khi nới `planWithTx`.

**Contracts/FE:** mốc vô nghĩa (31/02, 31/04) bị chặn; trần âm bị chặn; **round-trip**: view trả 4 field →
`leavePolicyToForm` → `leavePolicyToUpdate` giữ nguyên (chống reset im lặng); nhãn vi cho CARRY_OVER/EXPIRE.

Coverage ≥ 80% cho `leave-carryover.logic.ts` + `leave-carryover.service.ts`.

**Phép thử đột biến (bắt buộc — học từ accrual §10.2):** phá 3 chỗ, phải có test ĐỎ —
(a) bỏ trừ `pending_days` khỏi phần chuyển · (b) `today > mốc` → `today >= mốc` · (c) bỏ guard số ngày
trong `WHERE` của UPDATE ghi nợ.

---

## 6. Đóng lỗ "cấu hình câm" ở đầu vào

- `packages/contracts/src/leave.ts` (create + update): `allowCarryForward = true` ⇒ cặp
  `(carryForwardExpiryMonth, carryForwardExpiryDay)` phải là **ngày có thật** (29/02 hợp lệ — clamp theo
  năm khi chạy); `maxCarryForwardDays` nếu có phải `>= 0`.
- **`leavePolicyViewSchema` + select của `leave-admin.repository.ts` phải trả 4 field** — xem hộp cảnh báo
  ở §4 (thiếu = màn hình tự tắt cấu hình trong im lặng).
- `apps/app/src/routes/leave/leave-policy-form.ts`: **gương** của luật trên, cùng `path`, i18n vi.
- Engine vẫn giữ nhánh phòng thủ (clamp §3.5) cho dữ liệu cũ/đường ghi khác.

---

## 7. Rủi ro & cách chặn

| Rủi ro                                               | Mức     | Chặn                                                                   |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| Chuyển/hết hạn QUÁ SỐ (nhân đôi quyền lợi = tiền)    | **CAO** | guard số ngày trong `WHERE` §3.2(a) — không qua được kể cả khi app sai |
| Ngày phép tồn tại ở HAI dòng balance (F2)            | **CAO** | nợ + có trong CÙNG SAVEPOINT; int #1 · #18                             |
| Ngày bị bỏ rơi sau khi hoàn/từ chối đơn (F6)         | **CAO** | dòng bù theo ngày §3.2(b,c); int #5                                    |
| Vỡ CHECK `used_days<=total_days`/`total_days>=0`     | **CAO** | trừ `pending`; sàn-1-chữ-số; guard §3.2(a); int #11                    |
| 422 oan cho đơn lùi ngày tháng 12 (F7)               | **CAO** | mốc chốt sổ 01/02; unit #3                                             |
| Bật công tắc muộn ⇒ xoá sạch phép trong 60 giây      | **CAO** | §3.5 đk 2 (ghi có sau mốc thì mốc không áp dụng); unit #13             |
| Treo pool do tx LỒNG khi hỏi accrual                 | **CAO** | `planWithTx(tx)` — KHÔNG gọi `previewCompany()`; §3.6                  |
| Màn Chính sách tự tắt cấu hình khi HR sửa field khác | **CAO** | view + select + form round-trip; §4 · §6 · test FE                     |
| Hết hạn ăn nhầm ngày chưa được chuyển                | TB      | chỉ tính trên `carried_over_days`; FIFO; unit #11                      |
| Ngày lẽ ra hết hạn bị chuyển tiếp                    | TB      | hết hạn chạy TRƯỚC, quét cả 2 năm (§3.6)                               |
| Số liệu "khả dụng" không đáng tin                    | TB      | `RESERVE_DISABLED` — dừng và báo, không đoán                           |
| Rác `audit_logs` mỗi 60s                             | TB      | chỉ audit khi có thay đổi thật; int #16                                |
| Rò tenant                                            | **CAO** | `withTenant` + `company_id` tường minh; int #14                        |
| Deadlock với job `LEAVE_ACCRUAL` (lock riêng)        | THẤP    | thứ tự khoá toàn cục theo `balance_year` tăng dần (§3.7)               |
| Job nuốt lỗi ⇒ "Success" vĩnh viễn                   | TB      | KHÔNG catch trong `run()`; lỗi 1 hồ sơ ⇒ `failed`                      |

---

## 8. Ra PROD — thứ tự bắt buộc (done_when #6: staging TRƯỚC PROD)

1. Merge PR (FULL gate PASS: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`).
2. Áp migration 0537 (dev-online → PROD). **Không đổi một dòng dữ liệu nghiệp vụ nào** — 4 cột mới,
   `allow_carry_forward = false`.
3. **Diễn tập THẬT trước, không diễn tập rỗng.** Dry-run trên dev-online hôm nay chỉ chứng minh đường ống
   (năm nguồn 2025, PROD **không có dòng balance 2025 nào** ⇒ 0 ứng viên — không kiểm được nghiệp vụ). Bằng
   chứng nghiệp vụ nằm ở **int-spec chạy trên LANE_DB với dữ liệu hình-PROD và `today` bơm vào** (§5 int
   #1/#5/#8/#11/#13) — đó là nơi mốc giao thừa được diễn thật.
   `today` **KHÔNG** được phơi thành tham số HTTP: giữ tiền lệ accrual (`leave.controller.ts:504` — "Ngày
   mốc do SERVER quyết"), tránh biến một route chỉ-đọc thành cỗ máy dự đoán quyền lợi theo ngày tuỳ ý.
4. Owner quyết **cấu hình dữ liệu** (không phải code): bật `allow_carry_forward` cho `DEFAULT_ANNUAL`, chọn
   trần và mốc. Chưa bật ⇒ engine không đụng gì.
   ⚠️ Bật lần đầu **sau mốc hết hạn** của năm hiện tại: §3.5 đk 2 giữ cho số ngày vừa chuyển không bị xoá
   ngay; nhưng vẫn nên bật rồi **đọc dry-run** trước khi để job chạy tiếp.
5. Việc còn lại (ghi backlog, KHÔNG làm ở WO này): hiện `carried_over_days`/`expired_days` trên màn Số dư
   phép (SPEC-05 §13.10 có cột "Chuyển từ năm trước" mà BE view chưa trả) · một dòng trong RELEASE-11 §6
   mô tả job `LEAVE_CARRYOVER` và cách đọc `skippedByReason`.

---

## 9. ⚠️ Giả định cần owner xác nhận (KHÔNG chặn merge)

1. **FIFO** — phần chuyển tiếp được tiêu trước (§3.5). LIFO ⇒ hết hạn nhiều hơn trên cùng dữ liệu.
2. **Mốc chốt sổ 01/02** (§3.3) — tháng 1 vẫn nhập được đơn lùi ngày của tháng 12 năm cũ.
3. **Không chuyển cho người đã nghỉ việc trước 01/01 năm mới** — thuộc quyết toán thôi việc.
4. **Mốc hết hạn lặp theo năm (tháng+ngày)** thay cho cột `date` của SPEC-05 §16.2 (F8).
5. **Đúng ngày mốc vẫn dùng được**, hết hạn tính từ ngày kế tiếp.
6. **Ngày chuyển vào SAU mốc không bị mốc đó áp dụng** (§3.5 đk 2).

---

## 10. Đối chiếu `done_when`

| #   | done_when                                                                  | Đáp ứng ở                                   |
| --- | -------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Migration nối tiếp head; cột bật/tắt · trần · mốc; RLS giữ nguyên          | §3.1 (head 0536 → **0537**)                 |
| 2   | Engine chuyển tiếp, sổ cái append-only, idempotent như accrual             | §3.2 · §3.3 · §3.7 · int #1/#2/#3/#4        |
| 3   | Engine hết hạn, số khả dụng giảm đúng, KHÔNG xoá dòng cũ                   | §3.5 · F1 · int #6/#8                       |
| 4   | Màn Chính sách phơi đủ trường + i18n vi + validate FE lẫn DTO              | §6 · §4                                     |
| 5   | Test biên: 31/12→01/01 · đúng mốc · sau mốc · nhuận · nghỉ việc · chạy lại | §5 unit #1-3/#10/#13 · int #2/#5/#8/#10/#12 |
| 6   | FULL gate PASS; staging trước PROD                                         | §8                                          |

---

## 10b. Kết quả thi công (đo 2026-08-01, KHÔNG phải dự đoán)

### 10b.1 Test

| Bộ                                                                                | Kết quả                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `leave-carryover.logic.spec.ts` (unit, không DB)                                  | **31/31 xanh**                                                                           |
| `leave-carryover.job-handler.spec.ts` (unit)                                      | **8/8 xanh**                                                                             |
| `leave-carryover.int.spec.ts` (LANE_DB `mediaos_carryover`)                       | **29/29 xanh**                                                                           |
| Toàn module `src/leave` trên lane DB (gồm 22 ca accrual sau khi nới `planWithTx`) | **391/391 xanh** (17 file)                                                               |
| `@mediaos/contracts`                                                              | 545/545 xanh (536 → +9 ca carry-over)                                                    |
| `@mediaos/web-core`                                                               | 635/635 xanh                                                                             |
| `@mediaos/app` (FE)                                                               | 1510/1510 xanh (200 file)                                                                |
| Coverage 4 file engine                                                            | **98.46% stmts · 100% funcs** (logic 100 · repo 100 · handler 97.4 · service 97.3 stmts) |

Route census: `ROUTE_CENSUS_WRITE=1` regen — 453→**454** route, 401→**402** gated, `ungated` **GIỮ NGUYÊN**
(route mới có gate, không mở lỗ mới).

### 10b.2 Test có THẬT SỰ bắt lỗi không — 3 phép thử đột biến

| Đột biến                                                     | Kết quả                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| Bỏ trừ `pending_days` khỏi phần khả dụng (F3)                | **4 test ĐỎ** (2 unit + int #5 ghi bù + int #11 duyệt đơn) |
| `today <= mốc` → `today < mốc` (hết hạn ngay trong ngày mốc) | **4 test ĐỎ** (unit #2/#14 + int #8 + int #10 năm nhuận)   |
| Bỏ ràng buộc SỐ NGÀY trong `WHERE` của lệnh ghi nợ (§3.2a)   | **1 test ĐỎ** (int #3 — chốt cuối ở tầng DB)               |

Khôi phục cả ba → xanh lại. Phép thử thứ ba là quan trọng nhất: nó chứng minh chốt an toàn đang được ép ở
**tầng DB**, không phải chỉ nhờ logic app cẩn thận.

### 10b.3 Lệch `paths` của WO — khai đủ, không giấu

| File                                                       | Vì sao buộc phải đụng                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`         | artifact BẮT BUỘC regen khi thêm route (cổng `route-guard-coverage`)       |
| `packages/web-core/src/lib/leave-api.spec.ts`              | fixture `createPolicy` thiếu 3 field NOT NULL mới ⇒ typecheck đỏ           |
| `apps/app/src/i18n/locales/vi/leave.ts`                    | nhãn vi cho CARRY_OVER/EXPIRE (namespace `leave`, không nằm trong routes/) |
| `apps/app/src/routes/leave/LeaveBalanceTransactionsPage.*` | trang này in THÔ mã giao dịch — hai loại mới cần nhãn (nằm TRONG paths)    |

### 10b.4 Trạng thái PROD sau khi merge

Merge **KHÔNG đổi một dòng dữ liệu nghiệp vụ nào**: 4 cột mới với `allow_carry_forward = false` trên mọi
chính sách hiện có, và năm nguồn hôm nay là 2025 — PROD **không có dòng `leave_balances` 2025 nào**. Engine
chạy mỗi 60 giây và trả `carried=0, expired=0`. Công tắc nằm ở tay owner — §8 bước 4.

---

## 10c. Vòng FULL gate — 3 reviewer độc lập, và những gì phải sửa thêm

`security-reviewer` **PASS** (0 CRIT/HIGH) · `database-reviewer` **PASS** cho migration+schema (parity
đúng từng dòng, additive, RLS/grant nguyên vẹn) · `silent-failure-hunter` **BLOCK** với 5 HIGH.

Điểm chung của cả 5 HIGH: **đúng cái lớp lỗi Work Order này sinh ra để diệt** — một giá trị admin đặt được,
hoặc một dòng có thật trong DB, mà không đường code nào đọc tới, không lỗi, không con số nào đếm. Ship
chúng bên trong bản vá cho chính lỗi đó là thứ đáng dừng lại. Đã sửa hết:

| #   | Lỗ                                                                                                                                                               | Sửa                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| H1  | Dòng số dư năm < `sourceYear` VÔ HÌNH: không chuyển, không hết hạn, không nằm trong `balancesScanned`                                                            | `countStrandedBalancesTx` + `strandedBalances` trong preview/metadata + cảnh báo kèm số lượng · int #H1                |
| H2  | `carried_over_days > 0` mà không có dòng sổ cái ⇒ không bao giờ hết hạn, **và test cũ không neo được** (dùng `carriedOverDays: null` nên xoá hẳn nhánh vẫn xanh) | mã `CARRIED_NO_LEDGER` ra `skipped[]` · unit #H2 (carried "5.00" + 0 dòng ghi có) · int #H2                            |
| H3  | Bật chuyển tiếp trên chính sách phạm vi ≠ Công ty: lưu được, mở ra còn nguyên, engine không đọc — mà nhân viên đó vẫn bị mốc của chính sách Công ty áp lên       | `carryForwardScopeIsSupported` ở contracts (create) + hoà-trạng-thái ở service (PATCH) + gương ở form · 2 ca contracts |
| H3b | Không có tín hiệu "engine không có gì để làm" ⇒ cấu hình sai và nghỉ-đúng-thiết-kế đẻ ra `system_job_runs` giống hệt nhau                                        | `policiesTotal`/`policiesWithCarryForward` + log-once (mirror engine cộng dồn) · unit #H3b                             |
| H4  | MỌI dòng hỏng ⇒ `carried=expired=0` ⇒ **không ghi audit nào** — đúng lúc cần dấu vết nhất                                                                        | thêm vế `failed > 0` vào điều kiện ghi audit · int #H4 (ép hỏng bằng dòng đích đã soft-delete)                         |
| H5  | `LeavePolicyUpdated` không ghi 4 cột mới ⇒ "ai đặt mốc 31/03, lúc nào" không có chỗ trả lời                                                                      | before/after đủ 4 cột                                                                                                  |

Và 4 lỗ từ hai reviewer kia, cùng hạng nghiêm trọng thực tế:

| #       | Lỗ                                                                                                                                                                                                           | Sửa                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| M3/M1   | **Ghi bù TRONG NGÀY đâm khoá mỗi 60 giây**: HR từ chối đơn lúc 10:05 sau khi engine chạy 10:00 ⇒ ~1440 run `Failed` + 1440 dòng ERROR tới nửa đêm UTC (dữ liệu vẫn đúng nhờ SAVEPOINT — hỏng phần PHÁT HIỆN) | `lastTxDate` per (dòng số dư, loại) ⇒ mã `ALREADY_WROTE_TODAY`, hoãn sang mai · unit #H3 · int #5b |
| M1 (DB) | `CARRIED_AFTER_DEADLINE` rút gọn thành `MAX(ngày ghi có)` ⇒ **một** dòng ghi có sau mốc miễn nhiễm cho **cả dòng số dư, vĩnh viễn**                                                                          | đọc CẢ danh sách ghi có, hết hạn tính trên **pool ngày ≤ mốc** · unit #13b                         |
| M2 (DB) | Số lẻ 2 chữ số lọt vào đường ghi ⇒ `total_days` (numeric(5,1)) làm tròn còn cột phân rã (8,2) thì không ⇒ sổ lệch dần                                                                                        | `assertOneDecimal` ở repository (chốt cho mọi đường gọi tương lai) · int #3                        |
| L4      | Dòng số dư đích đã soft-delete ⇒ khoá được nhưng ghi có 0 dòng ⇒ hỏng lại mỗi nhịp mãi mãi                                                                                                                   | `findTargetBalanceForUpdateTx` lọc `deleted_at` (không mượn bản của accrual)                       |
| M1 (SF) | Chữ ký cảnh báo theo SỐ ĐẾM ⇒ đổi người mà giữ nguyên lý do thì im lặng                                                                                                                                      | chữ ký theo DANH TÍNH `(loại, nhân viên, năm, lý do)` đã sắp xếp · unit #M1                        |
| M2 (SF) | Log lỗi không chống lặp: một hồ sơ hỏng BỀN in 1440 dòng/ngày                                                                                                                                                | dedupe theo chữ ký `(loại, dòng số dư, thông điệp)`                                                |
| L1      | Trần dùng hết mà còn ngày khả dụng ⇒ biến mất khỏi cả `pending` lẫn `skipped`                                                                                                                                | mã `CAP_EXHAUSTED` · unit #L1                                                                      |
| L5      | `docs/erd-current.md` ghi sai tên cột (`carry_forward_allowed`) và thiếu 2 cột mốc                                                                                                                           | sửa dòng ERD                                                                                       |

**Còn lại, CÓ CHỦ ĐÍCH (ghi ra, không giấu):** CHECK `pending_days >= 0` (đụng `hr.ts`, ngoài `paths`) ·
`carried_over_days` của dòng NGUỒN không giảm khi chuyển đi (cột phân rã sẽ lệch khi màn Số dư phép hiện
nó — cùng WO với việc hiện cột đó) · route dry-run chưa có màn hình (accrual cũng vậy) · 6 field khác của
form Chính sách vẫn bị reset vì view không trả (lỗi CÓ SẴN, không phải WO này gây ra).

---

## 11. Đổi gì so với v1 (sau vòng `plan-reviewer` BLOCK)

| Lỗi v1                                                                                                           | Mức      | Sửa ở                   |
| ---------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| Tính lại từ trạng thái sống + khoá "một dòng/kỳ" ⇒ hoặc đâm unique index mỗi 60s, hoặc bỏ rơi ngày vừa được hoàn | CRITICAL | F6 · §3.2 · §3.3        |
| Ghi nợ năm cũ ngay 01/01 ⇒ đơn lùi ngày tháng 12 ăn 422 oan                                                      | HIGH     | F7 · §3.3 (mốc chốt sổ) |
| Hỏi accrual bằng `previewCompany()` ⇒ tx LỒNG (treo pool); `plan` lại private                                    | HIGH     | §3.6 · §4               |
| EXPIRE quét 2 năm nhưng ghi cùng `transaction_date` ⇒ tự đụng khoá                                               | HIGH     | §3.2(b,c) · int #9      |
| Bật công tắc sau mốc ⇒ xoá sạch phép vừa chuyển trong 60 giây                                                    | HIGH     | §3.5 đk 2 · unit #13    |
| `leavePolicyViewSchema` không trả 4 field ⇒ màn hình tự tắt cấu hình                                             | HIGH     | §4 · §6                 |
| Khoá theo `employee_id` trong khi balance duy nhất theo `user_id`                                                | MEDIUM   | §3.2(c)                 |
| Thiếu `COALESCE` (4 cột nullable) · thiếu `NOT NULL` cho cột mới                                                 | MEDIUM   | §3.1 · §3.3 · §3.5      |
| Không nói `leave_bal_total_check` · không xử `reserve_balance_on_pending=false`                                  | MEDIUM   | §3.3 · §3.4             |
| Đối soát `total_days` ↔ tổng sổ cái không có ai kiểm                                                             | MEDIUM   | int #18                 |
| FE in thô `CARRY_OVER`/`EXPIRE` cho nhân viên                                                                    | LOW      | §4                      |
| Diễn tập staging rỗng nghĩa                                                                                      | HIGH     | §8 bước 3               |
