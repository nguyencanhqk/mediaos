# S10-QA-ROUTEHTTP-3 — Đóng KI-025: phủ HTTP phần đuôi risk≤3

> **Trạng thái:** XONG 2026-08-25 · nhánh `wo/s10-qa-routehttp-3` · zone `yellow` · LIGHT gate
> **Nguồn sự thật của mọi con số dưới đây:** `apps/api/test/foundation/route-http-coverage.e2e-spec.ts`
> (console log của ca "IN BẢNG"). Không con số nào ở tài liệu này là ước lượng.

---

## 1. Bước 1 — ĐO LẠI (bắt buộc trước mọi kết luận)

Chạy trên `master 90d26aee`, ngày 25/08/2026:

| Mốc                          | Tổng route | Đã phủ          | Chưa phủ | risk≥5 chưa phủ |
| ---------------------------- | ---------- | --------------- | -------- | --------------- |
| 14/08 (`S10-QA-ROUTEHTTP-1`) | 499        | 370 (74,1%)     | 129      | 12              |
| 18/08 (`S10-QA-ROUTEHTTP-2`) | 499        | 383 (76,8%)     | 116      | 0               |
| **25/08 — thước đo CŨ**      | 500        | 386 (77,2%)     | 114      | 0               |
| **25/08 — thước đo ĐÃ VÁ**   | 500        | **382 (76,4%)** | **118**  | 0               |
| **25/08 — sau WO này**       | 500        | **500 (100%)**  | **0**    | 0               |

Phân bố phần đuôi trước khi làm (thước đo cũ): risk=3 → 7 · risk=2 → 65 · risk=1 → 3 · risk=0 → 39.

**Điểm xuất phát ĐÚNG là 382/500, không phải 386/500.** Lý do ở §2.

---

## 2. Phát hiện lớn nhất của WO này: CHÍNH THƯỚC ĐO SAI — ba lớp

WO yêu cầu "đo lại, không chép số". Việc đo lại làm lộ ra rằng con số 383/499 từng dùng để lập luận
về KI-025 **được sinh bởi một phép đo có ba khuyết tật**. Cả ba đều được vá trong cùng PR này.

### (1) DƯƠNG-TÍNH-GIẢ — chiều NGUY HIỂM · 7 route

Census quét file trên **ĐĨA**; vitest chạy theo **DANH SÁCH** của nó. Sáu spec nằm trong
`test.exclude` của `apps/api/vitest.config.ts` (module park de-media-fy / hoãn theo Phase) vẫn được
tính là bằng chứng. Hệ quả đo được: **7 route của `WorkflowController`** mang dấu `covered` bằng
những lượt HTTP **chưa từng xảy ra**, nguồn duy nhất là `test/workflow-lifecycle.e2e-spec.ts`:

```
POST   /workflow/start
POST   /workflow/steps/:stepId/start
POST   /workflow/steps/:stepId/submit
POST   /workflow/approval-requests/:requestId/approve
POST   /workflow/approval-requests/:requestId/request-revision
GET    /workflow/:instanceId
GET    /workflow/approval-requests
```

Đây là sai đúng chiều mà chính docstring của file cảnh báo: **giấu khoảng trống thay vì lộ ra**.

**Vá:** `VITEST_EXCLUDED_SPECS` + `isVitestExcluded()` thêm vào `isHttpTestFile()`.

### (2) ÂM-TÍNH-GIẢ — biểu thức trong `${...}` · 3 route

`PATH_LITERAL_RE` gộp `$`/`{`/`}` vào **cùng lớp ký tự** với phần path, nên literal chỉ khớp khi mọi
ký tự bên trong `${...}` cũng thuộc lớp đó. Một dấu `!` (`${pending!.id}`), `[`, `(`, dấu phẩy hay
khoảng trắng là **đủ để cả literal không khớp gì cả**.

**Vá:** tách `\$\{[^{}]*\}` thành một nhánh riêng — trong ngoặc cho phép mọi ký tự.

### (3) ÂM-TÍNH-GIẢ + CODE CHẾT — query-string · 3 route

