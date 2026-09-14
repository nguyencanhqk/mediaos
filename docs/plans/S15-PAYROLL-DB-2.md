# S15-PAYROLL-DB-2 — micro-plan (vùng ĐỎ · FULL gate · Opus)

> **WO:** Schema + migration PAYROLL v2 track C + ALTER thứ ba `payroll_periods` + NOTI 024–027.
> **Nguồn sự thật:** `docs/DB/DB-13` §12.3 · §14.1–§14.4 · §15.1–§15.4 · `docs/SPEC/SPEC-11` §11.3 · §12.1 ·
> §13.1 · §13.2 · §17.1 · §18.1 · `docs/permission-matrix-spec.md` §9g.2.
>
> **Khuôn tái dùng:** mig `0570` (DDL + VERIFY 7.x) · `0566` (seed NOTI) · `0564` khối freeze
> `enforce_bonus_penalty_freeze` (A–E) · `apps/api/test/integration/s15-payroll-db1-invariants.int-spec.ts`.
>
> Nhánh `feat/s15-payroll-db-2` cắt từ `afd4f32e` (sau khi #506 BE-2 merge).

---

## 1. Ranh giới

**LÀM:**

| # | Hạng mục | Nguồn |
| --- | --- | --- |
| 1 | Mig `0572` — ALTER `payroll_periods` (3 cột · 2 composite FK · `status_check` 8 giá trị · backfill · **4** CHECK cặp) | DB-13 §12.3 + §3.2/§3.3 dưới |
| 2 | Mig `0572` — TẠO 4 bảng + RLS/FORCE/policy/GRANT/composite FK/`UNIQUE (company_id,id)` | DB-13 §14 |
| 3 | Mig `0572` — **3 trigger** chốt cuối (đợt `Completed` · dòng chi · tạm ứng) | §3.5 dưới |
| 4 | Mig `0573` — NOTI 024–027: ĐO CHECK rồi NO-OP · 4 event · 4 template | DB-13 §15.3 D · SPEC-11 §17.1 |
| 5 | **Đổi nghĩa `Paid` ở BE + FE CÙNG COMMIT** (FSM · bộ lọc Own · dẫn xuất trạng thái phiếu · FE mirror) | SPEC-11 §13.2 — §3.1 dưới |
| 6 | Parity: drizzle · contracts · `rls-registry` · `cleanupTenants` · `PROTECTED_TABLES` · catalog NOTI + pin | DB-13 §15.3 C |

**⛔ KHÔNG LÀM:**

- Route 059–077 (tạm ứng · đợt chi · ngân sách · import) và **thân luật PHỦ** của `complete` (072) — `S15-PAYROLL-BE-4`.
  DB-2 chỉ dựng **cạnh FSM** `complete-batch` + nửa DB của luật (§3.4).
- Đưa `templateId`/`paidBy`/`paidAt` ra DTO — BE-3/BE-4. Registrar outbox cho 024–027 — BE-4.
- PDF 084 — BE-5 (nợ bàn giao: dùng CHUNG hằng `PUBLISHED_PERIOD_STATUSES`).
- **Seed cặp quyền** — đã xong ở `0571` (§3.3). Widget DASH — `S15-PAYROLL-DASH-1`.

---

## 2. Bước 0 — SỐ ĐO

### 2.1 Đã đo (14/09/2026, phiên này)

| Đo gì | Kết quả | Hệ quả |
| --- | --- | --- |
| `_journal.json` head | idx **238** · `0571_s15payrolldb1_seed_perms_audit` · `when` 1717587360000 | file mới `0572` (idx 239) + `0573` (idx 240); **đo lại lúc chạy** |
| PR #506 có migration? | **Không** (63 file, 0 `.sql`) | không va số |
| `0571` đã seed cặp track C? | **CÓ** — 8 cặp `payroll-advance`/`payment-batch`/`payroll-budget` + grant (`0571:43–50`, `:81–115`) | DB-2 **không seed**, chỉ guard (§3.3) |
| 2 allowlist BE có cặp track C? | **CÓ** — `permission.service.ts:250–258` và `:339–347` | không đụng `permission/` |
| `audit_logs.object_type` track C | **CÓ** `payroll_advance`/`payroll_payment_batch`/`payroll_budget` (`0571:320`) | không đụng CHECK audit |
| NOTI-EVENT 024–027 | đã ghi cho PAYROLL ở SPEC-01 §20.2 (`:1723–1726`) + SPEC-08 §15.0; **không module nào khác chiếm** | dùng đúng 024–027 |
| CHECK NOTI `PAYROLL`/`Payroll` | có trên **cả hai** bảng từ `0566` | `0573` ĐO rồi NO-OP |
| Trigger trên `payroll_periods` | `0564` đã DROP `payroll_period_status_guard` (`payroll-fsm.ts:9`) | guard `0572` assert **tập trigger = ∅**, lệch ⇒ DỪNG |
| `mediaos` DB local | **0** hàng `payroll_periods` | backfill phải chứng minh trên lane **CÓ dữ liệu** (§8.3) |
| PROD | **agent KHÔNG đo được** (classifier chặn DB PROD) | backfill tự đếm + verify khớp lúc chạy; ops dán `RAISE NOTICE` |
| Test replay migration PAYROLL | **0** spec đọc file `05(64\|65\|66\|70\|71)_*` | thêm 4 event không làm verify cũ đỏ khi replay |
| Census target_url NOTI ↔ route FE | **không tồn tại** | link template tự chọn, ghi rõ §5 |
| FK `*_by` của `payroll_periods` | `locked_by` = `SET NULL (locked_by)` (`0564:229`) | `paid_by` mirror đúng khuôn |
| Ghi vết FSM | `applyTransitionTx` ghi `patch[\`${col}By\`]` động (`payroll-periods.repository.ts:155–163`) | `TrailCol 'paid'` chạy nhờ drizzle có `paidBy/paidAt` — **drizzle bỏ qua im lặng khoá lạ** ⇒ ca census §8.2 |
| `schema/payroll.ts` | **991 dòng** (đã vượt trần 800) | 4 bảng mới vào **file mới** `payroll-disbursement.ts` |
| FE parity FSM | `payroll-fsm-parity.spec.ts` đọc `payroll-fsm.ts` bằng regex, ghim **ĐÚNG 10 cạnh** + tập FE === tập BE | FE mirror cạnh `complete-batch` ⇒ 11 |

### 2.2 PHẢI đo lúc chạy — dán vào PR

```sql
-- (a) head thật: node -e "const j=require('./apps/api/migrations/meta/_journal.json');console.log(Math.max(...j.entries.map(x=>x.idx)))"
-- (b) CHECK soi MỌI hàng, kể cả xoá mềm ⇒ đếm KHÔNG lọc deleted_at
SELECT status, count(*), count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
  FROM payroll_periods GROUP BY status ORDER BY 1;
-- (c) tập trigger thật trên payroll_periods (kỳ vọng ∅)
SELECT tgname FROM pg_trigger WHERE tgrelid='payroll_periods'::regclass AND NOT tgisinternal;
```

---

## 3. SÁU điểm KHÁC tài liệu / WO — đọc trước khi review

### 3.1 🔴 Đổi nghĩa `Paid` KHÔNG tách sang BE-4/FE-3 được — note của WO sai

WO ghi *«mọi chỗ đọc `Paid` như "đã phát hành" … sửa ở BE-4/FE-3»*. Sai: sau `0572` trên master mọi kỳ v1 `Paid`
thành `Published` và `publish` đổi đích. Nếu BE còn lọc `{Paid, Locked}`, **`GET /me/payslips` trả `200 []` cho mọi
nhân viên** — không lỗi, không log (SPEC-11 §13.2: *«ba chỗ phải sửa CÙNG LƯỢT với FSM, không tách WO»*). Master
gãy suốt khoảng DB-2 → BE-4.

**Census đầy đủ (grep `"Paid"` · `'Paid'`, bỏ leave/bonus) — sửa CÙNG COMMIT:**

| File | Dòng | Việc |
| --- | --- | --- |
| `apps/api/src/payroll/payroll-fsm.ts` | 18–60, 86–99, 171–189 | `publish → Published`; cạnh MỚI `complete-batch: Published → Paid`; `TrailCol += 'paid'`; `TRAIL_RESET['complete-batch'] = {clear:[], set:['paid']}`; `assertReopenAllowed` chặn `Published`/`Paid`/`Locked` |
| `apps/api/src/payroll/payroll-payslips.repository.ts` | 54, 244, 330, 357 | `PUBLISHED_PERIOD_STATUSES = ['Published','Paid','Locked']` — **export** để BE-5 (PDF 084) dùng chung |
| `apps/api/src/payroll/payroll.mapper.ts` | 318, 328 | `derivePayslipStatus`: `Published\|Paid\|Locked` ⇒ `Published`/`Acknowledged` |
| `apps/api/src/payroll/payroll-calc.service.ts` | 33–37 | `FROZEN_STATUSES += 'Published'` (thiếu ⇒ tính lại kỳ đã phát hành lọt qua 003, ăn FSM 001 — mã chết) |
| `apps/api/src/payroll/payroll.controllers.ts` · `payroll.errors.ts` | 535 · 39 | comment |
| `packages/contracts/src/payroll.ts` | 66–82, 610 | enum **8** + docblock |
| `apps/app/src/routes/payroll/constants.ts` | 114–143 | 8 trạng thái + badge `Published` |
| `apps/app/src/i18n/locales/vi/payroll.ts` | 30 | `Published: "Đã phát hành"` · `Paid: "Đã chi trả"` |
| `apps/app/src/routes/payroll/payroll-actions.ts` | 36–60, 113–119 | mirror 11 cạnh (§6.2) · `isReopenBlocked` thêm `Published` |
| `apps/app/src/routes/payroll/MePayslipsPage.tsx` · `packages/web-core/src/lib/payroll-api.ts` | 24 · 333 | comment |

**9 file test + 3 pin NOTI** phải sửa theo: xem §8.4.

### 3.2 🔴 DB-13 §12.3 bỏ sót `Published` ở HAI CHECK cặp — kỳ `Published` thiếu `submitted_by` lọt DB

`schema/payroll.ts:190–214` (hiện trạng) — vế trái mỗi CHECK:

| CHECK | v1 | DB-13 §12.3 đổi? | Hở nếu không đổi |
| --- | --- | --- | --- |
| `submitted_pair_check` | `Reviewing,Approved,Paid,Locked` | **KHÔNG** | 🔴 hàng `Published` **không** bị ép `submitted_by/at` — `published_pair_check` chỉ ép `approved_*` + `published_*` ⇒ **lỗ thật** |
| `approved_pair_check` | `Approved,Paid,Locked` | **KHÔNG** | được `published_pair_check` bao bắc cầu — không hở, nhưng sai hình dạng |
| `published_pair_check` | `Paid,Locked` | có | — |
| `paid_pair_check` | *(mới)* | có | — |

**Chốt:** `0572` DROP+ADD **cả bốn**, thêm `'Published'` vào vế trái của `submitted_pair_check` và
`approved_pair_check`. DB-13 §12.3 + SPEC-11 §13.1 bảng «ba CHECK cặp» đính chính **cùng commit**
(`Locked` vẫn nằm trong vế trái của MỌI CHECK — `nullable-escape-clause-makes-check-vacuous`).

### 3.3 🔴 `paid_pair_check` + kỳ v1 đã `Locked` = `23514` trên DB có dữ liệu — ⏳ **CHỜ OWNER CHỐT (O-1)**

DB-13 §12.3 chỉ backfill `Paid → Published`, rồi siết `paid_pair_check` với vế trái **`Paid,Locked`**. Kỳ v1 đi
`Paid → Locked` có `paid_by` **NULL** (cột chưa tồn tại) ⇒ ADD CONSTRAINT **đỏ ngay trên lượt migrate** ở mọi DB có
một kỳ đã khoá. CI rỗng ⇒ xanh. Đúng hình dạng mà §12.3 tự cảnh báo ở bước (3)/(4), chỉ khác trạng thái.

Không hạ `Locked` xuống được (terminal — hạ là **mở khoá** một kỳ đã chốt). Ba lối:

| Lối | Cách | Được | Mất |
| --- | --- | --- | --- |
| **A (đề xuất)** | kỳ `Locked` còn `paid_by IS NULL` ⇒ `paid_by := published_by`, `paid_at := published_at` (đếm trước/sau, `RAISE NOTICE`) | CHECK nguyên vẹn, `VALIDATED`; ghi đúng lời khẳng định **v1 đã ghi** (v1 gọi thời điểm phát hành là `Paid`) | vết `paid_*` của kỳ di sản là **suy ra**, không phải thao tác chi trả thật — ghi rõ ở DB-13 + erd |
| B | `ADD CONSTRAINT … NOT VALID` | không bịa vết | constraint `convalidated=false` vĩnh viễn; **mọi UPDATE sau** trên hàng di sản (kể cả xoá mềm) ăn `23514`; census/verify phải chấp nhận ngoại lệ |
| C | bỏ `Locked` khỏi vế trái `paid_pair_check` | đơn giản | **mở đường ghi thẳng `Locked` không vết chi trả** — DB-13 cấm tường minh |

Kỳ v1 `Locked` **không** qua backfill `Paid → Published`, và `published_pair_check` v1 đã bảo đảm
`published_by/at NOT NULL` cho mọi hàng `Locked` ⇒ lối A không đẻ hàng vi phạm. Migration vẫn assert điều đó trước khi copy.

### 3.4 Luật PHỦ là logic SERVICE — DB-2 chỉ chứng minh nửa DB, ca ÂM «đợt 2 không 409» chuyển BE-4

`done_when` #3 của WO đòi *«ca ÂM: đợt thứ hai của cùng kỳ KHÔNG được 409»*. Đó là hành vi của route **072** — chưa
tồn tại tới BE-4. DB-2 chứng minh phần **của DB**: (a) `payroll_payment_batches_company_period_idx` **non-unique** — hai
đợt cùng kỳ INSERT được; (b) `payslip_uq` chặn một phiếu ở hai đợt (`23505`, đúng TÊN); (c) cạnh FSM
`complete-batch` tồn tại và `lock` từ `Published` bị 409. Phần service ghi vào `done_when` BE-4 **cùng commit**
(§7 dòng `backlog.mjs`).

### 3.5 Ba trigger chốt cuối — DB-13 chỉ nêu MỘT, và chính nó vô tác dụng nếu đứng một mình

| Trigger | DB-13 | Vì sao phải có |
| --- | --- | --- |
| **T1** `payroll_payment_batch_freeze` — `BEFORE UPDATE` khi `OLD.status='Completed'`: khoá `status` · `payroll_period_id` · `method` · `code` · `pay_date` · `completed_by/at` · `deleted_at/by` (cho sửa `note`) | **không có** | T2 đọc trạng thái đợt; thiếu T1 thì `UPDATE … SET status='Draft'` **gỡ băng toàn bộ T2** trong một câu (`check-cannot-enforce-fsm-transitions` — CHECK không có `OLD`) |
| **T2** `payroll_payment_line_guard` — `BEFORE INSERT OR UPDATE` | có, nhưng chỉ `UPDATE` + 4 cột | (i) mở rộng cột đóng băng: `batch_id` · `user_id` · `payslip_id` · 3 snapshot · `paid_at` · `deleted_at/by`; (ii) **chặn INSERT vào đợt `Completed`** — DB-13 §14.3 tự nói «gỡ mềm rồi thêm lại vào đợt đã `Completed`» là việc của trigger, mà đường đó là **INSERT**; (iii) chặn chuyển dòng **sang** đợt `Completed`; (iv) **nhất quán chéo**: `payslips.user_id = NEW.user_id` **và** `payslips.payroll_period_id = batch.payroll_period_id` — thiếu thì trả lương phiếu của X cho Y, hoặc phiếu kỳ P2 «phủ» nhầm luật PHỦ của kỳ P1; (v) đọc đợt bằng **`FOR SHARE`** — xem dưới |
| **T3** `payroll_advance_freeze_guard` — clone `enforce_bonus_penalty_freeze` (A–E) | **không có** — chỉ nói «khuôn sao chép từ `bonus_penalties`» cho cặp consume | bảng chở tiền cùng lớp lỗi; `bonus_penalties` đã có trigger (A–E, HIGH-1 của S13 DB-1). Khác (E): **`Deducted → Approved` hợp lệ** khi nhả consume (tính lại kỳ chưa `Approved`, DB-13 §14.1) **và chỉ khi** câu đó set NULL **cả cặp** |

**T2 và race hoàn tất đợt:** dưới `READ COMMITTED`, tx sửa dòng đọc đợt `Ready` (bản đã commit) trong khi tx 072 đang
khoá đợt và đếm dòng ⇒ 072 commit `Completed` với một dòng bị đổi **sau** khi đã kiểm. `SELECT … FOR SHARE` trên đợt
xếp hàng hai tx: sửa-dòng chờ `FOR UPDATE` của 072 và ngược lại. `FOR SHARE` cần quyền `UPDATE` trên bảng —
`mediaos_app` có. Thứ tự khoá không đổi (072: kỳ → đợt; sửa dòng: chỉ đợt) ⇒ không vòng.

**T3 (E) — tập chuyển tiếp DB cho phép (mọi thứ khác ⇒ `23514`):** `Pending→Approved` · `Pending→Rejected` ·
`Approved→Deducted` · `Deducted→Approved` *(kèm `payroll_period_id` và `consumed_at` cùng NULL trong CÙNG câu)*.
Không ép đồ thị FSM đầy đủ (việc của service, ERR-025) — chỉ ép bất biến cần `OLD/NEW`.

Mọi trigger: `ERRCODE = 'check_violation'`, message **mở đầu bằng tên trigger** (BE-4 map theo tiền tố, khuôn BE-2
`salary_component_system_freeze` ⇒ 024). Trigger HẸP — không đóng băng cả bảng (`frozen-table-triggers-break-db-init`).

#### 3.5.a 🔁 VÁ plan-review vòng 1 (14/09) — ĐÈ lên bảng trên ở mọi chỗ mâu thuẫn

| # | Lỗ reviewer chỉ ra | Thiết kế CHỐT |
| --- | --- | --- |
| **B1** | T1 chỉ khoá `payroll_period_id` khi `Completed` ⇒ đợt `Draft` có dòng phiếu kỳ P1 đổi sang P2 bằng MỘT câu UPDATE, T2 (iv) không bắn, luật PHỦ tính dòng P1 cho P2 ⇒ **kỳ P2 bị ghi `Paid` sai** | **T1 = `BEFORE INSERT OR UPDATE`**. UPDATE: `payroll_period_id` **bất biến ở MỌI trạng thái** (tag `period-immutable`); khi `OLD.status='Completed'` khoá thêm các cột như bảng trên (tag `frozen`). INSERT: cấm `status='Completed'` (tag `insert-completed` — «hoàn tất từ lúc sinh» đi vòng 072) |
| **B2** | T3 cho nhả/bind consume bất kể trạng thái kỳ ⇒ nhả khoản đã trừ ở kỳ `Locked` rồi bind kỳ sau = **trừ lương hai lần**; bind vào kỳ ≥ `Approved` = `Deducted` mà không bao giờ bị trừ | T3 đọc kỳ bằng `SELECT status … FROM payroll_periods WHERE id = … AND company_id = NEW.company_id FOR SHARE`: **nhả** (`OLD.payroll_period_id` → NULL) chỉ khi kỳ CŨ ∈ `{CollectingData, Calculated}`; **bind** (NULL → `NEW.payroll_period_id`) chỉ khi kỳ MỚI ∈ `{CollectingData, Calculated}` (tag `period-frozen`). Luồng hợp lệ không bị chặn: máy tính lương nhả/bind dưới row-lock kỳ **sau** khi đã qua `FROZEN_STATUSES` (`payroll-calc.service.ts:84`). `FOR SHARE` xếp hàng với `FOR UPDATE` của `submit`/`approve` ⇒ không lọt race «đọc `Calculated` trong lúc kỳ đang sang `Reviewing`». ⚠️ `bonus_penalties` (0564) có **cùng lỗ** — ghi nợ R9, KHÔNG vá ở WO này |
| **M1** | Một tiền tố ⇒ hai mã khác nhau (T2: 027 và 400; T3: hai `kind` của 025) ⇒ BE-4 không map đúng được | Message = `<trigger>:<tag>: <chi tiết>`. **Danh sách tag ĐÓNG** — T1: `period-immutable` · `frozen` · `insert-completed` · `not-found`. T2: `frozen` · `insert-into-completed` · `move-to-completed` · `cross-user` · `cross-period` · `not-found`. T3: `insert-shape` · `frozen` · `rebind` · `status-terminal` · `period-frozen` · `not-found`. SPEC-11 §12.1 map theo **tag**; test assert **tag**, không chỉ tiền tố |
| **M2** | Trigger không nói gì khi lookup trả rỗng ⇒ dưới RLS (GUC sai/thiếu) (iv) cho qua im lặng | Mọi lookup lọc `company_id = NEW.company_id` (hoặc `OLD.`), `IF NOT FOUND THEN RAISE …:not-found`; so sánh cột nullable bằng `IS DISTINCT FROM` (khuôn `0564:433`) |
| **M3** | T3 chỉ `BEFORE UPDATE` ⇒ INSERT thẳng hàng `Approved`/`Deducted` với `created_by NULL` qua mặt cả `four_eyes_check` lẫn (E) | **T3 = `BEFORE INSERT OR UPDATE`**. INSERT bắt buộc `status='Pending' AND payroll_period_id IS NULL AND consumed_at IS NULL AND decided_by IS NULL AND decided_at IS NULL AND created_by IS NOT NULL` (tag `insert-shape`) |

**Sửa trong lúc code (không cần review lại):**

- **M4** ca D8: conn1 `SELECT … FOR NO KEY UPDATE` (không `FOR UPDATE` — kiểm FK tự lấy `KEY SHARE` và ra `55P03` ngay cả khi T2 KHÔNG có `FOR SHARE` ⇒ xanh-RỖNG); conn2 UPDATE cột ngoài FK (`paid_at`); **ca DƯƠNG** conn1 `FOR KEY SHARE` ⇒ conn2 thành công; `ROLLBACK` conn1 trong `finally`.
- **M5** `done_when` BE-4 += *«tx ghi đợt + dòng khoá theo thứ tự kỳ `FOR UPDATE` (nếu chạm kỳ) → đợt `FOR UPDATE` → rồi mới ghi dòng; ca hai tx song song cùng đợt KHÔNG `40P01`»* — `FOR SHARE` của T2 nâng khoá thành deadlock nếu service ghi dòng trước rồi UPDATE đợt.
- **M6** `apps/api/demo-seed-full.mjs:755,785–789` INSERT kỳ `'Paid'` không `paid_*` ⇒ đổi sang `'Published'` + comment; thêm file vào `paths`.
- **M7** R1/O-2: BE cũ chạy trên DB đã `0572` ⇒ `publish` ghi `'Paid'` thiếu `paid_by` = **500** và `/me/payslips` `200 []`. Owner đã chốt deploy bình thường (BE + DB cùng lúc) — thêm vào PR + `RELEASE`: **CẤM rollback artifact BE về trước mốc DB-2** khi chưa có migration đảo.
- **M8** VERIFY #7: so `pg_get_constraintdef` **đúng bằng** chuỗi kỳ vọng (lấy từ lane sau khi áp) cho `status_check` + 4 CHECK cặp — `LIKE '%Published%'` để lọt việc xoá `'Locked'`.
- **M9** §8.3: gieo **2 công ty**; thêm kỳ `Locked` **đã xoá mềm**; kỳ `Paid`/`Locked` có con thật (`payslips` · `payroll_period_lines` · `bonus_penalties` đã consume); ca nhóm E dựng hàng vi phạm **đúng MỘT** CHECK và ghim TÊN (`pg-reports-arbitrary-check-when-multiple-violated`).
- **NIT** guard (1) assert `rolsuper OR rolbypassrls` của `current_user` · ghi rõ `set_config('lock_timeout',…,true)` sống tới hết tx migrator (phủ cả `0573`) · quy ước **dấu hàng di sản** `paid_at = published_at AND paid_by = published_by` để BE-4/FE-3 không hiện kỳ `Locked` di sản «đã chi» cho người chưa có dòng chi · R3 dẫn `0570:15` (v1 chưa lên PROD) · bỏ D11 (bị `consumed_pair_check` chặn trùng — xanh vì CHECK, không vì trigger) · ghi chi phí T2 = 2 lookup/dòng (067 lập đợt lớn là O(N) câu trong trigger) · NOTI 024–027 `is_enabled=true` trước khi có nguồn phát (boot-guard một chiều, không đỏ).

### 3.6 Bốn CHECK/index BỔ SUNG ngoài DB-13 §14 — rẻ, cùng lớp lỗi đã thấy

| Bổ sung | Lỗ nếu thiếu |
| --- | --- |
| `payroll_advances_deducted_bound_check` `status <> 'Deducted' OR payroll_period_id IS NOT NULL` | DB-13 chỉ có chiều «đã bind ⇒ `Deducted`»; chiều ngược vắng ⇒ hàng `Deducted` **không trỏ kỳ nào** = khoản tạm ứng đã «trừ» vào hư không |
| `payroll_advances_four_eyes_check` `decided_by IS NULL OR created_by IS NULL OR decided_by <> created_by` | tự duyệt chỉ chặn ở service; race hai request ⇒ chốt cuối DB, khuôn `payroll_periods_four_eyes_check`. ⚠️ vế `created_by IS NULL` là lối thoát khi user bị xoá cứng (FK `SET NULL`) — ghi rủi ro R6 |
| `payroll_payment_lines_bank_pair_check` `bank_account_snapshot IS NULL OR (bank_name_snapshot IS NOT NULL AND account_holder_snapshot IS NOT NULL)` | mirror `payroll_employee_settings_bank_pair_check` — dòng UNC không tên chủ TK là dòng không gửi được |
| `payroll_advances_company_period_idx (company_id, payroll_period_id) WHERE payroll_period_id IS NOT NULL` | «nhả consume của CHÍNH kỳ đó» (`UPDATE … WHERE payroll_period_id=$1`) quét cả bảng dưới row-lock kỳ |

SPEC-11 §12.1 bảng `constraint → mã` thêm hàng **cùng commit** (tên không có trong bảng = 500 ở vùng đỏ):
`payroll_advances_four_eyes_check` ⇒ 409 **025** `self-approval` · tiền tố `payroll_advance_freeze_guard` ⇒ 409 **025**
`advance-not-pending`/`advance-already-deducted` · tiền tố `payroll_payment_batch_freeze` ⇒ 409 **027**
`batch-already-completed` · tiền tố `payroll_payment_line_guard` ⇒ 409 **027** `batch-already-completed` (đóng băng)
/ 400 `VALIDATION-ERR-001` (nhất quán chéo — service phải chặn trước) · `payroll_budgets_year_unit_uq` (đã có) ·
3 CHECK mới còn lại ⇒ 400 `VALIDATION-ERR-001`.

---

## 4. Migration `0572_s15payrolldb2_payroll_v2_trackc_ddl.sql` — thứ tự BẮT BUỘC

```text
(1) GUARD fail-loud — TRƯỚC mọi DDL
    · to_regclass: payroll_periods · payroll_templates · payslips · org_units · users
    · UNIQUE (company_id,id) trên 5 bảng ĐÍCH đó (khuôn 0570:44–58)
    · payroll_periods CHƯA có template_id/paid_by/paid_at; status_check CHƯA chứa 'Published'
    · 4 bảng mới CHƯA tồn tại
    · tập trigger non-internal trên payroll_periods = ∅ (backfill UPDATE không được bắn trigger lạ)
    · 8 cặp track C tồn tại + is_sensitive=true; grant trên role HỆ THỐNG (company_id IS NULL) cho 8 cặp
      = SET-EQUALITY 14 bộ (employee 1 · payroll-officer 6 · company-admin 7) — thiếu ⇒ 0571 chưa chạy
(2) ALTER payroll_periods — MỘT khối DO (nguyên tử bất kể migrator gói tx thế nào)
    set_config('lock_timeout','5s',true)
    (2a) ADD COLUMN template_id uuid · paid_by uuid · paid_at timestamptz   (NULL)
    (2b) composite FK template_id → payroll_templates (company_id,id) NO ACTION
         composite FK paid_by     → users (company_id,id) ON DELETE SET NULL (paid_by)
    (2c) v_paid   := count(*) WHERE status='Paid'     ← MỌI hàng, KHÔNG lọc deleted_at (CHECK soi cả hàng xoá mềm)
         v_locked := count(*) WHERE status='Locked'
         assert: 0 hàng Locked có published_by/at NULL
    (2d) DROP/ADD status_check — 8 giá trị
    (2e) UPDATE status='Published' WHERE status='Paid'; GET DIAGNOSTICS = v_paid, lệch ⇒ RAISE
         ⚠️ KHÔNG đụng updated_at/updated_by (di trú NGHĨA, không phải thao tác người dùng)
    (2f) [O-1 lối A] UPDATE paid_by=published_by, paid_at=published_at WHERE status='Locked' AND paid_by IS NULL;
         GET DIAGNOSTICS = v_locked, lệch ⇒ RAISE
    (2g) DROP/ADD submitted_pair · approved_pair · published_pair (vế trái + 'Published'); ADD paid_pair
    (2h) post: count(status='Paid')=0 · count(status IN ('Paid','Locked') AND paid_by IS NULL)=0
         RAISE NOTICE '[0572] Paid→Published=% · Locked gan vet paid=% — DAN SO NAY VAO PR'
(3) 4 bảng — mỗi bảng: CREATE (CHECK + UNIQUE(company_id,id)) → ENABLE RLS → FORCE → POLICY tenant_isolation
    → composite FK → index → GRANT SELECT,INSERT,UPDATE TO mediaos_app   (khuôn 0570 khối 5)
    thứ tự: payroll_advances · payroll_payment_batches · payroll_payment_lines · payroll_budgets
(4) 3 function + trigger: T1 (batches) → T2 (lines) → T3 (advances)
(5) VERIFY fail-loud
```

### 4.1 Cột · CHECK · FK · index — danh sách ĐÓNG

| Bảng | CHECK (tên đầy đủ, tiền tố bảng) | Composite FK | Index |
| --- | --- | --- | --- |
| `payroll_advances` | `status_check` · `amount_check` · `month_check` · `decided_pair_check` · `reject_note_check` · `consumed_pair_check` · `consume_status_check` · **`deducted_bound_check`** · **`four_eyes_check`** | `user_id` NO ACTION · `payroll_period_id` NO ACTION · `decided_by` SET NULL (col) · `created_by`/`updated_by`/`deleted_by` SET NULL (col) = **6** | `company_user_month_idx` · `company_status_idx` · **`company_period_idx`** |
| `payroll_payment_batches` | `method_check` · `status_check` · `completed_pair_check` | `payroll_period_id` NO ACTION · `completed_by` SET NULL (col) · 3 cột vết = **5** | `company_code_uq` (partial) · `company_period_idx` (**non-unique, có chủ đích**) |
| `payroll_payment_lines` | **`bank_pair_check`** | `batch_id` NO ACTION · `user_id` NO ACTION · `payslip_id` NO ACTION · 3 cột vết = **6** | `batch_user_uq` · `company_batch_idx` · **`payslip_uq`** (cả ba partial `WHERE deleted_at IS NULL`) |
| `payroll_budgets` | `year_check` · `amount_check` | `org_unit_id` NO ACTION · 3 cột vết = **4** | `year_unit_uq` với `COALESCE(org_unit_id, '0000…0000'::uuid)` |

Cột theo DB-13 §14.1–§14.4 **nguyên văn**; `company_id uuid NOT NULL DEFAULT (NULLIF(current_setting(...),''))::uuid
REFERENCES companies ON DELETE CASCADE` (khuôn `0570:146`). **Không** lưu số tiền ở `payroll_payment_lines`
(SPEC-11 §8.2 C3). **Không** GRANT DELETE cho bảng nào; **`mediaos_worker` 0 quyền** trên cả 4.

### 4.2 VERIFY fail-loud `0572` — danh sách ĐÓNG (clone `0570` 7.x, KHÔNG rút gọn)

1. 4 bảng: `relrowsecurity AND relforcerowsecurity` + đúng 1 policy `tenant_isolation`.
2. 0 GRANT DELETE cho `mediaos_app` trên cả 4; tập quyền app **đúng bằng** `INSERT,SELECT,UPDATE` (`aclexplode`).
3. `mediaos_worker` **0** quyền trên cả 4; **đối chứng DƯƠNG**: worker **vẫn** `SELECT` `payroll_periods`.
4. 0 GRANT cấp cột trên 4 bảng (`revoke-table-grant-wipes-column-grants`).
5. `company_id NOT NULL` + `<bảng>_company_id_id_uq` trên cả 4.
6. Composite FK trên 4 bảng **đúng 21**; 0 FK một cột ngoài `companies`; `payroll_periods` có **đúng tên**
   `payroll_periods_template_id_company_fk` + `payroll_periods_paid_by_company_fk`.
7. Mọi CHECK ở §4.1 + 4 CHECK cặp `payroll_periods` tồn tại **đúng tên**; `status_check` và 4 CHECK cặp chứa
   `'Published'` (`pg_get_constraintdef LIKE`) **trừ** `paid_pair_check` phải **KHÔNG** chứa `'Published'`.
8. 3 unique index `payslip_uq` · `batch_user_uq` · `year_unit_uq` tồn tại **đúng tên** và `indisunique`;
   `company_period_idx` của batches **KHÔNG** unique (ghim chiều ngược — ai «sửa» thành unique là giết kỳ nhiều đợt).
9. 3 trigger tồn tại, `NOT tgisinternal`, đúng bảng; `tgenabled = 'O'`.
10. Hậu di trú (2h) lặp lại ở đây (khối VERIFY là cổng cuối, không tin khối trước).

> ⚠️ Chạy bằng role migration (SUPERUSER/BYPASSRLS) ⇒ chứng minh policy **tồn tại**, không chứng minh **đúng**.
> Chứng minh thật: int-spec nhóm A chạy bằng `mediaos_app` (R4).

---

## 5. Migration `0573_s15payrolldb2_noti_trackc.sql` (khuôn `0566`, BỎ khối nới CHECK)

1. **(A) ĐO rồi NO-OP**: 4 CHECK NOTI chứa `'PAYROLL'`/`'Payroll'` ⇒ `RAISE NOTICE '… da co tu 0566 — NO-OP co chu dich'`;
   thiếu ⇒ `RAISE EXCEPTION` (0566 chưa chạy). **Không** viết ALTER rỗng (DB-13 §15.3 D).
2. **(B) 4 event** GLOBAL, `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`:

   | Mã | `event_code` | priority | template `target_url` | biến (ĐÓNG, 0 biến tiền) |
   | --- | --- | --- | --- | --- |
   | 024 | `PAYROLL_ADVANCE_SUBMITTED` | Normal | `/payroll/advances` | `actor_name` · `deduct_period_month` · `payroll_advance_id` |
   | 025 | `PAYROLL_ADVANCE_APPROVED` | **High** | `/me/payroll-advances` | `actor_name` · `deduct_period_month` · `payroll_advance_id` |
   | 026 | `PAYROLL_ADVANCE_REJECTED` | **High** | `/me/payroll-advances` | `actor_name` · `deduct_period_month` · `reason` · `payroll_advance_id` |
   | 027 | `PAYROLL_PAYMENT_BATCH_COMPLETED` | Normal | `/payroll/periods/{payroll_period_id}` | `period_month` · `payroll_period_id` |

   Tất cả: `notification_type='Payroll'` · `IN_APP` · `is_enabled=true` · `is_system_event=false` ·
   `dedupe_strategy='DedupeKey'` · `dedupe_window_seconds=NULL`. Link 024 **tĩnh** vì SPEC-11 §9.1 PAY-SCREEN-012
   không có route chi tiết; link 027 về kỳ vì dedupe theo `{periodId}` (một KỲ báo một lần).
3. **(C) 4 template** IN_APP vi-VN (`ON CONFLICT (template_code) … DO NOTHING`).
4. **(D) VERIFY**: event PAYROLL global = **8** (SET-EQUALITY mã) · 4 event mới đúng dedupe/enabled/system/type/priority ·
   template PAYROLL = **8** · khoá `variables_schema` của 4 template mới **không** khớp
   `(amount|salary|gross|net|total|tien)` · 4 CHECK NOTI còn nhánh `IS NULL OR` trên `notifications`.

Parity: `notification-event-catalog.const.ts` +4 (khối PAYROLL) ⇒ `NOTI_EVENT_COUNT` **79** · `NOTI_ENABLED_EVENT_COUNT` **65**.

---

## 6. Code đổi nghĩa `Paid` — chi tiết thi công

### 6.1 BE

- `payroll-fsm.ts`: `PeriodAction += "complete-batch"` · `TrailCol += "paid"` · `PERIOD_TRANSITIONS` **11 cạnh**
  (`publish: Approved→Published` · `complete-batch: Published→Paid` · `lock: Paid→Locked` giữ) · `TRAIL_RESET`
  thêm hàng · `assertReopenAllowed` vế hai: `Published|Paid|Locked` ⇒ 004 `period-terminal` (vế một
  `payslips-generated` vẫn bắn trước — vế hai là phòng thủ chiều sâu). **Không** thêm caller cho `complete-batch`.
- `applyTransitionTx` **không sửa** — nhưng thêm ca census §8.2 (khoá `${col}By/${col}At` của MỌI `TrailCol` phải là
  cột thật của `payrollPeriods`; drizzle **bỏ qua im lặng** khoá lạ và chỉ `paid_pair_check` cứu ở DB).
- `payroll-payslips.repository.ts`: `export const PUBLISHED_PERIOD_STATUSES` 3 giá trị.
- `payroll.mapper.ts` `derivePayslipStatus` · `payroll-calc.service.ts` `FROZEN_STATUSES`.
- **NOTI 023 giữ chỗ phát ở `publish`** (`payroll-payslips.service.ts:142–156`) — code không đổi, test ghim kỳ `Published` + có outbox 023.

### 6.2 FE

- `payroll-actions.ts`: `type PeriodFsmAction = PayrollPeriodAction | "complete-batch"`; `PERIOD_TRANSITIONS` gõ theo
  `PeriodFsmAction`, **11 cạnh đúng hình dạng regex** của parity spec; `PAYROLL_PERIOD_ACTIONS` + `PERIOD_ACTION_PAIR`
  **KHÔNG** thêm `complete-batch` (nút hoàn tất sống ở màn Chi trả — FE-3). Cấm lách regex bằng cách viết khác hình
  dạng (`refactor-to-helper-blinds-syntax-census`).
- `payroll-fsm-parity.spec.ts` 10 → **11**. `isReopenBlocked` thêm `Published`.
- `constants.ts` 8 trạng thái · badge `Published: "brand"`, `Paid: "success"`. i18n như §3.1.

### 6.3 contracts

`payrollPeriodStatusEnum` **8** (thứ tự vòng đời) · MỚI `payrollAdvanceStatusEnum` (4) · `paymentBatchMethodEnum` (2) ·
`paymentBatchStatusEnum` (3) — mirror CHECK **hai chiều đúng bằng** + spec ghim; barrel `index.ts` nếu export tường minh.

---

## 7. Parity CÙNG COMMIT

| File | Việc |
| --- | --- |
| `apps/api/src/db/schema/payroll.ts` | `templateId` · `paidBy` · `paidAt` + `status_check` 8 + 4 CHECK cặp đúng định nghĩa `0572` |
| `apps/api/src/db/schema/payroll-disbursement.ts` **(MỚI)** + `schema/index.ts` (additive) | 4 bảng, đúng tên CHECK/index |
| `test/integration/rls-registry.ts` | 4 case + fixture (dòng chi: user → kỳ → phiếu → đợt → dòng, **phiếu cùng user + cùng kỳ với đợt** — T2 (iv)) |
| `test/helpers/seed.ts` `cleanupTenants()` | §7.1 |
| `foundation/retention/retention.service.ts` + `.spec.ts` (`APPEND_ONLY_TABLES`) | `PROTECTED_TABLES += 4` |
| `foundation/seed/notification-event-catalog.const.ts` | +4 event, đếm 79/65 |
| `harness/backlog.mjs` | DB-2 `paths` (§7.2) · `done_when` #3 tách (§3.4) · **BE-4** `done_when` += luật PHỦ ca ÂM đợt 2 + map 3 tiền tố trigger + `four_eyes_check` · **BE-5** `done_when` += PDF 084 dùng `PUBLISHED_PERIOD_STATUSES` |
| `docs/DB/DB-13` §12.3 · §14.1–§14.3 · §15.3 C/D | §3.2 · §3.3 · §3.5 · §3.6 |
| `docs/SPEC/SPEC-11` §13.1 (bảng CHECK cặp) · §12.1 (map constraint → mã) | §3.2 · §3.6 |
| `docs/permission-matrix-spec.md` §9g · §9g.2 | «CHƯA SEED» → «ĐÃ SEED 11/09 mig `0571`» (drift tài liệu đo được) |
| `docs/erd-current.md` | 4 bảng + 3 trigger + RLS/append |

### 7.1 `cleanupTenants()` — chèn ĐÚNG CHỖ

`payroll_payment_lines` → payslips/batches/users (NO ACTION) ⇒ **trước** `DELETE FROM payslips`.
`payroll_payment_batches` · `payroll_advances` → payroll_periods ⇒ **trước** `DELETE FROM payroll_periods` (`seed.ts:524`).
`payroll_budgets` → org_units ⇒ trước org_units/users. `payroll_periods.template_id → payroll_templates`: kỳ đã xoá ở
`:524`, mẫu ở `:530` ⇒ thứ tự hiện có **đúng sẵn** — không dời.

### 7.2 `paths` của WO — thiếu 8 mục, sai 1

Sai: `apps/api/src/permissions/**` (thư mục không tồn tại, và DB-2 không chạm `permission/`) ⇒ gỡ.
Thiếu: `apps/api/src/payroll/**` (thay cho chỉ `payroll-fsm.ts`) · `apps/api/src/foundation/**` (retention) ·
`apps/app/src/routes/payroll/**` · `apps/app/src/i18n/**` · `packages/web-core/**` · `packages/contracts/src/index.ts` ·
`docs/SPEC/**` · `docs/erd-current.md` + `docs/permission-matrix-spec.md`. `paths` lái guard-scope **và** chọn reviewer.

---

## 8. Test — RED TRƯỚC

### 8.1 File mới `test/integration/s15-payroll-db2-invariants.int-spec.ts`

| Nhóm | Ca (mỗi ÂM có một DƯƠNG đứng cạnh) |
| --- | --- |
| **A** RLS | A1 4 bảng RLS+FORCE+policy · A2 DƯƠNG INSERT đúng tenant · A3 tenant A không thấy hàng B (4 bảng) · A4 ghi chéo tenant bị chặn (composite FK/`WITH CHECK`) |
| **B** GRANT | B1 0 DELETE × 4 · B2 DƯƠNG app INSERT/UPDATE được · B3 worker 0 quyền × 4 · B4 DƯƠNG worker còn SELECT `payroll_periods` |
| **C** CHECK · UNIQUE | C1 advances: status lạ · amount 0 · month `2026-13` · `Rejected` không note · cặp consume lệch · bind mà không `Deducted` · **`Deducted` không bind** · **tự duyệt** (mỗi ca ghim TÊN constraint) · C2 DƯƠNG vòng đời hợp lệ · C3 batches: method/status lạ · `Completed` thiếu vết · C4 **hai đợt CÙNG KỲ INSERT được** (ghim non-unique) · C5 **một phiếu ở hai đợt ⇒ `23505` constraint = `payroll_payment_lines_payslip_uq`** · C6 trùng user trong một đợt ⇒ `batch_user_uq` · C7 DƯƠNG dòng xoá mềm ở đợt A thêm được vào đợt B `Draft` · C8 bank snapshot thiếu chủ TK · C9 budgets: hai hàng `org_unit_id NULL` cùng năm ⇒ `year_unit_uq` · C10 DƯƠNG khác năm / khác đơn vị · C11 year 1999 · amount −1 |
| **D** trigger | D1 đợt `Completed` → `status='Draft'` bị chặn · D2 DƯƠNG sửa `note` đợt `Completed` · D3 dòng của đợt `Completed`: sửa `paid_at` / `payslip_id` / **xoá mềm** — mỗi cái bị chặn · D4 **INSERT dòng vào đợt `Completed`** bị chặn · D5 chuyển dòng **sang** đợt `Completed` bị chặn · D6 DƯƠNG đợt `Draft`: sửa/xoá mềm dòng được · D7 phiếu của user khác / kỳ khác ⇒ bị chặn (nhất quán chéo) · D8 **FOR SHARE**: conn1 `SELECT … FOR UPDATE` đợt; conn2 sửa dòng với `lock_timeout=300ms` ⇒ **`55P03`** (tất định, không đo đồng hồ) · D9 advances: sửa `amount` khi `Approved` · re-bind kỳ khác · `Rejected→Approved` · `→Pending` — mỗi cái bị chặn · D10 DƯƠNG `Deducted→Approved` **kèm** nhả cả cặp · D11 ÂM `Deducted→Approved` nhả **một** vế · D12 DƯƠNG sửa `amount` khi `Pending` · D13 cả 3 trigger `tgenabled='O'` (ca đối kháng DISABLE tạm phải kèm ca assert đã bật lại — `db-invariant-kills-adversarial-fixtures`) |
| **E** `payroll_periods` | E1 DƯƠNG hàng `Published` đủ vết · E2 `Published` thiếu `published_*` · **E3 `Published` thiếu `submitted_*`** (§3.2) · E4 `Paid` thiếu `paid_*` · E5 `Locked` thiếu `paid_*` (hàng mới) · E6 status `'Paid '` lạ ⇒ `status_check` · E7 `template_id` trỏ mẫu tenant khác ⇒ FK · E8 `paid_by` xoá cứng user ⇒ hành vi ghi rõ (khuôn `locked_by`) |
| **F** NOTI | F1 event PAYROLL = SET-EQUALITY 8 mã · F2 4 mới đúng dedupe/priority/enabled/system/type · F3 template 4 mới 0 biến tiền + đúng `target_url` · F4 `notifications` giữ `IS NULL OR` |
| **G** | G1 `_journal.json` có `0572` + `0573` · G2 `scripts/check-migration-no-drop.sh` xanh |

### 8.2 Unit

- `payroll-fsm.spec.ts`: 11 cạnh · `publish` đích `Published` · `complete-batch` chỉ từ `Published` · `lock` từ
  `Published` ⇒ 409 001 · `reopen` từ `Published` ⇒ 004 · `TRAIL_RESET['complete-batch'].set = ['paid']`.
- **Census trail→cột** (mới, cạnh `payroll-fsm.spec.ts`): với mọi `TrailCol`, `payrollPeriods[\`${c}By\`]` và
  `[\`${c}At\`]` là cột drizzle thật. Đột biến: xoá `paidBy` khỏi schema ⇒ ca ĐỎ.
- `payroll.mapper.spec.ts`: kỳ `Published` ⇒ phiếu `Published`/`Acknowledged`; trạng thái lạ ⇒ `null` (fail-closed giữ).
- contracts `payroll.spec.ts`: 8 + 3 enum mới **đúng bằng** CHECK.
- FE: `payroll-actions.spec.ts` · `PeriodActionBar.spec.tsx` (kỳ `Published`: **không** nút `publish`/`lock`/`reopen`)
  · parity 11.

### 8.3 Bằng chứng backfill — lượt lane CÓ dữ liệu (khuôn DB-1 §8.2 lối iii)

`lane-db-setup.sh s15db2bf` → migrate tới `0571` → gieo **5 kỳ**: `Paid` · `Paid` **đã xoá mềm** · `Locked` ·
`Approved` · `Draft` (đủ vết theo CHECK v1) → áp `0572` → dán `RAISE NOTICE` + bảng trước/sau vào PR. Kỳ vọng:
2 `Published` (gồm hàng xoá mềm) · `Locked` có `paid_*` = `published_*` · 0 `Paid`. **Lượt ĐỎ đối chứng**: gieo một hàng
`Locked` rồi xoá tay `published_by` bằng `ALTER TABLE … DISABLE` không được (CHECK) ⇒ thay bằng assert (2c) qua
unit SQL: chạy khối (2c) trên hàng giả trong tx rollback — nếu không dựng được thì ghi rõ «không dựng được trạng
thái vi phạm do CHECK v1 cấm», không giả vờ đã chạy.

### 8.4 Test/pin DI SẢN phải sửa (đo 14/09 — đo lại lúc chạy)

| File | Hit `Paid` | Việc |
| --- | --- | --- |
| `test/integration/payroll-be2-lifecycle.int-spec.ts` | 3 | `publish` ⇒ `Published`; lọc `?status=Published`; **thêm ca**: kỳ đúng `Published` ⇒ `/me/payslips` thấy · `/me/payslips/:id` 200 · ack 201 (SPEC-11 §13.2, §21.1 ca 13) |
| `test/integration/s13-payroll-qa1-fsm-race.int-spec.ts` | 11 | ma trận 8 trạng thái; `FROZEN` + `Published`; fixture trạng thái `Paid` phải kèm `paid_*`; double-publish dừng ở `Published` |
| `test/integration/s13-payroll-qa1-idor-tenant.int-spec.ts` | 6 | `buildPaidPeriod` → đi tới `Published` (không route nào tới `Paid` trước BE-4) |
| `test/integration/payroll-be2-permission.int-spec.ts` | 2 | comment + trạng thái kỳ |
| `src/payroll/payroll-fsm.spec.ts` · `payroll.mapper.spec.ts` | 5 · 4 | §8.2 |
| `apps/app/.../PeriodActionBar.spec.tsx` · `payroll-actions.spec.ts` · `payroll-fsm-parity.spec.ts` | 3 · 4 · — | §8.2 |
| `packages/contracts/src/payroll.spec.ts` | 1 | 8 giá trị |
| `test/integration/noti-seed-catalog-permissions.int-spec.ts` | pin | 75→**79**, 61→**65** (literal CỐ Ý, không đổi thành hằng) |
| `test/integration/s5-noti-fix1-deeplink.int-spec.ts` | pin | template global 61→**65** + comment cộng dồn |
| `test/integration/s13-payroll-db1-invariants.int-spec.ts` E1 | tập 4 | lọc `event_code IN (020–023)`; tập 8 thuộc F1 mới |

**Chạy thật:** `bash scripts/lane-db-setup.sh s15db2` → `bash harness/check.sh --lane-db=s15db2`; trước PR
`bash harness/check.sh --all`. Không `LANE_DB` = «XANH KHÔNG ĐỦ BẰNG CHỨNG».

---

## 9. Rủi ro tồn đọng

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Sau DB-2, **`lock` không tới được** cho mọi kỳ `Published` (cửa vào `Paid` là 072 của BE-4). Kỳ v1 đang `Paid` trên PROD thành `Published` ⇒ tạm thời không khoá được | ⏳ **O-2** owner chốt lịch deploy |
| R2 | Kỳ v1 đã chi ngoài hệ thống nằm `Published` **vĩnh viễn** trừ khi lập đợt chi phủ đủ | quyết định của DB-13 (không tự nhận «đã chi»); ghi erd |
| R3 | Số kỳ `Paid`/`Locked` trên PROD không đo được từ agent | backfill tự đếm + verify khớp; ops dán NOTICE |
| R4 | VERIFY chạy bằng superuser — chứng minh tồn tại, không chứng minh đúng | int-spec A chạy `mediaos_app` |
| R5 | Luật PHỦ + «kỳ `Published` mới lập đợt» + «đợt rỗng không `Completed`» không ép được ở DB | service BE-4 + ca test (DB-13 §14.2) |
| R6 | `four_eyes_check`/`decided_pair_check` có lối thoát khi user bị **xoá cứng** (FK `SET NULL`) | user chỉ xoá mềm trong hệ thống; cùng hình dạng `payroll_periods` v1 |
| R7 | Không CHECK «`Published`+ ⇒ `payslips_generated_at NOT NULL`» | cố ý không thêm: dữ liệu di sản G12 chưa đo được ⇒ nguy cơ `23514`; service ERR-007 giữ |
| R8 | `payroll_periods.template_id` không index | bảng nhỏ (1 hàng/tháng); BE-4 `template-in-use` đọc một lần |

---

## 10. Owner phải chốt TRƯỚC khi code — ✅ ĐÃ CHỐT 14/09/2026: **O-1 = A** · **O-2 = (a) deploy bình thường**

- **O-1** — §3.3: kỳ v1 `Locked` và `paid_pair_check`: **A** copy `published_*` → `paid_*` *(đề xuất)* · B `NOT VALID` · C bỏ `Locked` khỏi vế trái (DB-13 cấm).
- **O-2** — R1: sau merge DB-2, BE PROD **(a)** deploy bình thường, chấp nhận `lock` tạm không dùng được tới BE-4 *(đề xuất — FE tự deploy, BE giữ lại thì FE v2 dán nhãn «Đã chi trả» cho kỳ `Paid` v1 của BE cũ)* · **(b)** giữ BE PROD ở bản cũ tới khi BE-4 merge.

---

## 11. Definition of Done

### 11.0 BẰNG CHỨNG ĐÃ CHẠY (14/09/2026)

**Lane MỚI `mediaos_s15db2`** (chain `0000→0573`): đo thẳng DB — 4 bảng `RLS+FORCE` · 3 trigger `tgenabled='O'` ·
`pg_get_constraintdef` của `status_check` + 4 CHECK cặp **khớp từng ký tự** chuỗi VERIFY (M8) · 8 event PAYROLL ·
3 cột mới trên `payroll_periods`.

**Lane CÓ dữ liệu v1 `mediaos_s15db2bf`** (journal tạm lùi về `0571`, gieo **2 công ty** × `Paid` · `Paid` xoá mềm ·
`Locked` · `Locked` xoá mềm · `Approved` · `Draft`, con thật trỏ vào kỳ `Paid`/`Locked`: 8 `payslips` · 8
`payroll_period_lines` · 8 `bonus_penalties` đã consume), rồi áp `0572` bằng `psql -v ON_ERROR_STOP=1`:

```text
NOTICE:  [0572] DO DUOC: Paid->Published=4 (xoa mem 2) · Locked gan vet paid=4 (xoa mem 2) — DAN SO NAY VAO PR
NOTICE:  [0572] VERIFY XANH: payroll_periods 8 trang thai + 4 CHECK cap · 4 bang moi · 21 composite FK · 3 trigger.
```

| | Paid | Published | Locked | Locked mang dấu di sản `paid_*=published_*` | Approved | Draft | con (phiếu · dòng · thưởng/phạt) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TRƯỚC | 4 (2 xoá mềm) | — | 4 (2 xoá mềm) | — | 2 | 2 | 8 · 8 · 8 |
| SAU | **0** | **4 (2 xoá mềm)** | 4 | **4** | 2 | 2 | 8 · 8 · 8 (0 lỗi RI) |

Lane `s15db2bf` đã DROP sau khi đo. ⚠️ Ca đỏ «kỳ `Locked` thiếu `published_*`» (guard 2c) **KHÔNG dựng được** —
`published_pair_check` v1 cấm hàng đó từ `0564`; guard giữ lại làm lưới cho dữ liệu ngoài chuỗi migration.

**Test đã chạy trên `LANE_DB=mediaos_s15db2`:** `s15-payroll-db2-invariants` (mới) · `s13-`/`s15-payroll-db1-invariants` ·
`rls-guards` · `rls-coverage-assert` · `noti-seed-catalog-permissions` · `s5-noti-fix1-deeplink` · `payroll-be2-lifecycle` ·
`s13-payroll-qa1-fsm-race` (ma trận 72 ô) · `s13-payroll-qa1-idor-tenant` · `payroll-be2-permission` ·
`payroll-be2-noti-audit` · `retention.service.spec` · `xtenant-fk-ratchet` · `catalog-fk-tenant-guard` ·
`role-permission-grants` ⇒ **xanh**. Unit: contracts 23/23 · API FSM+mapper 33/33 · FE payroll 50/50. Typecheck
API + app sạch; eslint 26 file đổi sạch.

- [ ] `0572` + `0573` áp sạch trên lane **MỚI TINH** và lane **CÓ dữ liệu** (§8.3) — số trước/sau trong PR.
- [ ] `_journal.json` có 2 tag · `check-migration-no-drop.sh` xanh.
- [ ] `s15-payroll-db2-invariants` xanh trên `LANE_DB`, mọi ÂM có DƯƠNG đứng cạnh.
- [ ] Ca đối chứng ĐÚNG CỔNG: `NO FORCE` một bảng mới ⇒ `rls-guards.int-spec` ĐỎ đích danh; bật lại.
- [ ] Đột biến: bỏ `'Published'` khỏi `PUBLISHED_PERIOD_STATUSES` ⇒ ca `/me/payslips` ở `Published` ĐỎ.
- [ ] `pnpm typecheck` · `pnpm build` · `pnpm lint` xanh toàn workspace.
- [ ] `bash harness/check.sh --all` xanh, không banner.
- [ ] FULL gate **tuần tự**: `database-reviewer` (DDL · trigger · khoá) → `security-reviewer` (RLS · GRANT · NOTI payload) → `silent-failure-hunter` (đổi nghĩa `Paid` · fail-open rỗng).
- [ ] Docs §7 đính chính; `backlog.mjs` `paths` + `done_when` BE-4/BE-5.
