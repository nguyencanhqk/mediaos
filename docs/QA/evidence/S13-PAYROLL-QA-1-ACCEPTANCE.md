# S13-PAYROLL-QA-1 — nghiệm thu QA module PAYROLL (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S13-PAYROLL-QA-1`. Nguồn luật: [`SPEC-11 PAYROLL`](../../spec/SPEC-11%20PAYROLL.md)
> (§11.1 cặp quyền · §12 mã lỗi · §13.1 FSM · §13.4 công thức · §13.5 sàn scope · §18 audit) · API-18 (35 route) · DB-13.
> Lane `mediaos_payrollqa1` (dựng mới, chain `0000 → 0567`) · master `9e712a66` + thay đổi của WO này.
> Ngày đo: **2026-09-01**.

Bảng dưới **không nhân bản** nội dung test — nó ánh xạ *luật* → *ca đang canh luật đó*. Ca in đậm =
**MỚI** của WO này; không in đậm = đã có từ `S13-PAYROLL-BE-1`/`BE-1B`/`BE-2`/`DB-1` (không viết lại).

---

## 1. Truy vết luật → ca test

| Nhóm | Ca đang canh | Kết luận |
| --- | --- | --- |
| Deny-path per-pair TỪNG route (DENY + ALLOW đối chứng cùng request) | `payroll-be1-scope` A/B/C (18 route) · `payroll-be2-permission` (17 route × 3 = 51 ca) | đủ từ BE-1/BE-2 |
| `hr-manager` canonical sau đợt thu hồi của DB-1 ⇒ 0 cặp PAYROLL | `payroll-be1-scope` D1 (18 route) · `payroll-be2-permission` (17 route) | đủ |
| Census 2 tầng guard theo MÃ cặp, TỪNG route | `payroll-two-layer-guard-census.unit-spec` (8 ca, neo `35` hai chiều) | đủ từ BE-1 |
| **SÀN SCOPE Company (`companyFloor`) — cặp ĐÚNG nhưng scope hẹp, đo TỪNG route** | **`s13-payroll-qa1-scope-floor` (79 ca)** | **LỖ ĐÃ LẤP** — §2 |
| **Cross-tenant 2-tenant trên 17 route của BE-2** | **`s13-payroll-qa1-idor-tenant` A/B/D (26 ca)** | **LỖ ĐÃ LẤP** — §3 |
| **IDOR liên-nhân-sự trên phiếu lương (đọc + GHI + danh sách)** | **`s13-payroll-qa1-idor-tenant` C (5 ca)** | **LỖ ĐÃ LẤP** — §3 |
| Cross-tenant trên 18 route của BE-1 | `payroll-be1-scope` D2/D3/D4/D5 | đủ từ BE-1 |
| FSM — ma trận 7 trạng thái ở tầng HÀM | `payroll-fsm.spec` (100 % ma trận 7×7, suy ngược hằng hai chiều) | đủ từ BE-1 |
| **FSM — CÙNG ma trận ở tầng HTTP, qua 9 route hành động thật** | **`s13-payroll-qa1-fsm-race` A (64 ca)** | **LỖ ĐÃ LẤP** — §4 |
| **Đua ghi: double-submit · double-calculate · double-generate · double-publish** | **`s13-payroll-qa1-fsm-race` B (4 ca)** | **LỖ ĐÃ LẤP** — §4 |
| Tính lại sau `Approved` / mở lại sau khi sinh phiếu | `payroll-be2-lifecycle` D4/D5 · **`fsm-race` C (3 ca, có ALLOW đối chứng cho cờ)** | đủ |
| Census mã lỗi theo MÃ — không mã nào 0 ca | `payroll-error-code-census.unit-spec` (19 ca, cổng hai chiều `PENDING_BE2`) | đủ từ BE-1/BE-2 — xanh, xác nhận lại ở WO này |
| ĐẦU VÀO (mẫu số ngày công · lễ · nửa buổi · biên tháng · đơn di sản) | `payroll-be1-inputs-audit` (24 ca) · `S13-PAYROLL-BE-1B` | đủ |
| **PHÉP TÍNH TIỀN cho trước đầu vào: trần pro-rate · sàn `net` · điểm làm tròn · đơn giá ngày cùng mẫu số · tổng kỳ = SUM(dòng)** | **`s13-payroll-qa1-arithmetic` (9 ca)** | **LỖ ĐÃ LẤP** — §5 |
| Audit-trail lượt XEM/EXPORT dữ liệu lương | `payroll-be1-inputs-audit` D1–D4 · `payroll-be2-noti-audit` AUDIT (5 đường đọc +1 hàng; `/me/payslips*` +0; payload 0 số tiền) | đủ từ BE-1/BE-2 |
| Bất biến DB (RLS · append-only · CHECK cặp vết) | `s13-payroll-db1-invariants` | đủ từ DB-1 |

