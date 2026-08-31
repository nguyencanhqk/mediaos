# S12-RECRUIT-QA-1 — nghiệm thu QA module RECRUIT (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S12-RECRUIT-QA-1`. Nguồn luật: [`SPEC-12 RECRUIT`](../../spec/SPEC-12%20RECRUIT.md)
> (§12 mã lỗi · §13 FSM · ma trận test ở DOC-1) · API-17 (32 route) · DB-14.
> Lane `mediaos_recruitqa1` (dựng mới, chain `0000 → 0562`) · master `18c694ef` + thay đổi của WO này.
> Ngày đo: **2026-08-31**.

Bảng dưới **không nhân bản** nội dung test — nó ánh xạ *luật* → *ca đang canh luật đó*. Ca in đậm =
**MỚI** của WO này; không in đậm = đã có từ `S12-RECRUIT-BE-1`/`DB-1` (không viết lại).

---

## 1. Truy vết luật → ca test

| Nhóm | Ca đang canh | Kết luận |
| --- | --- | --- |
| Deny-path per-pair TỪNG route (A/B cùng request, chỉ đổi chủ thể) | `recruit-be1-scope` A/B (32 route × 15 cặp) | đủ từ BE-1 |
| Census 2 tầng guard theo MÃ cặp, TỪNG route | `recruit-two-layer-guard-census.unit-spec` (runtime `collectRoutes` ≡ 32 route + AST `resolveActor` per `Class#method`) | đủ từ BE-1 |
| **SÀN SCOPE Company** (`companyFloor`) — cặp ĐÚNG nhưng scope hẹp | **`s12-recruit-qa1-permission-matrix` (66 ca)** | **LỖ ĐÃ LẤP** — xem §2 |
| IDOR / cross-tenant 2-tenant thật | `recruit-be1-scope` (404 cả 4 entity) · **`s12-recruit-qa1-error-residue` A (sentinel identity 3 nguồn)** · `s12-recruit-db1-invariants` (RLS) | đủ |
| FSM — mọi chuyển tiếp sai trả đúng RECRUIT-ERR | `recruit-fsm.spec` (100 % ma trận 6×6·4×4·5×5·3×3) · `recruit-be1-fsm` (đường HTTP, cả 014) | đủ từ BE-1 |
| Race double-convert (2 request song song → đúng 1 thắng) | `recruit-be1-convert` (2 khoá khác nhau; FOR UPDATE + UPDATE điều kiện + `uq_candidates_company_employee`) | đủ từ BE-1 |
| Own-scope interviewer deny LẪN allow | `recruit-be1-scope` (feedback 010-vs-011: 3 DENY + 1 ALLOW) · **`permission-matrix` C (4 key miễn sàn @Own)** | đủ |
| Census mã lỗi theo MÃ — không mã nào 0 ca | **`recruit-error-code-census.unit-spec` (43 ca: 15 mã + 27 `kind` + tự-kiểm)** | **LỖ ĐÃ LẤP** — xem §3 |
| Biên idempotency (INVALID_KEY · IN_PROGRESS · KEY_REUSED · cô lập chủ thể/tenant) | **`s12-recruit-qa1-idempotency-scope` (6 ca)** | **LỖ ĐÃ LẤP** — xem §4 |
| fs-pin FE↔BE (bàn giao FE-1) | **`recruit-fsm-parity.spec` (5 ca)** · **`recruit-error-kind-census.spec` (1 ca)** | **LỖ ĐÃ LẤP** — xem §5 |

**Ngoài phạm vi WO này (báo, không làm):** refactor dùng chung `PaginationFooter → packages/ui` +
`error-parser/idempotency helper → web-core` (3 bản copy assets/rooms/recruit) — ghi nhận ở backlog
FE-1, là việc refactor có diện chạm `packages/**` nằm ngoài `paths` WO QA; các gap defer khác của FE-1
(grant foundation-file cho recruiter/hr · org-unit picker) cần WO seed/BE riêng.

---