Lớp ký tự thiếu `?`, nên **mọi** literal dạng `` `/attendance/reports/team?${q}` `` bị bỏ. Hệ quả kín
tiếng hơn: dòng `literal.split("?")[0]` ngay trong `normalizeLiteralPath` — viết ra để cắt query —
**chưa từng chạy một lần nào**, vì regex không bao giờ giao cho nó một literal có `?`.

**Vá:** thêm `?=&%+,` vào lớp ký tự; việc cắt query vẫn do `normalizeLiteralPath` làm (giờ mới thật
sự chạy).

### Chống tái sinh + RED-proof

Cả ba lớp đều là kiểu **làm `pathLiterals` THIẾU phần tử** — mà thiếu thì route chỉ bị đếm "chưa phủ",
im lặng, không assert nào sập. Nên thêm 4 ca gọi **thẳng** `extractEvidence`/`isHttpTestFile` trên
chuỗi dựng sẵn, cộng 1 ca **đọc `vitest.config.ts` thật** rồi so hai danh sách exclude (ghim ĐỊNH
NGHĨA, không ghim tên — bài học `index-ratchet-must-pin-definition-not-name`).

Gieo lại từng lỗi cũ để chứng minh cổng cắn — **3/3 ĐỎ đúng ca tương ứng**:

| Mutation | Gieo lại                              | Ca ĐỎ                                              |
| -------- | ------------------------------------- | -------------------------------------------------- |
| MUT-A    | bỏ `?=&%+,` khỏi lớp ký tự            | `tự-kiểm regex: … QUERY-STRING` + RATCHET          |
| MUT-B    | gộp `${}` về cùng lớp ký tự           | `tự-kiểm regex: … ${expr} chứa ký tự lạ` + RATCHET |
| MUT-C    | gỡ 1 tên khỏi `VITEST_EXCLUDED_SPECS` | `tự-kiểm exclude: … KHỚP test.exclude`             |

---

## 3. Công việc phủ — 7 file · 105 ca · 118 route

| File `test/integration/routehttp3-*` | Cụm                                                                       | Route |
| ------------------------------------ | ------------------------------------------------------------------------- | ----- |
| `workflow-template.int-spec.ts`      | `WorkflowTemplatesController` + `apply`                                   | 18    |
| `workflow-instance.int-spec.ts`      | `WorkflowController` (gồm 7 route của §2.1)                               | 12    |
| `org-masterdata.int-spec.ts`         | org · positions · hr-departments · master-data · lookups                  | 31    |
| `tasks-goals.int-spec.ts`            | labels · states · task-templates · task-checklist · goals                 | 15    |
| `attendance-leave.int-spec.ts`       | attendance (14) + leave (4)                                               | 18    |
| `foundation-settings.int-spec.ts`    | api-keys · users/me · company · files · holidays · settings · SSO         | 15    |
| `hr-employee.int-spec.ts`            | employees · recycle-bin · link-user · contracts · import · PCR · approval | 11    |

**Bar chất lượng áp cho mọi cụm** (không phải "gọi cho đủ 200"):

- mỗi route GHI có ca **ALLOW 2xx chứng minh bằng HỆ QUẢ đọc lại** qua route ĐỌC của cùng tài nguyên
  — không assert theo status code;
- mỗi route ĐỌC chứng minh bằng **dữ liệu VỪA GIEO xuất hiện** trong kết quả;
- ca **DENY 403 (role RỖNG)** đặt **SAU** ALLOW, nên 403 không thể xanh vì route chết
  (`deny-cases-vacuous-without-allow-case`);
- ca **DTO 400 ở BIÊN** cho mỗi cụm — chứng minh `ZodValidationPipe` thật sự chạy trên đường đó;
- ca **cross-tenant** có **cạnh đối chứng**: cùng token B làm được việc đó trên tài nguyên của CHÍNH
  nó ⇒ 404 ở trên là cô lập, không phải route chết.

**Actor không phải super-admin** (`superadmin-not-a-canonical-role`); role tự chế mang đúng cặp quyền
controller khai; `is_sensitive` lấy từ **catalog lane DB**, không đoán (khai sai ⇒ `seedPermissionCatalog`
ném, vì `permissions` là catalog TOÀN CỤC `cleanupTenants()` không dọn).