**Ba lỗi SẢN PHẨM tìm được và đã vá trong CÙNG WO** (không phải lỗi test): §6.

**Ngoài phạm vi WO này (báo, không làm):** script `test:cov` trong `apps/api/package.json` vẫn trỏ vào
`src/workflow` — thư mục đã xoá hẳn; cần một WO dọn riêng (không đụng ở đây vì ngoài diện PAYROLL).

---

## 2. Lỗ #1 — sàn scope Company mới có ca cho 2/32 route

`PayrollAccessService.resolveActor` (`payroll-access.service.ts:56-60`) ép **sàn Company** cho 32/35
route: chủ thể CÓ đúng cặp quyền nhưng `data_scope` hẹp hơn phải 403. Bề mặt cũ đo được đúng **hai**
route (`payroll-be2-permission:378` — `view-line` @Department trên `/lines` và `/summary`); 30 route còn
lại chưa ai chứng minh sàn có thật.

Hai loại 403 **cùng status, cùng `error.code`** (`AUTH-ERR-FORBIDDEN` — service ném `ForbiddenException`
chuỗi trần, `AllExceptionsFilter` chỉ tin `payload.code` khi caller đặt tường minh). Marker phân biệt
duy nhất là chuỗi `AUTH-ERR-SCOPE-DENIED` trong `error.message`, nên **mọi ca DENY assert theo message**,
không theo `error.code` (assert theo code sẽ xanh cả khi route trả nhầm loại 403 — `tests-can-pin-a-hole-open`).

Phép đo: A/B **cùng request, chỉ đổi chủ thể** — `tOwn`/`tDept`/`tCompany` đều giữ ĐỦ 16 cặp có route,
khác nhau đúng `data_scope`. 32 ca DENY (Own) + 32 ca ALLOW đối chứng (Company, đường đọc đòi ĐÚNG 200)
+ 3 ca miễn sàn `/me/payslips*` với chủ phiếu THẬT + 5 ca Department + 4 ca census + 3 ca §6.1.

Neo chống xanh-rỗng: `ROUTES(32) ∪ EXEMPT_KEYS(3)` so **hai chiều** với `PAYROLL_ROUTE_PAIRS(35)`, và
từng key đối chiếu cờ `companyFloor` với chính bảng hằng ⇒ route thứ 36 mọc lên mà quên xếp vào bảng
sẽ làm suite ĐỎ.

---

## 3. Lỗ #2 — cross-tenant chưa chạm route nào của BE-2; IDOR phiếu lương mới có 1 ca

`payroll-be1-scope` D2/D4 đã đo cross-tenant nhưng **chỉ trên 18 route của BE-1**.
`payroll-be2-lifecycle` có dựng company B — nhưng dùng cho kịch bản «công ty 0 nhân sự đủ điều kiện»
(`A5`), **không** assert cross-tenant trên route nào của BE-2.

Ca mới: actor của A giữ đủ 16 cặp @Company bắn id của B trên **20 route có định danh đối tượng** ⇒ 404
`PAYROLL-ERR-010` (KHÔNG 403 — 403 tự nó là oracle "vật này có thật"), + 3 ca so **bằng nhau** ba nguồn
404 (id của B · id bịa · id xoá mềm), + mục D bắn LẠI toàn bộ 12 đường GHI rồi kiểm hàng của B **nguyên
trạng thái, 0 dòng/0 phiếu mới, `note` không dính chuỗi thử** — 404 mà vẫn ghi được là lỗ tệ hơn 200.