## 2. Lỗ #1 — sàn scope Company chưa từng có ca HTTP nào

`RecruitAccessService.resolveActor` (`recruit-access.service.ts:43-47`) ép **sàn Company** cho 28/32
route: chủ thể CÓ đúng cặp quyền nhưng `data_scope` hẹp hơn (Own/Department) phải 403 — khác hẳn 403
"thiếu cặp" mà `recruit-be1-scope` đã đo. Cả hai đều là HTTP 403 với `error.code` generic
(`AUTH-ERR-FORBIDDEN` — guard ném `ForbiddenException` chuỗi trần), nên marker phân biệt duy nhất là
chuỗi **`AUTH-ERR-SCOPE-DENIED`** trong `error.message` — spec assert marker này, không chỉ status.

- **A (28 ca):** chủ thể giữ đủ 15 cặp RECRUIT ở scope **Own** → 403 + marker, một ca cho từng route key `companyFloor:true`.
- **B (28 ca):** cùng request/body, chủ thể scope **Company** → không 403 (route đọc = 200 chính xác).
- **C (4 ca):** 4 key miễn sàn (`interviewList` · `interviewDetail` · `interviewFeedbackCreate` · `interviewFeedbackUpdate`) với chủ thể @Own là participant thật → 200/200/201/200.
- **D (3 ca):** chủ thể **Department** (mỗi họ một route) → vẫn 403 — sàn là Company, không phải "≥Own".
- **E (3 ca, chống-rỗng):** bảng 28+4 ≡ đủ 32 key `RECRUIT_ROUTE_PAIRS` (hai chiều) và phân loại A/C khớp đúng cờ `companyFloor` trong nguồn sự thật — route thứ 33 mọc lên chưa phân loại là ĐỎ.

Chi tiết phương pháp: 5 route ghi gác chỉ bằng sàn cần **body hợp lệ Zod** (pipe chạy sau guard tầng-1
nhưng TRƯỚC `resolveActor` trong service) — body rỗng sẽ 400 trước khi chạm sàn ⇒ ca đo trượt mục tiêu.
Đã xác minh `resolveActor` luôn chạy trước mọi lookup DB nên UUID bịa đủ để chứng minh sàn.

---

## 3. Lỗ #2 — census mã lỗi theo MÃ và theo KIND

RECRUIT có đúng bài toán "nhiều biến thể chung một mã" như ROOM: 003 gộp 2 `kind`, 004 gộp 3, 008 gộp 4,
009 gộp 5, 013 gộp 2. Đo 31/08: coverage `src/recruit` đã 93 % mà **15/27 `kind` không có lấy một assert
nhãn** — trong đó 3 nhánh chưa từng có ca runtime nào: `position-invalid` (422, PATCH vị trí với position
đã xoá mềm) · `recruiter-invalid` (**404** chống oracle, không phải 422) · `interview-cancelled`
(feedback vào lượt đã huỷ). Bài học `coverage-high-but-error-code-untested`, tầng kế của nó.

- **`recruit-error-code-census.unit-spec` (cổng tĩnh, 43 ca):** mọi key `RECRUIT_ERR_CODE` được ném ở
  `src/recruit/**` (dạng arg đầu `recruitConflict("KEY"…)`) phải có mã trong bề mặt test; mọi `kind`
  ném qua `recruitDetails("…")` phải có nhãn trong bề mặt test; tự-kiểm 15 mã + 27 kind + chống đọc-trúng-thư-mục-trống.
- **`s12-recruit-qa1-error-residue` (20 ca runtime):** 3 nhánh 0-ca ở trên (mỗi ca kèm ALLOW đối chứng) +
  **sentinel identity** RECRUIT-ERR-010 (ghost · cross-tenant · soft-deleted trả shape **giống hệt nhau
  từng byte** — riêng `interviews`/`offers` không có cột `deleted_at` theo thiết kế nên chỉ 2 nguồn,
  ghi chú tường minh) + **note-của-người-khác** (PATCH note người khác = sentinel y hệt ghost — không
  oracle) + **check-duplicate** (khớp email không phân hoa/thường · phone chuẩn hoá · response không bao
  giờ lộ email/phone đã lưu) + **11 ca pin nhãn `kind`** cho các nhánh đã có ca theo MÃ nhưng chưa ai
  neo NHÃN (mục G — khuôn room-residue F).