**Vì sao vẫn test module đã PARK.** `content`/`media` ngoài phạm vi sản phẩm và spec của nó đã bị
vitest exclude — nhưng **controller vẫn MOUNT**: 30 route workflow có thật trên app PROD, đi qua guard
chain thật, và đếm vào mẫu số 500. "Park" là _không phát triển tiếp_, không phải _đã gỡ route_. Một
route mounted chưa từng có lượt HTTP nào chính là lớp lỗi KI-065 (route CHẾT mà không ai biết).

---

## 4. Hai BUG THẬT — tách số riêng, KHÔNG vá trong lane QA

Đúng luật đã cho ra KI-068: lane QA ghim + cấp số, không tự vá.

### KI-080 · S3 · `POST /attendance/shift-assignments` → 500 thay vì 400

`createShiftAssignmentSchema` để `assignmentScope` mặc định `"Company"`, và `.refine()` chỉ kiểm
chiều THUẬN. Client gửi `{shiftId, employeeId, effectiveFrom}` — **payload tự nhiên nhất** của "gán ca
này cho nhân viên này" — được Zod cho qua, xuống DB vỡ CHECK `chk_shift_assignments_target`, ra
**500 SYSTEM-ERR-001**. Hỏng ĐÚNG CHIỀU AN TOÀN (0 hàng ghi, đã chứng minh bằng `SELECT`) ⇒ **không
phải lỗ bảo mật**; thiệt hại là hợp đồng API + 500 giả bơm vào giám sát.

### KI-081 · S4 · `GET /leave/types` bỏ sót `annualQuota`

Contract khai `annualQuota` bắt buộc; `POST`/`PATCH` nhận và trả nó; nhưng `toLeaveTypeView()` của
đường ĐỌC chính tắc bỏ sót đúng trường đó ⇒ giá trị ghi được **không đọc lại được** qua route đó.

Cả hai đều có ca `🔴 GHIM BUG` trong `routehttp3-attendance-leave.int-spec.ts`, kèm chỉ dẫn **LẬT**
ca khi vá (không nới assert — `tests-can-pin-a-hole-open`).

---

## 5. Ratchet sau WO

```
MAX_UNCOVERED_TOTAL     = 0     ← CỔNG CHÍNH mới
MAX_UNCOVERED_HIGH_RISK = 0     (giữ — thông điệp lỗi riêng cho nhóm nguy hiểm)
MIN_COVERED_COUNT       = 500   (383 → 500)
```

`MAX_UNCOVERED_TOTAL = 0` nghĩa là: **thêm bất kỳ route nào, ở bất kỳ mức risk nào, mà không kèm test
HTTP thật ⇒ CI ĐỎ ngay tại PR đó.** Thông điệp lỗi in kèm tối đa 20 route thiếu + trỏ tới khuôn
`test/integration/routehttp3-*.int-spec.ts`.

---

## 6. Cách chạy lại

```bash
bash scripts/lane-db-setup.sh routehttp3
export APP_DB_PASSWORD=… WORKER_DB_PASSWORD=… SUPERUSER_DB_PASSWORD=…   # từ .env, ĐỪNG `source .env`
export LANE_DB=mediaos_routehttp3
cd apps/api && npx vitest run test/integration/routehttp3-*.int-spec.ts \
                              test/foundation/route-http-coverage.e2e-spec.ts
```

> `source .env` đầu độc `NODE_ENV` của lượt chạy (`sourcing-dotenv-poisons-test-run-node-env`) — chỉ
> export ĐÚNG ba biến mật khẩu.

---

## 7. Phạm vi KHÔNG làm — khai rõ

- **Không nâng phép đo lên tầng CÂU LỆNH.** Sai số "verb×path ở cấp FILE" vẫn còn, nên 100% vẫn là
  CẬN TRÊN. Sửa nó cần AST thay vì regex — đó là WO riêng, không phải việc của đợt phủ này.
- **Không vá KI-080 / KI-081.** Lane QA ghim + cấp số; hai WO đã seed trong `harness/backlog.mjs`.
- **Không gỡ route của module park.** Quyết định gỡ/giữ `workflow`/`content` khỏi app là việc phạm vi
  sản phẩm, không phải việc của lane test — WO này chỉ chứng minh chúng còn sống và còn đi được.
