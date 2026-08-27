# S10-FND-PARAMUUID-5 — KI-078 đợt 4 (CUỐI trong phạm vi): 75 tham số `:id`/`*Id` của `tasks/`

> 🟡 LIGHT gate (`typescript-reviewer` + `quality-gate`). Không chạm permission/RLS/secret/audit/migration.
> Nối tiếp `S10-FND-PARAMUUID-4` (đợt 3, `a6706e42`, PR #427 đang mở — WO này STACK lên nhánh đó).

**MỨC ĐỘ — phát biểu TRƯỚC mọi số đo.** Lớp hỏng này hỏng **ĐÚNG CHIỀU AN TOÀN**: `:id` rác vỡ
`22P02` ở Postgres ⇒ **500 SYSTEM-ERR-001**, request vẫn bị TỪ CHỐI, không hàng nào rò, không quyền
nào bị vượt ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị của bản vá là (a) hợp đồng API — client nhận 400 có
mã thay vì 500 vô nghĩa; (b) chấm dứt payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu
500 THẬT. Y hệt KI-068 (kênh BODY) và KI-077.

---

## §1. SỐ ĐO SỐNG (đo lại, KHÔNG chép từ seed)

Chạy chính `apps/api/test/foundation/param-uuid-census.ts` trên `a6706e42`:

```
ID_LIKE=298 · PIPED=186 · UNPIPED=112
```

Trùng ĐÚNG số ghi ở seed WO — không PR nào chen giữa hai đợt. Phân bố 112 chỗ unpiped:

| module      | unpiped | trong phạm vi?                                      |
| ----------- | ------: | --------------------------------------------------- |
| `tasks/`    |      75 | ✅ SPEC-06 — **nhận đợt này, nợ THẬT cuối cùng**    |
| `workflow/` |      36 | ⛔ PARK — out-of-scope (`S10-CLEAN-WORKFLOWPARK-1`) |
| `auth/`     |       1 | ⛔ đã ký `skipped` ở đợt 1 — KHÔNG đụng lại         |

Phân bố 75 chỗ của `tasks/` theo controller (census AST, không đếm tay):

| controller                           | unpiped |
| ------------------------------------ | ------: |
| `tasks/tasks.controller.ts`          |      43 |
| `tasks/projects.controller.ts`       |      13 |
| `tasks/task-files.controller.ts`     |      11 |
| `tasks/labels.controller.ts`         |       4 |
| `tasks/project-states.controller.ts` |       4 |
| **cộng**                             |  **75** |

`tasks/task-attachments.controller.ts` có **0** site id-like ⇒ 5 controller trên là TRỌN module.

---

## §2. TIÊU CHÍ: NHẬN CẢ 75, KHÔNG CHIA NHỎ TIẾP

Seed WO cho phép chia theo controller "nếu thấy quá tải". Đã cân nhắc và **cố ý không chia**, vì
cấu trúc đo của đợt này rẻ hơn hẳn ba đợt trước:

1. **Một BẢNG, hai ORACLE.** Mỗi tham số là một dòng `CASES` mang khoá `file#handler:param`, và mỗi
   dòng chạy HAI lần với `bad` thay vào ĐÚNG vị trí đang đo: `JUNK` → 400 đơn trị; `randomUUID()` →
   oracle loại CẢ 400 VÀ 500. Chi phí viết một tham số ≈ 5 dòng, không phải hai `it()` riêng.
2. **Ba lane vẫn tách theo file** (`tasks-core` 43 · `projects+labels+states` 21 · `task-files` 11)
   nên fixture của mỗi lane vẫn nhỏ và độc lập — cái "quá tải" mà seed lo là fixture, không phải số
   dòng.
3. **Chia đôi `tasks/` không mua được gì.** `CLEAN_PREFIXES` chỉ nhận prefix ĐO ĐƯỢC bằng 0; vá
   43/75 thì tham số `tasks/` thứ 44 vẫn lẻn vào được dưới trần chung — đúng lập luận đã dùng ở
   §2 của plan đợt 3, lần này áp cho chính `tasks/`.

**Cái GIÁ đã khai:** đợt này là WO đắt nhất của chuỗi (fixture phủ 11 loại khoá). Đổi lại nó ĐÓNG
KI-078 thay vì đẩy sang đợt 5.

---

## §3. BA LANE — 75 tham số / 5 controller

| lane            | file                                 | tham số | rủi ro riêng                                                                                                                       |
| --------------- | ------------------------------------ | ------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| **L1-TASKCORE** | `tasks/tasks.controller.ts`          |      43 | 2 route BA tham số (`checklists/:checklistId/items/:itemId`); `/tasks/my` · `/tasks/board` là anh em literal của `@Get(":taskId")` |
| **L2-PROJECT**  | `tasks/projects.controller.ts`       |      13 | `projects` MANG `project_code` ⇒ ứng viên "`:id` là MÃ" (§4.1)                                                                     |
|                 | `tasks/labels.controller.ts`         |       4 | `@Controller()` TRẦN, đường dẫn đầy đủ — không nằm dưới prefix `projects`                                                          |
|                 | `tasks/project-states.controller.ts` |       4 | ↑                                                                                                                                  |
| **L3-TASKFILE** | `tasks/task-files.controller.ts`     |      11 | `DELETE .../files/cover` là anh em LITERAL của `:fileId` (§4.2)                                                                    |

Ba int-spec mới, chép khuôn chín spec của ba đợt trước:

- `apps/api/test/integration/tasks-core-param-uuid.int-spec.ts`
- `apps/api/test/integration/projects-param-uuid.int-spec.ts`
- `apps/api/test/integration/task-files-param-uuid.int-spec.ts`

---

## §4. BỐN RỦI RO PHẢI ĐO, KHÔNG ĐƯỢC SUY

### §4.1 `:id` có thể là MÃ NGHIỆP VỤ — gắn pipe sẽ CHẶN OAN

Đúng lớp đã suýt dính ở `leave_types` (đợt 1), `job_levels`/`positions` (đợt 2), catalog NOTI (đợt 3).
Ứng viên đợt này: **`projects`** — `createTaskProjectSchema` nhận `code` (mã dự án do người dùng đặt)
và DTO trả về mang `code`, đúng kiểu tài nguyên mà FE dễ tra bằng MÃ.

Đọc code cho thấy `ProjectsRepository` so `eq(projects.id, id)`, tức `:id` LÀ uuid. Nhưng đọc-code
không phải số đo ⇒ **mỗi LOẠI KHOÁ bắt buộc có ca ALLOW-2xx trên HÀNG THẬT**, vì đó là vế DUY NHẤT
phân biệt "pipe chặn rác" với "pipe chặn oan request hợp lệ" ([[deny-cases-vacuous-without-allow-case]]).
Ca "UUID hợp lệ không tồn tại → 404" **KHÔNG** phát hiện được lỗi này.

**11 loại khoá được phủ:** task · project · team · label · comment · watcher · checklist ·
checklist-item · project-member · project_state · file.

### §4.2 `DELETE /tasks/:taskId/files/cover` — anh em LITERAL của `:fileId`

`@Delete("cover")` khai TRƯỚC `@Delete(":fileId")`, và CHÍNH docblock của controller đã cảnh báo:
đảo thứ tự thì `cover` rơi vào `remove()` với `fileId="cover"`, chết ở tầng uuid và cho ra lỗi trông
như "chưa implement". Gắn pipe KHÔNG đổi thứ tự khớp route, nhưng nó ĐỔI thông điệp của cú rơi đó từ
500 sang 400 ⇒ ca định tuyến phải đo `cover` **trên task THẬT** (204 idempotent), không trên uuid
ngẫu nhiên — chỉ khi đó nó mới phân biệt được "route đúng, không có bìa" với "route bị nuốt".

### §4.3 Route NHIỀU tham số ⇒ đo RIÊNG TỪNG VẾ

12 route hai-tham-số + **2 route BA-tham-số** (`PATCH|DELETE /tasks/:taskId/checklists/:checklistId/items/:itemId`).
Mỗi vế một dòng `CASES`: rác ở vế đang đo, HÀNG THẬT ở các vế còn lại. Đo một vế rồi ký cả hai (ba)
dòng verdict là ký cho chỗ chưa đo.

### §4.4 Vế "vá quá tay" — `randomUUID()` phải ĐI QUA biên

Nếu ai đó siết biên đến mức UUID HỢP LỆ cũng bị 400 thì ca DENY vẫn xanh. Vế thứ hai của bảng
(`randomUUID()` → không 400, không 500) chặn đúng chuyện đó, và **75/75 vế này đã XANH ngay ở lần
chạy ĐỎ** — tức nó không phải assert dán thêm sau khi vá.

---

## §5. MÃ TRẠNG THÁI 2xx — ĐỌC TỪ FILE, không đoán

| route                                                                                                                                             |     2xx | nguồn                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ------------------------------------------------------ |
| `DELETE /tasks/:taskId` · `/comments/:commentId` · `/watchers/:watcherId` · `/checklists/:checklistId` · `.../items/:itemId` · `/labels/:labelId` | **204** | `@HttpCode(204)`                                       |
| `POST /tasks/:taskId/assign` · `change-status` · `move` · `move-state` · `change-priority` · `change-deadline`                                    | **200** | `@HttpCode(200)`                                       |
| `POST /tasks/:taskId/comments` · `/checklists` · `.../items` · `/files` · `.../cover`                                                             | **201** | `@Post` không khai `@HttpCode`                         |
| `POST /projects/:id/close`                                                                                                                        | **200** | `@HttpCode(200)`                                       |
| `DELETE /projects/:id` · `/members/:memberId` · `DELETE /labels/:labelId` · `/states/:stateId` · `DELETE .../files/cover` · `.../files/:fileId`   | **204** | `@HttpCode(204)`                                       |
| `GET .../files/:fileId/download`                                                                                                                  | **302** | `@Res()` library-mode → `res.redirect(302, signedUrl)` |

---

## §6. CA LITERAL-SIBLING — liệt kê bằng ĐỌC FILE

| route tĩnh                             | anh em tham số              | ghi chú                                                         |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `GET /tasks/my` · `GET /tasks/board`   | `GET /tasks/:taskId`        | **MỘT segment ⇒ KHỚP `:taskId`**; chỉ THỨ TỰ KHAI BÁO cứu chúng |
| `GET /tasks` · `POST /tasks`           | ↑                           | gốc, khác số segment                                            |
| `DELETE /tasks/:taskId/files/cover`    | `DELETE .../files/:fileId`  | ca đắt nhất §4.2 — đo trên task THẬT                            |
| `GET /projects` · `POST /projects`     | `GET /projects/:id`         |                                                                 |
| `GET /projects/:id/labels` · `/states` | `GET /projects/:id/members` | hai controller KHÁC nhau cùng mang prefix `projects/`           |

---

## §7. LUẬT ĐO (giống ba đợt trước, không nới)

- Actor ĐÃ đăng nhập, KHÔNG super-admin, KHÔNG seed `*:*`.
- Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
- KHÔNG gửi `Idempotency-Key` (`POST /tasks` có `@Idempotent()`; interceptor chạy TRƯỚC pipe).
- DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`.
- ALLOW = oracle loại CẢ 400 VÀ 500; ALLOW-2xx trên HÀNG THẬT cho MỖI LOẠI KHOÁ.
- `seedPermissionCatalog` phải truyền ĐÚNG `is_sensitive` của catalog (đọc từ lane DB, không đoán):
  `delete:task` = true · `view:task-audit-log` = true · `close|delete|manage-member|view-report:project`
  = true · phần còn lại (`read|create|update|comment|assign|update-status|update-state|update-priority|update-deadline|watch|view-kanban|file-upload|file-delete:task`,
  `read|create|update:project`, `label` ×4, `project_state` ×4) = **false**.

---

## §8. SỐ ĐO THỰC TẾ

**RED (trước vá), `LANE_DB=mediaos_paramuuid5`:**

| spec                                | DENY đỏ | ca còn lại xanh |
| ----------------------------------- | ------: | --------------: |
| `tasks-core-param-uuid.int-spec.ts` |      43 |              71 |
| `projects-param-uuid.int-spec.ts`   |      21 |              38 |
| `task-files-param-uuid.int-spec.ts` |      11 |              21 |
| **cộng**                            |  **75** |         **130** |

**75/75 đo được `500 SYSTEM-ERR-001` + `error.type='Error'`** — ĐỒNG NHẤT, **KHÔNG có phản-ví-dụ**
nào kiểu `auth-session` (404) của đợt 1.

**GREEN (sau vá):** ba spec **205/205 XANH**. Census: `ID_LIKE=298 · PIPED=261 · UNPIPED=37`.

**Lưới hồi quy:** 42 spec khác chạm `/tasks|/projects|/labels|/states` → **885/885 XANH**;
`test/foundation` → 216/216; `src/**` (chạy theo thư mục) → ~4.750 ca, 0 fail.

**Hai bẫy fixture đã trả giá** (sửa FIXTURE, KHÔNG nới assert), ghi lại tại chỗ trong spec:

1. `TasksRepository.teamExistsTx` tra bảng **`team_members`**, KHÔNG tra `teams` — team không có
   thành viên đọc ra 404 và ca ALLOW-200 đỏ vì lý do không liên quan tới tham số.
2. `seedCompany()` chỉ INSERT một hàng `companies`, KHÔNG chạy bootstrap công ty ⇒ `sequence_counters`
   rỗng ⇒ `POST /tasks` chết ở `SequenceService` (500) — đúng mã đang đi đo, nên nó giả trang được
   thành "route vẫn hỏng sau khi vá".

---

## §9. TRẦN CÒN LẠI — 37 KHÔNG PHẢI 37 MÓN NỢ

`UNPIPED_CEILING` 112 → **37**. Nợ THẬT chưa đo trong phạm vi = **0**. 37 chỗ còn lại đều ĐÃ CÓ
QUYẾT ĐỊNH:

| còn lại     |  số | vì sao KHÔNG phải nợ                                                                                                                                                                                                                                                                     |
| ----------- | --: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow/` |  36 | code hướng cũ chờ DỌN (`erd-current.md` §A5 · `backlog.mjs:26` de-media-fy · join thẳng bảng media `content_items` · 0 hộ tiêu thụ FE). Vá là đổ công vào code sắp xoá ⇒ CỐ Ý không đo, không vá, và KHÔNG ký `skipped` (ký vẫn buộc dựng fixture media). Xem `S10-CLEAN-WORKFLOWPARK-1` |
| `auth/`     |   1 | đã ký verdict `skipped` từ đợt 1: `revokeSession` đo được **404**, gắn pipe sẽ tách 400 khỏi 404 ⇒ **đẻ oracle liệt kê session id** — bản vá làm TỆ HƠN                                                                                                                                  |

⇒ Trần chỉ tụt tiếp (về **1**) khi module `workflow/` bị DỌN.

---

## §10. THỨ TỰ THI CÔNG (đã chạy)

1. **RED** — commit 3 int-spec TRƯỚC bản vá (`93ba2936`), chạy ĐỎ đúng 75 ca DENY, dán số đo THẬT.
2. **GREEN** — gắn `ParseUUIDPipe` cho cả 75 tham số (không tham số nào đo khác 500 ⇒ không dòng
   `skipped` mới).
3. Ký 75 dòng verdict + thêm 5 file vào `PARAM_UUID_MEASURED_FILES` (24 → 29) +
   `PARAM_UUID_MEASURED_SIZE` 110 → 185.
4. Hạ `UNPIPED_CEILING` 112 → 37; `CLEAN_PREFIXES` nhận thêm `tasks/` (16 → 17 prefix).
5. Census hộ tiêu thụ 500→400 đủ TÁM chỗ — **0 hộ gửi `:id` phi-UUID, 0 spec đóng đinh 500**.
6. ĐÓNG KI-078 trong RELEASE-02 kèm số trước/sau và giải thích trần 37.

⚠️ Thay `@Param` hàng loạt: dùng **`sed`** (byte-oriented) chứ KHÔNG dùng perl —
perl double-encode comment tiếng Việt ([[perl-edit-double-encodes-utf8-comments]]). Trước khi thay đã
đếm `@Param(` trong 5 file = ĐÚNG 75 (43·13·11·4·4), 0 hit nằm trong comment
([[guard-immutability-matches-comments]]); sau khi thay soi `git diff -U0` từng dòng — 75 dòng tham
số + 5 dòng import, 0 dòng comment.
