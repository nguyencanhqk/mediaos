-- S6-LEAVE-CARRYOVER-1 — CẤU HÌNH CHUYỂN TIẾP PHÉP + CHỐT AN TOÀN CHO ENGINE CHUYỂN TIẾP/HẾT HẠN
--
-- VÌ SAO CẦN. `leave_balances` đã có sẵn hai cột `carried_over_days` + `expired_days` từ mig 0453, nhưng
-- `leave_policies` KHÔNG có một cột nào khai luật chuyển tiếp ⇒ có chỗ GHI SỐ mà không có chỗ KHAI LUẬT.
-- Sau S6-LEAVE-ACCRUAL-1, phép được cấp đều đặn vào `total_days` nhưng không bao giờ được dọn: 31/12
-- không có gì chuyển sang năm sau, cũng không có gì hết hạn.
--
-- Quyết định owner 2026-08-01 (D-A3): mốc hết hạn + trần số ngày chuyển phải CẤU HÌNH ĐƯỢC trên màn
-- Chính sách, mặc định 31/03 năm sau, mặc định KHÔNG trần.
--
-- VÌ SAO THÁNG + NGÀY chứ không phải một cột `date` như SPEC-05 §16.2 viết: chính sách sống nhiều năm,
-- `carry_forward_expiry_date = '2027-03-31'` là mốc CHẾT — năm 2028 sai. Mốc phải LẶP theo năm, engine
-- dựng ngày thật cho từng năm (và cắt 29/02 về 28/02 ở năm không nhuận).
--
-- VÌ SAO NOT NULL cho boolean + hai cột mốc: CHECK dạng `BETWEEN` **PASS trên NULL** (NULL không phải
-- false), mà `leave-admin.service.ts` ghi thẳng giá trị DTO xuống cột ⇒ không NOT NULL thì một PATCH vẫn
-- nhét được NULL vào SAU khi DEFAULT đã backfill, và engine mất mốc trong IM LẶNG — đúng lớp lỗi mà cả
-- họ Work Order này đang đi vá. `max_carry_forward_days` thì NULL CÓ NGHĨA: "không trần" (D-A3).
--
-- HOT-FILE / BẤT BIẾN — THUẦN ADDITIVE:
--   • Chỉ ADD COLUMN + 1 CHECK + 2 index. KHÔNG DROP/ALTER cột, ràng buộc, policy nào.
--   • KHÔNG đụng RLS/FORCE RLS của `leave_policies` và `leave_balance_transactions` (bật từ mig 0453),
--     KHÔNG đụng grant append-only (BẤT BIẾN #2: `mediaos_app` = SELECT+INSERT trên sổ cái,
--     `mediaos_worker` = SELECT). Index/cột không cấp thêm quyền cho ai.
--   • KHÔNG backfill dữ liệu nghiệp vụ: `allow_carry_forward` mặc định FALSE ⇒ áp migration này KHÔNG
--     đổi hành vi của một chính sách nào. Công tắc nằm ở tay owner.

-- ─── 1. Cấu hình chuyển tiếp trên leave_policies (SPEC-05 §16.2) ──────────────────────────────

ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "allow_carry_forward" boolean NOT NULL DEFAULT false;

ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "max_carry_forward_days" numeric(8, 2);

ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "carry_forward_expiry_month" integer NOT NULL DEFAULT 3;

ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "carry_forward_expiry_day" integer NOT NULL DEFAULT 31;

-- Cặp (tháng, ngày) vô nghĩa về LỊCH (31/02, 31/04) được chặn ở DTO — biểu thức CHECK biết-số-ngày-của-
-- tháng dài và khó đọc, còn engine vẫn clamp phòng thủ khi dựng ngày thật. Ở đây chỉ chặn khoảng thô.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_leave_policies_carry_forward'
  ) THEN
    ALTER TABLE "leave_policies"
      ADD CONSTRAINT "chk_leave_policies_carry_forward" CHECK (
        ("max_carry_forward_days" IS NULL OR "max_carry_forward_days" >= 0)
        AND "carry_forward_expiry_month" BETWEEN 1 AND 12
        AND "carry_forward_expiry_day" BETWEEN 1 AND 31
      );
  END IF;
END $$;

COMMENT ON COLUMN "leave_policies"."allow_carry_forward" IS
  'S6-LEAVE-CARRYOVER-1: công tắc chuyển phép chưa nghỉ sang năm sau. Mặc định false = engine không đụng.';
COMMENT ON COLUMN "leave_policies"."max_carry_forward_days" IS
  'S6-LEAVE-CARRYOVER-1: trần số ngày được chuyển. NULL = KHÔNG trần (owner D-A3).';
