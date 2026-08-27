# S10-FND-PARAMUUID-3 — KI-078 đợt 2: 42 tham số `:id`/`*Id` của mảng HR/tổ chức

> 🟡 LIGHT gate (`typescript-reviewer` + `quality-gate`). Không chạm permission/RLS/secret/audit/migration.
> Nối tiếp `S10-FND-PARAMUUID-2` (đợt 1, PR #425 đã land master `e47a36f5`).

---

## §1. SỐ ĐO SỐNG (đo lại, KHÔNG chép từ seed)

Chạy chính `apps/api/test/foundation/param-uuid-census.ts` trên `master@e47a36f5`:

```
ID_LIKE=298 · PIPED=108 · UNPIPED=190
```

Phân bố 190 chỗ unpiped:

| module | unpiped | trong phạm vi? |
| --- | ---: | --- |
| `tasks/` | 75 | ✅ SPEC-06 |
| `workflow/` | 36 | ⛔ **PARK — out-of-scope** (xem §2) |
| `employees/` | 21 | ✅ SPEC-03 |
| `goals/` | 21 | ✅ |
| `org/` | 18 | ✅ SPEC-03 |
| `foundation/` ngoài `files/` | 8 | ✅ |
| `notifications/` | 6 | ✅ SPEC-08 |
| `positions/` | 3 | ✅ SPEC-03 |
| `recycle-bin/` | 1 | ✅ |
| `auth/` | 1 | ⛔ đã ký `skipped` ở đợt 1 — KHÔNG đụng lại |

---

## §2. PHÁT HIỆN CHẶN — `workflow/` 36 tham số là CODE ĐÃ PARK, không phải nợ cần vá

Seed của WO đề xuất `workflow/` (36) làm ứng viên đợt 2. **Sai** — đây là code hướng cũ đang chờ DỌN:

| Bằng chứng | Nguồn |
| --- | --- |
| `De-media-fy giữ nguyên: media·finance·SaaS·workflow-DAG·payroll·mobile = OUT-OF-SCOPE` | `harness/backlog.mjs:26` |
| `kpi/evaluation/meeting/workflow (workflow.ts/approval.ts engine)` nằm ở **§A5 "Code CÒN bảng HƯỚNG CŨ — out-of-scope, cần DỌN"** | `docs/erd-current.md:457` |
| `workflow.repository.ts` join thẳng `contentItems` + `projects` (bảng **media**) | `apps/api/src/workflow/workflow.repository.ts:10-12` |
| `workflowDefinitions` · `defects` định nghĩa ở `db/schema/workflow.ts` (bảng A5) | `apps/api/src/db/schema/workflow.ts:55,680` |
| Test của module này **đã bị xoá/exclude** với lý do de-media-fy | `harness/backlog.mjs:645,658` |
| **0 hộ tiêu thụ FE** — grep `/workflow/` trên `apps/app` · `apps/console` · `apps/auth` · `packages/web-core` = rỗng; mọi hit "workflow" ở FE chỉ là **chữ trong comment** về profile-change-request | §7 |

⇒ **QUYẾT ĐỊNH: không đụng `workflow/`.** Vá 36 tham số ở đó là đổ công vào code chờ xoá, và
`getWorkflowByContent:contentItemId` khoá thẳng vào bảng media `content_items`
([[write-only-column-means-delete-not-wire-up]] — hướng vá do `docs/DB` quyết, không do sự tồn tại của route).

⚠️ **Hệ quả về SỐ:** nợ THẬT trong phạm vi là **153**, không phải 189 (190 − 36 `workflow/` − 1 `auth/`).
Bảng phân bố ở seed WO trộn code sống với code park — cùng lớp sai số đo với vụ `tasks 71→75`
([[wo-seed-hand-measurements-can-be-incomplete]]). Sửa số này ở RELEASE-02 + `notes` của WO.

⚠️ **Không ký 36 dòng verdict `skipped`.** Luật của chính sổ đòi cột `before` là số ĐO ĐƯỢC bằng HTTP
(cấm ghi "suy ra") ⇒ ký `skipped` vẫn buộc dựng fixture media/content để đo 36 route sắp xoá. Ghi phát
hiện + seed WO dọn riêng thay vì thế.

---

## §3. NHÓM ĐỢT 2 — 42 tham số, tiêu chí rủi ro

**Tiêu chí:** _dữ liệu nhân sự nhạy cảm (SPEC-03) · có workflow phê duyệt · route GHI · trong phạm vi._

| lane | file | unpiped | ghi chú rủi ro |
| --- | --- | ---: | --- |
| **L1-EMP** | `employees/employees.controller.ts` | 3 | `@Controller("employees")` — CRUD hồ sơ |
| | `employees/hr-read.controller.ts` | 1 | `GET /hr/employees/:id` |
| | `employees/profile-change-request.controller.ts` | 4 | **FSM phê duyệt** approve/reject/cancel |
| **L2-EMPDOC** | `employees/contract.controller.ts` | 5 | hợp đồng lao động |
| | `employees/employee-file.controller.ts` | 8 | `:id` ở CẤP CLASS + `:fileId` |
| **L3-ORG** | `org/org.controller.ts` | 9 | org_units + teams + `:userId` |
| | `org/hr-department.controller.ts` | 3 | |
| | `org/hr-master-data.controller.ts` | 6 | **có cột `code`** |
| | `positions/positions.controller.ts` | 3 | **có cột `code`** |
| | | **42** | |

**CÒN NỢ sau đợt này (in-scope):** `tasks/` 75 · `goals/` 21 · `foundation/`-ngoài-files 8 ·
`notifications/` 6 · `recycle-bin/` 1 = **111**. Cộng `workflow/` 36 (park) + `auth/` 1 (skipped) ⇒ trần **148**.

---

## §4. RỦI RO "`:id` hoá ra là MÃ NGHIỆP VỤ" — ba bảng phải chứng minh bằng HÀNG THẬT

`job_levels` · `contract_types` · `positions` đều có **`id` uuid PK VÀ cột `code` text riêng**
(`hr-master.ts:28,60` · `positions.ts:13`, cả ba có `*_company_code_active_uq`). Đây đúng tình huống
`leave_types` của đợt 1: nếu `:id` thực ra nhận `code` thì `ParseUUIDPipe` **CHẶN OAN** request hợp lệ,
mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh.

⇒ Mỗi loại khoá phải có **ca ALLOW trên HÀNG THẬT, status 2xx ĐƠN TRỊ**.

**Loại khoá cần ca ALLOW-2xx hàng thật (9):** `employee_profile` · `profile_change_request` ·
`employee_contract` · `employee_file` · `org_unit` · `team` · `job_level` · `contract_type` · `position`.

---

## §5. HỒI QUY ĐỊNH TUYẾN — literal-sibling (liệt kê bằng ĐỌC FILE)

| literal route | cùng cấp với | nguồn |
| --- | --- | --- |
| `GET /hr/employees/summary` | `GET /hr/employees/:id` | `hr-read.controller.ts:53` |
| `GET /hr/employees/export` | `GET /hr/employees/:id` | `hr-read.controller.ts:70` (`@Res()` CSV ⇒ chỉ assert status) |
| `GET /hr/profile-change-requests/me` | `GET /hr/profile-change-requests/:id` | `profile-change-request.controller.ts:65` |
| `GET /org/units/tree` | `PATCH`/`DELETE /org/units/:id` | `org.controller.ts:88` (khác METHOD nên không va, vẫn ghim) |

Ba route còn lại của `hr-read` (`me/profile`, `lookups/*`) KHÔNG cùng cấp với tham số nào được vá ⇒ không kê.

---

## §6. LUẬT ĐO (vi phạm một điều là số đo VÔ GIÁ TRỊ)

Kế thừa nguyên từ đợt 1:

- Guard chạy **TRƯỚC** pipe ⇒ probe không token ra 401 = số 0 đội lốt. Mọi ca dùng actor **đã đăng nhập**.
- Actor **KHÔNG** super-admin ([[superadmin-not-a-canonical-role]]); **KHÔNG** seed `*:*`
  ([[test-fixture-stamps-global-permission-catalog]]). Cặp quyền lấy ĐÚNG catalog thật.
- **Body PHẢI HỢP LỆ** — 400-do-body là số đo GIẢ.
- **TUYỆT ĐỐI KHÔNG** gửi `Idempotency-Key` (interceptor chạy TRƯỚC pipe).
  ⚠️ `employees.controller.ts#createEmployee` có `@Idempotent()` — nhưng đó là `@Post()` **không có `:id`**,
  không nằm trong nhóm vá; ba route `:id` của controller đó KHÔNG mang decorator này.
- DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`. ⛔ Không `expect([400,500]).toContain`.
- ALLOW = oracle loại **CẢ 400 VÀ 500** + ghim status đơn trị đo được.
- Gate cứng `hasDb && LANE_DB` (CLAUDE.md §9.5). Lane DB phát triển: `mediaos_paramuuid3`.
  ⚠️ **KHÔNG `source .env`** ([[sourcing-dotenv-poisons-test-run-node-env]]) — export 3 biến mật khẩu
  + `LANE_DB`, và `unset DATABASE_*_URL` (URL tường minh THẮNG `LANE_DB`).

**Mã trả về ĐÚNG cho ca ALLOW (đọc từ file, không đoán):**
`@Delete` của `positions`/`hr-department`/`hr-master-data`/`org.units`/`org.teams`/`employees` khai
`@HttpCode(204)` ⇒ ALLOW = **204**. `@Post(":id/approve|reject|cancel")` của PCR khai `@HttpCode(200)` ⇒ **200**.
`@Post("contracts/:id/file")` KHÔNG khai ⇒ mặc định Nest **201**. `download` của employee-file là
`res.redirect(302)` ⇒ **302**.

---

## §7. HỘ TIÊU THỤ của đổi 500 → 400 (census ĐỦ TÁM chỗ)

`apps/api/test/**` · `apps/api/src/**/*.spec.ts` · `apps/app/src` · `apps/console/src` · `apps/auth/src` ·
`packages/**` · `scripts/**` · repo `apps/lms` (git riêng). Kết quả ghi ở §L4.

---

## §8. SỔ PHÁN QUYẾT + RATCHET

- Thêm **42 dòng** vào `param-uuid-verdicts.ts` (khoá `file#handler:param`).
- Đổi tên `PARAM_UUID_WAVE1_FILES`/`_SIZE` → khái quát cho nhiều đợt (ratchet ca (5) assert HAI CHIỀU
  + SONG ÁNH nên quên ký một dòng là ĐỎ).
- **HẠ `UNPIPED_CEILING` 190 → 148** (ca (3) là ĐẲNG THỨC ⇒ tự chứng).
- Nới `CLEAN_PREFIXES`: `employees/` · `org/` · `positions/` về 0. ⛔ `auth/` KHÔNG BAO GIỜ.
  ⚠️ `workflow/` KHÔNG vào `CLEAN_PREFIXES` (còn 36 unpiped) — prefix ở đó nghĩa là "bằng 0", không phải "đã xem qua".

---

## §L4. NHẬT KÝ THI CÔNG (27/08/2026)

### §L4.1 — Tiền đề: PR #425 (đợt 1) chưa land

Đầu phiên, `S10-FND-PARAMUUID-2` ở `status: "done"` trong backlog nhưng **PR #425 vẫn OPEN**
(`mergeStateStatus: BLOCKED`, `REVIEW_REQUIRED` — tác giả không self-approve được). Nghĩa là 31 pipe +
sổ phán quyết + trần 190 **chưa có trên master** (master còn ở trần 221).

Nhánh hoá từ master lúc đó sẽ đo trên nền 221 và đẻ conflict ở đúng 3 file dùng chung khi #425
squash-merge ([[squash-merge-breaks-stacked-prs]]). ⇒ Owner uỷ quyền `--admin` cho **riêng #425**, merge
trước (CI đã xanh toàn bộ; thứ duy nhất bị bypass là *yêu cầu có người review*). Master = `e47a36f5`.
Đợt 2 nhánh sạch từ đó, không stack.

### §L4.2 — Census sống, không chép số

`ID_LIKE=298 · PIPED=108 · UNPIPED=190` — khớp seed. Nhưng **phân bố thì KHÔNG dùng được như seed viết**:
xem §2, `workflow/` 36 là code park. Nợ thật trong phạm vi trước đợt 2 = **153**.

### §L4.3 — Ba lane, ĐO ĐỎ trước, vá sau

Lane DB `mediaos_paramuuid3` (`scripts/lane-db-setup.sh`, chain-migrate sạch). Mỗi spec chạy RIÊNG
(không song song) nên không có nhiễu chéo outbox/permission-catalog.

| lane | spec | chạy ĐỎ (trước vá) | chạy XANH (sau vá) |
| --- | --- | --- | --- |
| L1-EMP | `employees-param-uuid.int-spec.ts` | **8 fail / 12 pass** (20) | **20/20** |
| L2-EMPDOC | `employee-docs-param-uuid.int-spec.ts` | **13 fail / 11 pass** (24) | **24/24** |
| L3-ORG | `org-param-uuid.int-spec.ts` | **21 fail / 23 pass** (44) | **44/44** |
| | | **42 fail = ĐÚNG 42 ca DENY** | **88/88** |

**Số đo mỗi ca DENY, không có ngoại lệ nào:**

```
HTTP 500 · {"code":"SYSTEM-ERR-001","message":"Lỗi hệ thống","type":"Error"}
```

⇒ Giả thuyết "id-like unpiped ⇒ 500" ĐÚNG cho cả 42 chỗ của nhóm này. Ghi rõ: đó là **kết quả đo**,
không phải lý do để đợt sau bỏ bước đo — đợt 1 có phản-ví-dụ `auth-session` = 404.

**46/46 ca ALLOW-2xx trên HÀNG THẬT XANH NGAY Ở LẦN CHẠY ĐỎ.** Đây là vế quan trọng nhất và nó xanh
TRƯỚC khi có pipe, tức nó đo tính chất của DỮ LIỆU chứ không phải của bản vá: mọi `:id` trong nhóm
thật sự là khoá UUID. Riêng `job_levels`/`contract_types`/`positions` — ba bảng vừa có `id` uuid vừa có
cột `code` — đây là bằng chứng duy nhất bác bỏ khả năng "đếm oan" mà `param-uuid-census.ts:36-40` tự
cảnh báo.

### §L4.4 — Hai bẫy gặp thật khi thi công

**(1) `perl` thay `@Param` hàng loạt sửa NHẦM một dòng COMMENT.**
`profile-change-request.controller.ts` có một comment giải thích bug `@UsePipes`+`@Param` (một bug
KHÁC) và trong đó có chuỗi `` `@Param("id")` ``. Perl thay luôn ⇒ comment nói sai về lịch sử của chính
nó. `grep -c '@Param("id", ParseUUIDPipe)'` trả **5** trong khi census chỉ có **4** site — chính chênh
lệch đó lộ ra vụ này. ⇒ Sau mỗi lần thay hàng loạt phải soi `git diff -U0` TỪNG DÒNG, đừng tin số của
`grep -c` ([[guard-immutability-matches-comments]]).
Cũng kiểm luôn double-encode UTF-8 ([[perl-edit-double-encodes-utf8-comments]]): diff đếm được đúng
12 insert / 9 delete = 3 import + 8 param + 1 comment ⇒ không dòng tiếng Việt nào bị hỏng ngầm.

**(2) Fixture `org_units.type = 'Department'` vỡ CHECK.** Giá trị hợp lệ là CHỮ THƯỜNG
(`org.ts:42` — `department|division|unit|office|branch`). Nó làm **5 ca ALLOW** đỏ với thông điệp
`violates check constraint` — đỏ vì FIXTURE, không phải vì tham số. Sửa fixture; **không** nới assert.
Sau khi sửa, số fail tụt đúng về 21 = đúng số ca DENY của lane.

### §L4.5 — Hộ tiêu thụ của đổi 500 → 400 (census ĐỦ TÁM chỗ)

| # | chỗ | kết quả |
| --- | --- | --- |
| 1 | `apps/api/test/**` | không spec nào ghim 500 cho `:id` rác trên route được vá |
| 2 | `apps/api/src/**/*.spec.ts` | như trên (mọi `toBe(400)` tìm thấy là của body/query, không phải param) |
| 3 | `apps/app/src` | mọi call-site truyền id lấy từ response server |
| 4 | `apps/console/src` | `employees-api.ts` — id từ danh sách |
| 5 | `apps/auth/src` | 0 hit |
| 6 | `packages/**` | `web-core` (`hr-api` · `contracts-api` · `employee-file-api` · `employee-avatar-api`) — id từ response |
| 7 | `scripts/**` | chỉ `/hr/employees?page=…` (route tập hợp, không có `:id`) |
| 8 | repo `apps/lms` (git riêng) | 0 hit |

⇒ **0 hộ tiêu thụ gửi `:id` phi-UUID.** Đổi 500→400 không gãy hộ nào.

### §L4.6 — Ratchet: kiểm chứng bằng ĐỘT BIẾN, không bằng "xanh"

`UNPIPED_CEILING` 190 → **148**; `CLEAN_PREFIXES` nới 10 → 13 (`employees/` · `org/` · `positions/`);
sổ phán quyết 32 → **74 dòng** (73 `piped` + 1 `skipped`); hằng đổi tên `PARAM_UUID_WAVE1_*` →
`PARAM_UUID_MEASURED_*`.

Ratchet 5/5 xanh — nhưng "xanh" chưa chứng minh nó bắt được gì. Ba đột biến trên **dữ liệu ĐỢT 2**:

| # | đột biến | kết quả |
| --- | --- | --- |
| 1 | gỡ pipe của `positions#updatePosition` | **4/5 ca ĐỎ** (1 · 2 · 3 · 5) |
| 2 | xoá dòng verdict `positions#deletePosition:id` (code vẫn có pipe) | **1 ca ĐỎ** — ca (5), "thiếu dòng" |
| 3 | lật verdict `piped` → `skipped` khi code VẪN có pipe | **1 ca ĐỎ** — ca (5), đúng CHIỀU NGƯỢC của assert hai chiều |

Đột biến 3 là cái đáng tiền: nó chứng minh vế `decision==='skipped' ⟹ hasPipe===false` thật sự chạy
trên dòng mới, chứ không chỉ trên dòng `auth` duy nhất của đợt 1.

### §L4.7 — `CLEAN_PREFIXES` ≠ `PARAM_UUID_MEASURED_FILES` (đừng đồng bộ cho gọn)

Prefix `employees/` về 0 nhờ **hai nguồn không tương đương**: 21 site được ĐO + vá ở WO này, và **7
site** của `hr-write.controller.ts` + `hr-employee-avatar.controller.ts` vốn ĐÃ có pipe từ trước mà
**chưa ai đo bằng HTTP**. Hai file đó vì thế KHÔNG vào `PARAM_UUID_MEASURED_FILES` (thêm vào là tuyên
bố sai: "tôi đã đo mọi `:id` của file này"). Đã ghi chú tại chỗ trong cả hai file để đợt sau không
"dọn dẹp" bằng cách hợp nhất hai danh sách.

### §L4.8 — Số cuối

```
TRƯỚC:  ID_LIKE=298 · PIPED=108 · UNPIPED=190
SAU:    ID_LIKE=298 · PIPED=150 · UNPIPED=148
```

Trần 148 KHÔNG phải 148 món nợ:

| thành phần | số | trạng thái |
| --- | ---: | --- |
| TRONG PHẠM VI, chưa đo | **111** | `S10-FND-PARAMUUID-4` (tasks 75 · goals 21 · foundation 8 · notifications 6 · recycle-bin 1) |
| `workflow/` — code PARK | **36** | `S10-CLEAN-WORKFLOWPARK-1` — trần tụt khi DỌN, không phải khi vá |
| `auth/` — đã ký `skipped` | **1** | quyết định có ý thức, KHÔNG đụng lại |