IDOR liên-nhân-sự: nhân viên X chỉ giữ 3 cặp Own của khối ME ⇒ `/me/payslips` không chứa phiếu của Y ·
`/me/payslips/{Y}` 404 **bằng** id bịa · `/me/payslips/{Y}/acknowledge` 404 **và** `payslip_acknowledgements`
0 hàng · `/payslips/{X}` **403** (khối ME không phải cửa sau vào cặp `view-payslip`) · ALLOW đối chứng
phiếu của chính X ⇒ 200 rồi 201.

---

## 4. Lỗ #3 — FSM mới được chứng minh ở tầng HÀM, chưa ở tầng ROUTE

`payroll-fsm.spec` phủ 49 ô nhưng là ĐƠN VỊ trên hàm thuần: nó chứng minh `assertPeriodTransition`
đúng, **không** chứng minh 9 route hành động thật sự gọi nó. DB không đỡ giúp: mig `0564` đã DROP
trigger `payroll_period_status_guard`, CHECK chỉ ràng tập giá trị + cặp cột vết
(`check-cannot-enforce-fsm-transitions`).

Ca mới: **9 action × 7 trạng thái = 63 ô** qua đúng route thật. Trước mỗi ô, hàng kỳ được nạp lại về
hình dạng chuẩn của trạng thái đó bằng SQL thoả MỌI CHECK của `0564` (`submitted_pair` · `approved_pair` ·
`published_pair` · `locked_pair` · `calculated_needs_attendance` · `four_eyes` · `generated_pair`).

**THỨ TỰ CỔNG là hợp đồng, không phải chi tiết thi công** — mã kỳ vọng ở ô CẤM tính bằng hàm
`expectedDenyCode(action, from)` theo thứ tự đã đo tại chỗ; đảo thứ tự sẽ giết một mã lỗi:

| Action | Cổng chạy TRƯỚC FSM | Hệ quả ở ô CẤM |
| --- | --- | --- |
| `calculate` | `FROZEN_STATUSES` (`payroll-calc.service.ts:79`) | Approved/Paid/Locked ⇒ **003**, không phải 001 (để FSM bắt trước thì 003 thành mã CHẾT) |
| `reopen` | `assertReopenAllowed` (`payroll-approval.service.ts:253`) | Paid/Locked ⇒ **004** |
| `publish` | `NO_PAYSLIP` (`payroll-payslips.service.ts:140`) | fixture cố ý không sinh phiếu ⇒ **007** ở mọi trạng thái |
| `approve` | four-eyes (`:129`) | im lặng vì fixture đặt `submitted_by` là NGƯỜI KHÁC ⇒ ô cấm hiện đúng **001** |
| `generate-payslips` | nhánh no-op 200 khi `payslips_generated_at` khác NULL | fixture để NULL ⇒ không che ô nào |

Ô CHO assert **không** trả `PAYROLL-ERR-001` (ALLOW đối chứng — thiếu vế này thì một service luôn-409
cũng làm 63 ô xanh). Neo: ma trận đúng 63 ô = 13 CHO + 50 CẤM, suy từ `nextStatus`.

**Cổng có CẮN — đã kiểm bằng vi phạm thật:** gỡ `assertPeriodTransition` khỏi `lock` KHÔNG làm đỏ (vì
`resolveActionTarget` đã chặn sẵn cùng mã — nghĩa là hai cổng chồng nhau, không phải test hỏng); gỡ **cả
hai** cổng (`const to = "Locked"`) ⇒ ma trận ĐỎ ngay ở ô `lock @ Locked`. Mutation đã hoàn nguyên.

Đua ghi (`Promise.all`, HAI chủ thể khác nhau — tránh rate-limit per-user tự bóp chính mình):
double-submit ⇒ đúng 1 lượt 201 + kẻ thua 409 `001`, kỳ dừng ở `Reviewing` · double-calculate ⇒ đúng 1
dòng (ON CONFLICT trúng partial index) · double-generate ⇒ đúng 1 phiếu · double-publish ⇒ đúng 1 lượt
thắng, kỳ dừng ở `Paid`. Mọi lượt < 500. **`await app.listen(0)` ngay sau `app.init()`** là bắt buộc —
supertest tự `listen(0)` rồi tự `close()` khi request ĐẦU về ⇒ `Promise.all` ăn `ECONNRESET`, xanh cục
bộ đỏ CI (`supertest-closes-shared-server-on-first-response`).