COMMENT ON COLUMN "leave_policies"."carry_forward_expiry_month" IS
  'S6-LEAVE-CARRYOVER-1: tháng của mốc hết hạn phép chuyển, LẶP theo năm (mặc định 3 = tháng 3).';
COMMENT ON COLUMN "leave_policies"."carry_forward_expiry_day" IS
  'S6-LEAVE-CARRYOVER-1: ngày của mốc hết hạn phép chuyển (mặc định 31 ⇒ 31/03 năm sau). Đặt 31/12 = không hết hạn trong năm.';

-- ─── 2. Chống ghi TRÙNG TRONG NGÀY cho hai loại giao dịch mới ─────────────────────────────────
--
-- ⚠️ ĐỌC KỸ CHỖ NÀY — nó KHÁC bản chất với `uq_leave_balance_tx_accrual_period` (mig 0536).
--
-- Accrual khoá theo KỲ vì mỗi kỳ chỉ được cấp đúng một lần và kỳ là bất biến. Chuyển tiếp/hết hạn thì
-- KHÔNG: số dư năm cũ vẫn đổi được SAU khi đã chuyển — từ chối đơn trả lại `pending_days`
-- (leave-approval.service.ts releaseReserve), huỷ/thu hồi đơn trả lại `used_days`
-- (leave-revoke.service.ts refundUsed…), HR điều chỉnh đổi `total_days` (leave-admin.repository.ts
-- applyAdjustmentTx). Khoá theo kỳ ở đây sẽ dẫn tới ĐÚNG MỘT TRONG HAI lỗi, cả hai đều sai:
--   · engine tính lại thấy còn phần chưa chuyển ⇒ INSERT ⇒ đâm unique index MỖI 60 GIÂY, mãi mãi; hoặc
--   · engine thấy "đã có dòng rồi" ⇒ bỏ rơi vĩnh viễn số ngày vừa được trả về (mất quyền lợi, im lặng).
--
-- ⇒ CHỐT AN TOÀN THẬT SỰ LÀ RÀNG BUỘC **SỐ NGÀY**, nằm trong mệnh đề WHERE của lệnh UPDATE số dư
--   (leave-carryover.repository.ts): không bao giờ ghi nợ quá phần còn khả dụng, và không bao giờ cho
--   hết hạn quá phần đã thực sự được chuyển vào. UPDATE đổi 0 dòng ⇒ engine ném lỗi ⇒ không có dòng sổ
--   cái nào được ghi. Ràng buộc đó chặn theo SỐ, nên đúng cả khi có dòng bù (top-up) hợp lệ.
--
-- Hai index dưới đây là lớp PHỤ: chống ghi trùng trong CÙNG MỘT NGÀY (một nhịp scheduler lặp lại, một
-- script tay chạy hai lần). Ngày hôm sau, nếu phần khả dụng tăng trở lại thì dòng BÙ được phép ghi.
--
-- KHOÁ THEO `leave_balance_id`, KHÔNG theo `employee_id` — ba lý do:
--   1. Một khoản chuyển có HAI chân ghi CÙNG NGÀY: nợ ở dòng balance năm cũ, có ở dòng năm mới. Khoá
--      theo `employee_id` sẽ làm hai chân tự đụng nhau.
--   2. `leave_balances` duy nhất theo (company_id, USER_ID, leave_type_id, year) còn sổ cái mang
--      `employee_id`. Một user có hai hồ sơ nhân sự (tái tuyển) sẽ chui lọt khoá theo `employee_id`
--      mà vẫn ghi hai lần vào CÙNG một dòng số dư.
--   3. Hết hạn quét nhiều năm balance trong một nhịp; mỗi dòng balance cần khoá riêng.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_balance_tx_carryover_daily"
  ON "leave_balance_transactions" ("company_id", "leave_balance_id", "transaction_date")
  WHERE "transaction_type" = 'CARRY_OVER';

CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_balance_tx_expire_daily"
  ON "leave_balance_transactions" ("company_id", "leave_balance_id", "transaction_date")
  WHERE "transaction_type" = 'EXPIRE';

COMMENT ON INDEX "uq_leave_balance_tx_carryover_daily" IS
  'S6-LEAVE-CARRYOVER-1: chống ghi TRÙNG TRONG NGÀY cho CARRY_OVER (lớp phụ). Chốt chính là ràng buộc SỐ NGÀY trong WHERE của UPDATE số dư — xem đầu file mig 0537.';
COMMENT ON INDEX "uq_leave_balance_tx_expire_daily" IS
  'S6-LEAVE-CARRYOVER-1: chống ghi TRÙNG TRONG NGÀY cho EXPIRE (lớp phụ). Chốt chính là ràng buộc SỐ NGÀY (expired_days không vượt carried_over_days) trong WHERE của UPDATE.';
