# S15-PAYROLL-QA-1 — QA PAYROLL v2 (route 036–085 · 17 cặp mới · FSM 8 trạng thái · công thức)

> Zone 🟡 · LIGHT gate + test logic (`typescript-reviewer` + `quality-gate`); hai vá sản phẩm chạm bộ lọc Own ⇒ thêm
> `security-reviewer` HẸP trên đúng hunk đó. Nhánh `test/s15-payroll-qa-1` cắt từ master `9dba4e18`.
> Nguồn nghiệm thu: SPEC-11 §21.1 (30 kịch bản) + `done_when` của WO. Khuôn: S13-PAYROLL-QA-1 (#461).

## 0. Đo-trước (17/09/2026) — ba bản khảo sát độc lập trên master

**Đã có, KHÔNG làm lại:** fuzz parser 1.812 chuỗi có seed (`formula.fuzz.spec.ts`) · vòng/độ sâu/trần node hai
tầng (unit + HTTP) · bảng tay NV-G (bậc cao, trần BH, 2 NPT) + NV-N (gross-up 12 vòng) qua HTTP · FSM unit 50 ô ×
10 action · FSM HTTP 72 ô (S13-QA-1) · luật PHỦ + race hai đợt KHÁC nhau (be4-batches) · race duyệt tạm ứng kép ·
Published ⇒ `/me/payslips*` + 084 thấy phiếu · RLS tự động phủ cả 11 bảng mới (`tenant-isolation` +
`rls-guards` + `rls-coverage-assert`) · sàn Company (Own/Department) cho 80 route (`s13-payroll-qa1-scope-floor`) ·
census mã lỗi 33 mã đều ≥1 lần xuất hiện · NOTI-027 khoá dedupe ghim bằng int-spec.

**Khoảng trống (đích của WO này):**

| #   | Khoảng trống                                                                                                                                                               | SPEC-11 §21.1 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| G1  | **Không spec v2 nào đăng nhập bằng role HỆ THỐNG** (payroll-officer · company-admin · employee · hr-manager · manager · hr) qua HTTP — ma trận 0571 chỉ được đếm hàng ở DB | 17 · 23       |
| G2  | Wildcard `*:*` chỉ có ca HTTP cho 036 (16/17 cặp mới chưa có)                                                                                                              | done_when 1   |
| G3  | Ca thiếu-ĐÚNG-một-cặp: 066–070 · 072 không có; 046 · 051 · 057 · 073 · 075 không có                                                                                        | 17 · 18       |
| G4  | Cặp phụ ở scope Department (071 · 083 · 085) chưa có; 082 chưa có ALLOW báo cáo theo-người                                                                                 | 20            |
| G5  | Cross-tenant GHI: 039 · 041 · 052 · 064 · 075 chưa có; 036/073 chưa kiểm loại trừ khỏi danh sách                                                                           | 19            |
| G6  | Rò tiền qua route GHI (role có `manage:X` thiếu `view:X`) — chỉ có ở tầng DB, chưa có HTTP                                                                                 | 25            |
| G7  | Own fail-closed: 031 rỗng · 032/084 404 cho người KHÔNG có phiếu nào                                                                                                       | 19            |
| G8  | Race: hoàn tất CÙNG một đợt song song · duyệt vs từ chối tạm ứng · duyệt vs trả kỳ · 085 lấy-hoặc-tạo song song                                                            | 15            |
| G9  | FSM HTTP: kỳ vọng suy từ `nextStatus()` (code đang bị test) — cần bảng tay; reset vết qua HTTP còn thiếu vế                                                                | 12            |
| G10 | Số học: ngưỡng bậc thuế đúng mốc ±0,01 · NPT bắt đầu/kết thúc sát kỳ · tỉ lệ hiệu lực giữa tháng · đúng trần BH · bậc thấp qua HTTP                                        | 1–4           |
| G11 | Công thức: PATCH 047 sau Calculated không đổi số (ca hiện có ghi DB thẳng) · fuzz ở biên HTTP 048                                                                          | 5 · 11        |
| G12 | Mã 005/006 chỉ có ca unit (map lỗi PG) — chưa có ca HTTP                                                                                                                   | 30a           |
| G13 | Census 2 tầng (2) KHÔNG so cờ `isSensitive` của decorator (thu thập rồi bỏ)                                                                                                | 17            |
| G14 | FE: T4 (nút xuất UNC) · T6 (mask cột tiền Tạm ứng/Đợt chi/Dòng chi/Ngân sách) chưa có spec                                                                                 | done_when 6   |
| G15 | Nợ: `s15-payroll-be4-batches.int-spec.ts` 945 dòng; 4 spec `s15-payroll-be2-*` ngoài `test:cov:payroll`                                                                    | done_when 7   |

**Lỗi SẢN PHẨM lộ ra khi khảo sát (vá CÙNG WO):**

- **P1 — 017 xuất bảng lương XLSX không chống formula-injection.** `payroll-export.service.ts` ghi `employeeCode` ·
  `displayName` · `adjustment_reason` (chữ tự do) thô; 071/082 đã qua `xlsxSafe`. Vá: dùng chung `xlsxSafe`.
- **P2 — bộ lọc Own của phiếu lương rơi mất khi owner rỗng.** `PayrollPayslipsRepository.selectPayslips` dùng
  truthy-guard trên `opts.ownerUserId` (vắng ⇒ SQL rỗng) ⇒ chuỗi rỗng hoặc `undefined` biến 031/032/084 thành đọc
  toàn công ty. Đúng lớp lỗi BE-4B đã vá cho tạm ứng (`ownCond`). Hiện được `resolveActor` che phía trước — vá vẫn
  cần (phòng thủ chiều sâu, cùng khuôn).

**Đính chính giả định của backlog:** NOTI-027 dedupe theo **`periodId`**, không theo `batchId` — CỐ Ý (SPEC-11
dòng 1409: khoá theo đợt ⇒ nhiều thông báo «đã chi» cho một kỳ). Đột biến (k) vì vậy là «đổi khoá sang
batchId phải ĐỎ»; int-spec be4-budgets-import:643 đã ghim, thiếu ca unit không cần DB ⇒ thêm.

**T5 (gắn/gỡ dòng chi 069 ở FE) KHÔNG test được:** `apps/app` chưa gọi `updatePaymentBatch` ở đâu cả, và BE không
có đường «gỡ đánh dấu đã chi» (`line-already-paid`). Đây là tính năng thiếu của FE-3, không phải ca test ⇒ tách WO
nợ `S15-PAYROLL-FE-6` (UI + spec T5), ghi lệch done_when.

## 1. Lane (file đích rời nhau · DB lane riêng)

| Lane | Ai                        | DB                | File đích                                                                                                                                                                                    | Khoảng trống          |
| ---- | ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A    | phiên chính (Opus)        | `mediaos_s15qa1`  | `s15-payroll-qa1-roles.int-spec.ts` · `s15-payroll-qa1-pair-matrix.int-spec.ts` · helper `test/helpers/payroll-qa1-routes.ts` (chỉ dữ liệu, KHÔNG `getHttpServer`) · census 2 tầng · P1 · P2 | G1–G4 · G13 · P1 · P2 |
| B    | qa-test-engineer (Sonnet) | `mediaos_s15qa1b` | `s15-payroll-qa1-idor-leak.int-spec.ts`                                                                                                                                                      | G5–G7                 |
| C    | qa-test-engineer (Sonnet) | `mediaos_s15qa1c` | `s15-payroll-qa1-race-fsm.int-spec.ts` · tách `s15-payroll-be4-batches*.int-spec.ts` · `payroll-fsm.spec.ts`                                                                                 | G8 · G9 · G12 · G15a  |
| D    | qa-test-engineer (Sonnet) | `mediaos_s15qa1d` | `s15-payroll-qa1-arith-formula.int-spec.ts` · `formula.evaluator.spec.ts` · unit NOTI registrar                                                                                              | G10 · G11 · (k)       |
| E    | frontend-builder (Sonnet) | —                 | `apps/app/src/routes/payroll/payroll-qa1-disbursement-gates.spec.tsx`                                                                                                                        | G14                   |

Luật chung mọi lane: mỗi ca DENY có ca ALLOW song sinh assert **mã chính xác** (`=== 200/201`, không
`.not.toBe(403)`); mỗi file tự boot app (`init` + `listen(0)` + `close`); helper không chạm `getHttpServer`;
fixture giả-secret qua `loginPasswordFixture`; không `.skip/.only`/`eslint-disable`/`@ts-ignore`/catch rỗng;
file ≤ 800 dòng; không đổi `companies.name`; đọc log lượt XANH tìm `-> 5xx`. Lane KHÔNG chạy lệnh git đổi trạng
thái và KHÔNG sửa `src/` (trừ file ghi ở bảng) — lỗi sản phẩm lộ ra: giữ ca đỏ + báo về phiên chính.
`apps/api/package.json` (`test:cov:payroll`) do phiên chính sửa.

## 2. Cổng đóng WO

1. Từng lane xanh trên DB lane riêng; phiên chính chạy lại toàn bộ file mới trên `mediaos_s15qa1`.
2. `test:cov:payroll` (thêm file mới + 4 spec be2) ⇒ `src/payroll/**` ≥ 85 %, `formula/**` ≥ 95 % (đo, ghi §3).
3. `bash harness/check.sh --lane-db=s15qa1` xanh KHÔNG banner.
4. App: `npx vitest run --shard=i/4` ×4 xanh.
5. LIGHT gate + security-reviewer hẹp trên P2.
6. `docs/TESTABLE-FEATURES.md` mục PAYROLL v2 · `docs/QA/evidence/S15-PAYROLL-QA-1-ACCEPTANCE.md` · backlog notes +
   WO nợ FE-6.

## 3. Bằng chứng

_(điền khi đóng)_