---

## 4. Lỗ #3 — biên của `@Idempotent()` trên đường RECRUIT

`recruit-be1-idempotency-audit` đã phủ replay 4 route (`POST /candidates` · `/interviews` · `/offers` ·
`/candidates/:id/convert`). `s12-recruit-qa1-idempotency-scope` (6 ca, 2-tenant thật) bổ phần biên:

| Ca | Đo gì | Ghi chú phương pháp |
| --- | --- | --- |
| `INVALID_KEY` | khoá dài MAX+1 ⇒ 409 **và 0 hàng sinh ra** (đếm qua `direct.query`); khoá đúng MAX ⇒ 201 +1 hàng | vế "0 hàng" chứng minh interceptor chặn TRƯỚC handler |
| `IN_PROGRESS` | bấm-đúp convert ⇒ 409 IN_PROGRESS, **không** phải RECRUIT-ERR-008 | **tất định, không đua**: tx pool owner giữ `FOR UPDATE` đúng hàng candidate mà `findForConvertTx` sẽ khoá ⇒ request #1 treo trong handler, #2 chắc chắn gặp in-flight; sau rollback đúng 1 `employee_profiles` |
| khác **người gọi**, cùng chuỗi khoá | mỗi bên chạy nghiệp vụ của mình, không header phát lại | khoá băm gồm `companyId+userId` |
| khác **công ty**, cùng chuỗi khoá | tenant B chạy THẬT — BẤT BIẾN #1 xuyên qua cache idempotency | thiếu vế này thì 2 tenant đọc được phản hồi của nhau qua đường cache |
| handler LỖI ⇒ nhả khoá | 404 → retry cùng khoá chạy thật → đổi payload ⇒ `KEY_REUSED` | lỗi không được cache |
| không gửi header | 2 lần POST không header ⇒ 2 hàng độc lập | `@Idempotent()` là opt-in — vế "chạy bình thường" chưa từng có ca |

---

## 5. fs-pin FE↔BE (bàn giao từ FE-1 review gate)

`apps/app` không import được `apps/api` nên FE **copy literal** 4 bảng FSM và danh sách `kind` — drift
là xanh-câm ở cả hai lưới cũ. Hai spec mới đọc NGUỒN cả hai phía bằng `fs` (idiom `recruit-wiring.spec.ts`:
census-size guard chống regex mù · trích block bằng mốc đầu/cuối · so tập hai chiều):

- **`recruit-fsm-parity.spec` (5 ca):** 4 bảng `*_EDGES` FE ≡ BE **từng ô** (6/4/5/3 trạng thái, đúng cả
  thứ tự); riêng ngữ nghĩa `Hired`: bảng BE giữ cạnh `Offer→Hired` (đường convert, mã 014) trong khi
  `availableStageMoveTargets` FE phải lọc `Hired` khỏi **mọi** đích move.
- **`recruit-error-kind-census.spec` (1 ca):** grep `recruitDetails("…")` toàn `apps/api/src/recruit`
  ≡ `RECRUIT_ERROR_KINDS` (27) hai chiều — BE thêm kind mà FE quên mirror ⇒ ĐỎ (hết cảnh rơi câm về
  `errors.generic`); FE khai kind BE đã gỡ ⇒ ĐỎ (mã chết).

---

## 6. Coverage

Lệnh tái lập (đã thêm `test:cov:recruit` vào `apps/api/package.json`):

```bash
bash scripts/lane-db-setup.sh recruitqa1   # hoặc bash harness/check.sh --lane-db=recruitqa1
export LANE_DB=mediaos_recruitqa1
pnpm --filter @mediaos/api test:cov:recruit
```