---

## 5. Số học — cách làm cho "khớp từng đồng" kiểm được bằng tay

`work_days` phụ thuộc lịch công ty **và** bảng `holidays` (có cả lễ QUỐC GIA `company_id IS NULL` mà
test không sở hữu) ⇒ hằng số chép tay sẽ vỡ khi seed lễ đổi. Cách làm: tính MỘT lượt để **đọc `work_days`
W thật** từ hàng dòng lương, rồi đặt `base_salary = W × 1.000.000` và tính LẠI. Khi đó **đơn giá ngày =
1.000.000 chẵn** và `base_amount = 1.000.000 × (present + unpaid)` — mọi số kỳ vọng viết tay được, đúng
đến từng đồng, **không phụ thuộc tháng nào có mấy ngày lễ**.

| Ca | Đo gì | Kỳ vọng |
| --- | --- | --- |
| `full` | đủ mọi thành phần (2 phụ cấp + thưởng + phạt) | base/allowance/bonus/penalty/deduction/gross/net khớp từng đồng; 0 ngày nghỉ-không-lương ⇒ khấu trừ = ĐÚNG tiền phạt |
| `clamp` | đi làm ĐỦ ngày công | `LEAST(…,1)` ⇒ `base_amount == base_salary`, không vượt |
| `floor` | phạt > gross | `GREATEST(…,0)` ⇒ `net = 0`, không âm |
| `round` | lương lẻ 1đ, không chia hết cho `work_days` | làm tròn 2 chữ số (nửa-lên), sai lệch ≤ 1 xu, không cắt cụt |
| bẫy **trừ HAI LẦN** | gieo 2 ngày nghỉ KHÔNG lương | khấu trừ tăng ĐÚNG `2 × base/work_days` **và** `base_amount` KHÔNG giảm (tử số pro-rate cộng `unpaid` — SPEC-11 §13.4, đính chính owner) |
| đẳng thức | mọi dòng | `net = max(gross − khấu trừ + điều chỉnh, 0)` · `gross = base + phụ cấp + thưởng` |
| tổng kỳ | `GET /payroll-periods/summary` | `totalGross`/`totalNet` = SUM(dòng) đến từng đồng; `headcount` = số dòng |

Phân công có chủ ý: `payroll-be1-inputs-audit` (24 ca) sở hữu **đầu vào**; file này sở hữu **phép tính
tiền cho trước đầu vào**. Không đo lại lẫn nhau.

---

## 6. Ba lỗi SẢN PHẨM tìm được và đã vá trong cùng WO

### 6.1 Route 017 export trả lỗi JSON dưới nhãn XLSX

`@Header("Content-Type", "…spreadsheetml.sheet")` được Nest áp **ngay trước khi gọi handler** — tức
TRƯỚC khi service kịp ném. Mọi lỗi phát từ TRONG handler (403 sàn scope · 404 sentinel · 422
`PAYROLL-ERR-016`) do đó đi ra với **thân JSON của `AllExceptionsFilter` nhưng nhãn XLSX**:
`res.json()` của Express chỉ đặt `application/json` khi Content-Type CHƯA có. Client (và `apiFetch` của
FE) parse theo nhãn ⇒ **mất trắng `error.code`/`error.details`**; người dùng "tải về" một file hỏng chứa
JSON lỗi.

Vô hình với mọi ca chỉ đo `status`: lỗi **401** vẫn đúng nhãn vì guard chạy TRƯỚC bước áp header, và
`payroll-be2-permission:436` đo export nhưng chỉ đo `status`. Lộ ra vì mục A của
`s13-payroll-qa1-scope-floor` đòi đọc `error.message` và nhận về `res.body === {}`.

**Vá:** gỡ `@Header`, đặt Content-Type **ở đường thành công** ngay cạnh `send(buffer)`
(`payroll.controllers.ts`). Ghim bằng 3 ca (mục F): 403 ⇒ JSON + marker · 404 ⇒ JSON + `PAYROLL-ERR-010`
· 200 ⇒ vẫn XLSX + `Content-Disposition: attachment`.

### 6.2 `userId` ngoài phạm vi trên đường TẠO ⇒ 500 vô danh