| Chỉ số | Đo được | Ngưỡng WO |
| --- | --- | --- |
| Statements | **93.61 %** (2902/3100) | ≥ 80 % |
| Branches | **82.13 %** (547/666) | ≥ 80 % |
| Functions | **94.97 %** (170/179) | ≥ 80 % |
| Lines | **93.61 %** | ≥ 80 % |

Như ASSET/ROOM: **KHÔNG** cắm `thresholds` cho `src/recruit/**` vào `vitest.config.ts` — phần lớn con số
do int-spec `describe.skipIf(!hasLaneDb)` sinh ra, lần chạy không có DB sẽ đọc ~0 % và ĐỎ GIẢ. Bằng
chứng là **lệnh tái lập + con số ở đây**. Phần chưa phủ còn lại chủ yếu là các nhánh lost-race chỉ chạm
được dưới concurrency thật (`candidates.service:226` · `offers.service:130,165` · `interviews.service:215,251`)
và nhánh log silent-failure — đã có race test cho các đường unique chính (convert · offer-open · feedback).

---

## 7. Tổng kết lượt chạy

| Bộ | Tệp | Ca |
| --- | --- | --- |
| MỚI — sàn scope per-route | `test/integration/s12-recruit-qa1-permission-matrix.int-spec.ts` | 66 |
| MỚI — biên idempotency + cô lập chủ thể/tenant | `test/integration/s12-recruit-qa1-idempotency-scope.int-spec.ts` | 6 |
| MỚI — mã lỗi/kind còn sót + sentinel + pin nhãn | `test/integration/s12-recruit-qa1-error-residue.int-spec.ts` | 20 |
| MỚI — census mã lỗi + kind (cổng tĩnh) | `test/foundation/recruit-error-code-census.unit-spec.ts` | 43 |
| **Cộng mới BE** | | **135** |
| MỚI — fs-pin FE (parity FSM + census kind) | `apps/app/src/routes/recruit/recruit-fsm-parity.spec.ts` · `recruit-error-kind-census.spec.ts` | 6 |
| Cụm RECRUIT đầy đủ BE (unit + int, có `LANE_DB`, gồm DB-1 invariants) | 15 tệp | **327** |
| FE RECRUIT (`apps/app/src/routes/recruit`) | 6 tệp | **108** |

Toàn bộ chạy trên lane cô lập `mediaos_recruitqa1` — **không** có banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
Không phát hiện bug sản phẩm nào: sàn scope, idempotency và các nhánh lỗi đều xử đúng ngay lần đo
có-cấu-trúc đầu tiên; hai điểm "trông như bug" đã xác minh là thiết kế (`recruiter-invalid` trả 404
chống oracle · `interviews`/`offers` không có `deleted_at`).

---

## 8. Phát hiện phụ — assert flaky tiềm ẩn trong DB-1 (đã vá tại đây)

Full-suite làm lộ ca **H1 của `s12-recruit-db1-invariants`** (đã merge từ DB-1) đỏ tất định sau churn
dữ liệu của bộ QA-1: vế app-role ghim **TÊN** index (`toContain("idx_candidates_company_email_expr")`)
trong khi dưới FORCE RLS `lower()`/`regexp_replace()` **không leakproof** ⇒ biểu thức nằm ở `Filter`,
mọi index tiền tố `company_id` là access path **tương đương** và planner cost-pick theo stats — đo được
nó đổi sang `Bitmap Index Scan on candidates_company_id_id_uq` (bẫy `pg-planner-index-assert-trap`
đúng nghĩa đen; chính docblock của H1 đã mô tả cơ chế nhưng assert vẫn ghim tên). Vá đúng tầng bằng
chứng: vế app-role giờ assert **không `Seq Scan`** + **`Index Cond: (company_id = …)`** (điều duy nhất
đảm bảo được); vế parity biểu-thức-từng-ký-tự vẫn đo tất định ở owner (phần 1, không đổi). Không phải
bug sản phẩm — check-duplicate vẫn đi index; chỉ là assert đo thứ planner không hứa.