`mapPayrollPgError` có nhánh cho `23505` (unique) và `23514` (check) nhưng **không có nhánh `23503`
(foreign_key_violation)** ⇒ `POST /salary-profiles` và `POST /bonus-penalties` với `userId` không tồn tại
(hoặc thuộc tenant khác) rơi thẳng thành **500 `SYSTEM-ERR-001`** — đúng thứ mà docblock §8b của chính
file đó gọi là "500 vô danh ở vùng đỏ". Kịch bản thật: người dùng bị xoá giữa lúc mở picker và lúc bấm Lưu.

Chưa cổng nào bắt vì ca ALLOW đối chứng của ma trận quyền chỉ assert `.not.toBe(403)`, mà 500 thoả điều
kiện đó — chính hai dòng log 500 trong lượt chạy đã dẫn tới phát hiện này.

**Vá:** thêm luật 4 vào `mapPayrollPgError` — map theo **TÊN constraint** (đúng luật 1 của file), chỉ ba
FK trỏ tới *nhân sự được chọn* (`salary_profiles_user_id*` · `bonus_penalties_user_id*` ·
`payslips_user_id*`) ⇒ 404 sentinel; FK nội bộ khác vẫn trả `null` (giữ 500) để không che bug server.
Hai nguồn — không tồn tại (`*_user_id_fkey`) và chéo tenant (`*_user_id_company_fk`) — cho **cùng một
phản hồi**, kẻo tên constraint thành oracle tồn tại. RED trước (2 ca đỏ với `SYSTEM-ERR-001`) → GREEN.

### 6.3 Cổng coverage crown-jewel trỏ vào file KHÔNG tồn tại

`apps/api/vitest.config.ts` khai ngưỡng cho `src/payroll/salary-profile.service.ts` (**số ít**) trong
khi file thật tên `salary-profiles.service.ts` (**số nhiều**) ⇒ cổng này **chưa từng đo file nào kể từ
G12**. Cùng lượt đo: 4 khoá `src/workflow/*` trỏ vào module đã **xoá hẳn**. Tổng **5/7 khoá là cổng
CHẾT**. Vitest bỏ qua khoá không khớp file nào **trong im lặng** — không cảnh báo, không đỏ.

**Vá:** sửa tên khoá payroll, gỡ 4 khoá workflow, ghi luật vào docblock (đổi tên file crown-jewel ⇒ phải
sửa khoá trong CÙNG commit), và thêm script `test:cov:payroll` theo khuôn `test:cov:recruit`/`:asset`/`:room`
(module PAYROLL trước đó không có script coverage riêng). Ngưỡng đặt theo **số đo**, không theo ước lượng.

---

## 7. Kết quả đo

| Hạng mục | Số đo |
| --- | --- |
| Tổng ca cụm PAYROLL BE (lane `mediaos_payrollqa1`) | **375** (14 tệp) — trong đó **195 ca MỚI** của WO này |
| ├ sàn scope per-route | **79** (`s13-payroll-qa1-scope-floor`) |
| ├ FSM 9×7 tầng HTTP + đua ghi | **71** (`s13-payroll-qa1-fsm-race`) |
| ├ IDOR + cross-tenant + FK sentinel | **36** (`s13-payroll-qa1-idor-tenant`) |
| └ đối soát số học & biên | **9** (`s13-payroll-qa1-arithmetic`) |
| Ca FE `apps/app/src/routes/payroll` | **70** (5 tệp, từ FE-1) |
| Coverage `src/payroll/**` | **97,05 %** statements · 97,05 % lines · **98,46 %** functions · 81,83 % branches |
| Lệnh tái lập | `bash scripts/lane-db-setup.sh payrollqa1` → `export LANE_DB=mediaos_payrollqa1` → `pnpm --filter @mediaos/api test:cov:payroll` |

Ngưỡng WO (`≥85 %`) đạt trên statements/lines/functions. **Branches 81,83 %** — báo đúng số đo, không
làm tròn lên: phần lớn nhánh hở là `??`/`?.` trong repository (v8 đếm cả nhánh không tới được bằng đường
HTTP). Ngưỡng per-file mới đặt theo số đo thật để **cắn khi hồi quy**, không phải để lấy màu xanh.
