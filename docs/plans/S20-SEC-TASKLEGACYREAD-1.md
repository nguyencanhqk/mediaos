# S20-SEC-TASKLEGACYREAD-1 — plan v1.2 (+ §10 số đo thi công)

> Zone 🔴 red · gate FULL · crown. Nhánh `fix/s20-sec-tasklegacyread-1` cắt từ `6e2e58e7`.
> Mọi số đo dưới đây lấy trên `6e2e58e7`. Nhãn: **[ĐO]** = đã đọc/đếm trên mã; **[SUY RA]** = suy luận, phải đo lại ở bước thi công.
> Repo PUBLIC: plan này chỉ ghi bất biến + số đo tổng hợp + danh sách tệp. Bảng chi tiết, nhật ký RED và đầu dò hậu deploy nằm ở kênh owner (ngoài repo).
> v1.1 — áp plan-review (F1–F8); v1.2 — áp plan-review lần 2 (N2–N6) ở bước RED. Xem §9.

## §1 Bất biến + phạm vi

**Bất biến I-1 (cùng phạm vi đọc — giới hạn trong phạm vi WO):** với cùng một người gọi, tập id việc trả về qua ba đường đọc danh sách đời cũ của `TasksController` (`GET /tasks/board`, `GET /tasks/by-project/:projectId`, `GET /tasks/by-team/:teamId`) phải ⊆ tập id mà `GET /tasks` trả cho người gọi đó. Nhánh "gỡ" thoả I-1 vì ba đường không còn trả danh sách. Các đường đọc danh sách khác (`/tasks/my`, `:taskId/subtasks`, kanban theo dự án, feed hoạt động dự án) **không thuộc I-1 của WO này** và plan không khẳng định gì về chúng.

**Bất biến I-2 (không đường đọc thứ hai):** không giữ hai đường đọc danh sách việc với hai biểu thức phạm vi khác nhau. Đường đọc mới (nếu có) phải tái dùng đúng hàm quyết định phạm vi của `GET /tasks`.

**Phạm vi WO:** ba route trên cùng các hàm service/repository chỉ phục vụ chúng. KHÔNG đụng: `GET /tasks`, `GET /tasks/my`, `GET /tasks/:taskId`, các route ghi, FE.

## §2 Đo trên `6e2e58e7`

### 2.1 Ba route và các hàm phục vụ [ĐO]

| Route                              | Controller (`tasks.controller.ts`) | Service (`tasks.service.ts`)                   | Repository (`tasks.repository.ts`) |
| ---------------------------------- | ---------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `GET /tasks/board`                 | `:112-119` `getBoard`              | `:82-85` `listBoard`                           | `:165-194` `listAll`               |
| `GET /tasks/by-project/:projectId` | `:127-140` `getProjectTasks`       | `:91-98` `listByProject` (+ `projectExistsTx`) | `:197-211` `listByProject`         |
| `GET /tasks/by-team/:teamId`       | `:148-161` `getTeamTasks`          | `:104-111` `listByTeam` (+ `teamExistsTx`)     | `:214-240` `listByTeam`            |

- Đường chuẩn `GET /tasks` (`tasks.controller.ts:88-93`) → `TaskCoreService.listTasks` (`task-core.service.ts:158-191`) → `resolveReadScopeExists` (`task-core.service.ts:1127-1134`). Đường chi tiết `getTask` (`:194-214`) dùng chung hàm đó [ĐO].
- Nguồn nợ: WO `S4-TASK-BE-2` mục (c), chưa có WO đóng [ĐO `harness/backlog.mjs` ~4197].
- Bảng vai trò × route × kết quả: kênh owner (ngoài repo).

### 2.2 Nơi gọi (done_when 1) [ĐO — `git grep` trên cây `6e2e58e7`]

| Nơi                                                                                |                                                                                                               `board` |                                               `by-project` |                                                  `by-team` |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------: | ---------------------------------------------------------: |
| FE `apps/app` · `apps/console` · `apps/auth` · `packages/web-core` · `packages/ui` |                                                                                                                     0 |                                                          0 |                                                          0 |
| `apps/lms` (repo riêng, grep chỉ-đọc checkout chính, trừ `node_modules`/`.next`)   |                                                                                                                     0 |                                                          0 |                                                          0 |
| `scripts/`                                                                         |                                     1 — `scripts/perf-smoke.mjs:57` (đầu dò latency, KHÔNG nối vào `package.json`/CI) |                                                          0 |                                                          0 |
| Test tự kiểm route (HTTP)                                                          |                                                           `tasks-core-param-uuid.int-spec.ts:719-720` (ca định tuyến) |       `tasks-core-param-uuid.int-spec.ts:314-315, 564-565` |                                        `:319-320, 568-569` |
| Test dùng route làm đầu dò JWT                                                     |                                                                         `api-keys.deny-path.int-spec.ts:120-121, 134` |                                                          0 |                                                          0 |
| Test gọi thẳng service                                                             | `tasks-board.int-spec.ts` (cả tệp, 160 dòng) · `labels.int-spec.ts:102,107,121,157` · `tasks.service.spec.ts:186-215` |                            `tasks.service.spec.ts:331-360` |                            `tasks.service.spec.ts:362-385` |
| Test spy method service                                                            |                                                                                                                     0 |            `dashboard-widget-security.int-spec.ts:491,519` |                                                          0 |
| Sổ/ratchet                                                                         |                                                                                       `route-census.json:10458-10473` | `param-uuid-verdicts.ts:1014-1020` · census `:10506-10521` | `param-uuid-verdicts.ts:1021-1027` · census `:10538-10553` |
| Chuỗi dữ liệu (không gọi)                                                          |                                                                   `rls-registry.ts:2345` (giá trị cột `request_path`) |                                                          — |                                                          — |

**Kết luận đo:** 0 hộ tiêu thụ chức năng (FE/console/auth/lms). Mọi nơi gọi còn lại là (a) test tự kiểm chính route/hàm, (b) đầu dò dùng route làm mẫu (`api-keys` JWT, `perf-smoke`) — mục đích của chúng được phục vụ y nguyên bởi `GET /tasks`. ⇒ **nhánh "gỡ"** của done_when 1.

**Đo lại v1.1 (F2):** quét mọi tham chiếu tới ký hiệu sẽ gỡ (`listBoard` · `listByProject` · `listByTeam` · `attachLabels` · `teamExistsTx` · `ListTasksQueryDto` · `PageQueryDto` · `pageQuerySchema` · `ListTasksFilter` · `listLabelsForTaskIds` · `listAll`) trong `apps/api/{src,test}` ngoài ba tệp `tasks.{controller,service,repository}.ts`. Hộ MÃ chạy: `tasks.service.spec.ts`, `labels.int-spec.ts`, `tasks-board.int-spec.ts`, `dashboard-widget-security.int-spec.ts` (spy — sót ở v1), `tasks.dto.ts`. Còn lại chỉ là comment (§8) hoặc ký hiệu cùng tên khác lớp (`TaskActivityFeedService.listByProject`, `TaskCoreRepository.listBoardStatesTx` — KHÔNG đụng).

### 2.3 Hàm lộ mồ côi khi gỡ [ĐO đếm tham chiếu]

- `TasksService`: `listBoard`, `listByProject`, `listByTeam`, `attachLabels` (chỉ 3 hàm trên gọi), import `LabelDto`/`ListTasksFilter`/`Pagination` [SUY RA — tsc xác nhận].
- `TasksRepository`: `listAll`, `listByProject`, `listByTeam`, `teamExistsTx`, `listLabelsForTaskIds` (bản không-Tx, chỉ `attachLabels` gọi), `ListTasksFilter`, `clampLimit`/`safeOffset` cục bộ + hằng trang nếu không còn ai dùng [ĐO]. **GIỮ** `projectExistsTx` (labels · project-states · task-core · kanban dùng) và `listLabelsForTaskIdsTx` (`getTask` dùng, `task-core.service.ts:204`).
- `tasks.dto.ts`: `ListTasksQueryDto`, `PageQueryDto`/`pageQuerySchema` (chỉ controller ba route dùng) [ĐO].
- `TasksService` vẫn được `TasksController` (route ghi đời cũ) + `DashboardWidgetHandlersService` inject ⇒ class giữ nguyên.

### 2.4 Ratchet bị ảnh hưởng [ĐO hiện trạng; số sau = SUY RA, đo ở thi công]

- Census runtime `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`: `totals.routes` 692 → **689**, `gated` 653 → **650** (cả ba là gated, verdict null).
- **Bằng chứng done_when 3** (không route mới nào chỉ có cặp quyền): diff census sinh lại so với `6e2e58e7` = **−3 route, +0 route** (ghi số thật vào đây ở bước thi công). Không thêm route ⇒ không có route mới nào để thiếu phạm vi.
- `route-http-coverage.e2e-spec.ts:380` `MIN_COVERED_COUNT = 692` → hạ về **số spec in ra** (kỳ vọng 689). Lý do bằng văn bản theo luật đã có (`harness/backlog.mjs` ~14118): route bị gỡ khỏi cây mã, **uncovered vẫn = 0** (tụt tổng mà uncovered > 0 là mất test, cấm hạ).
- `param-uuid-verdicts.ts`: gỡ 2 dòng `piped` (`getProjectTasks:projectId`, `getTeamTasks:teamId`); `PARAM_UUID_MEASURED_SIZE` 185 → **183**; `param-uuid-ratchet.unit-spec.ts:332` đếm `piped` 184 → **182**. Luật hạ sàn hiện ghi (`param-uuid-verdicts.ts:1625-1627`) chỉ cho phép khi **CONTROLLER** biến mất; ở đây controller còn, chỉ **handler** bị xoá ⇒ sửa docblock luật (xem §3 bước 7).
- `tasks.permissions.spec.ts:53` dòng `getBoard` (kiểu `keyof TasksController` ⇒ tsc đỏ nếu quên gỡ).

## §3 Thiết kế

1. **Gỡ ba handler** khỏi `TasksController` + docblock; sửa docblock `getTask` (`:165`) bỏ nhắc tới ba route tĩnh.
2. **Gỡ hàm mồ côi** ở §2.3, chỉ những gì tsc/eslint xác nhận không còn tham chiếu. Không đổi chữ ký hàm còn sống. `tasks.repository.ts` (933 dòng, đã > 800) chỉ **giảm**.
3. **Không viết biểu thức phạm vi thứ hai** — nhánh "gỡ" không cần; `GET /tasks` giữ nguyên (I-2).
4. **Định tuyến sau khi gỡ** [SUY RA, đo ở §4]: `GET /tasks/board` (một segment) rơi vào `@Get(":taskId")` ⇒ `ParseUUIDPipe` ⇒ **400**; `by-project/:id`, `by-team/:id` (hai segment, không khớp literal con nào) ⇒ **404**.
5. **Đầu dò:** `api-keys.deny-path` (A)(B) đổi `/tasks/board` → `/tasks` (cùng cặp `read:task`; ca (A) cần 200, ca (B) cần 401 — không phụ thuộc nội dung). `scripts/perf-smoke.mjs` đổi mục `task_board` → `GET /tasks?limit=20` (đường FE thật dùng).
6. **Test cũ của hàm bị gỡ:**
   - xoá `tasks-board.int-spec.ts` (chỉ kiểm `listBoard`); gỡ các khối `describe` tương ứng trong `tasks.service.spec.ts` (`:186-215`, `:320-385` + stub `listByProject`/`listByTeam`/`listLabelsForTaskIds`/`teamExistsTx` ở `makeRepo`).
   - **`labels.int-spec.ts` (F5):** ba ca gán/gỡ/idempotent đọc nhãn bằng **đúng hàm repository mà `getTask` dùng**: `db.withTenant(A.companyId, (tx) => repo.listLabelsForTaskIdsTx(tx, A.companyId, [task.id]))` (`task-core.service.ts:204`). KHÔNG dựng tay `TaskCoreService` (cần storage + goal-progress stub, dễ stub nhầm phạm vi). `TasksService` trong spec giữ nguyên (vẫn dùng `createTask`/`addLabelToTask`/`removeLabelFromTask`). Ca "lọc theo labelId" gỡ cùng tính năng (lọc nhãn chỉ có trên board, 0 hộ FE). **(N6)** `db`/`repo` hiện là `const` cục bộ trong `beforeAll` (`labels.int-spec.ts:43-44`) ⇒ đưa lên `let` ở phạm vi `describe` để các ca `it` gọi được; KHÔNG dựng `DatabaseService` thứ hai.
   - **`dashboard-widget-security.int-spec.ts` (F2):** spy chuyển từ `TasksService.listByProject` sang **`ProjectsService.countsByStatusLeaf`** — aggregate thật mà `fetchProjectProgress` gọi (`dashboard-widget-handlers.service.ts:454`). Giữ nguyên hai ca deny (403 thiếu `read:project` · 404 dự án không tồn tại/ngoài phạm vi) + khẳng định aggregate KHÔNG được gọi. Cấm xoá khối describe; cấm giữ `listByProject` chỉ để test xanh. Ghi nhận: spy cũ đã rỗng từ khi handler chuyển sang `countsByStatusLeaf` (`S5-TASK-SUBTASK-1`) — đổi spy làm ca crown có nghĩa trở lại. **(N2, đã áp ở commit RED)** thêm ca ALLOW đứng cạnh: user `withProj`, dự án thật cùng công ty → 200 + spy gọi đúng 1 lần (lần đầu = cache-miss) — giết đột biến D12. Tệp 784 dòng sau RED: đổi tại chỗ, không làm dài quá 800. Sửa kèm comment cũ ở `dashboard-widget-handlers.service.ts:414/:426/:446` (chỉ comment) để không trỏ tới method đã gỡ. **(N5)** comment mới chỉ nêu điều đang đúng: `countsByStatusLeaf` không tự scope theo actor ⇒ `gateProjectProgress` authorize trước; không nhắc route đã gỡ, không mô tả hành vi lọc trước đây.
   - **`tasks-core-param-uuid.int-spec.ts` (F6):** gỡ 2 ca bảng `CASES` (`:312-321`), 2 ca ALLOW-200 (`:564-570`), ca định tuyến `board` (`:719-721`), **và** khối seed team + comment bẫy (`:241-252`) + `let teamId` (`:96`). GIỮ `orgUnitId` (còn dùng ở `:195`, `:237`). Chạy eslint tệp để chắc không còn biến gán-mà-không-đọc.
7. **Ratchet:**
   - sinh lại census bằng `ROUTE_CENSUS_WRITE=1 … route-guard-coverage.e2e-spec.ts`; hạ `MIN_COVERED_COUNT` theo số spec in ra, lý do kèm "uncovered = 0".
   - **param-uuid (F4):** sửa docblock luật ở `param-uuid-verdicts.ts:1625-1627` thành: sàn được hạ khi **CONTROLLER hoặc HANDLER** bị xoá khỏi cây mã; bằng chứng bắt buộc = siteKey không còn trong `idLikeParamSites()` (`param-uuid-census.ts:98`) **và** route vắng trong census sinh lại. Site còn sống mà mất dòng verdict vẫn là NỢ, cấm hạ sàn. Ghi dòng lịch sử "`S20-SEC-TASKLEGACYREAD-1`: 185 → 183" ở docblock `PARAM_UUID_MEASURED_SIZE` và "184 → 182" ở comment `param-uuid-ratchet.unit-spec.ts:328-331`. **(N4)** cùng lúc sửa câu luật trùng ở `param-uuid-ratchet.unit-spec.ts:330` thành «controller HOẶC handler bị xoá — xem `PARAM_UUID_MEASURED_SIZE`», để không còn hai phát biểu luật mâu thuẫn.
8. **Chốt tĩnh (không cần DB):** `tasks.permissions.spec.ts` thêm ca: `TasksController` không có handler `GET` nào mang path `board` / `by-project/:projectId` / `by-team/:teamId` (đọc metadata `PATH_METADATA` + `METHOD_METADATA` qua mọi method của prototype) — đỏ ngay nếu route được thêm lại.

## §4 Bảng ca test

Int-spec MỚI `apps/api/test/integration/task-read-paths-scope.int-spec.ts` — dựng app qua **`applyMainPipeline`** (`test/helpers/bootstrap-app.ts`), `describe.skipIf(!hasDb || !LANE_DB)`, chạy lane `mediaos_s20r` qua wrapper. Fixture tái dùng `test/helpers/task-file-seed.ts` (`grant` · `seedEmployee` · `seedTask` · `seedProjectMember`) + `seedCompany`/`seedUser`; mật khẩu qua `loginPasswordFixture`.

**Fixture (công ty A, B):** người gọi `N` (grant `read:task` @Own, có employee); nhân viên `O` (user + employee, không liên quan `N`); người gọi `M` (grant @Team) với nhân viên `E`; người gọi `H` (grant @Company). Dự án `P` (`N` không là thành viên). Team `T`: seed hàng `teams` (công ty A) **trước**, rồi `team_members(T, O)` — `team_members.team_id` có FK tới `teams` (`org.ts:107-109`, N3); `teamExistsTx` tra `team_members`, không tra `teams`. Việc: `tN` giao `N`; `tO` giao `O`, gắn `P`; `tE` giao `E`; `tB` ở công ty B.

**Bổ sung cột mà helper không ghi (F3):** `seedTask` (`task-file-seed.ts:49-61`) chỉ ghi `main_assignee_employee_id`/`project_id`; `seedEmployee` (`:33-43`) không ghi `direct_manager_id`. Spec phải `UPDATE` bằng direct pool: `tasks.assignee_user_id = O` cho `tO` (cột mà đường theo team lọc, `tasks.repository.ts:233`) và `employee_profiles.direct_manager_id = M.userId` cho `E` (nhánh Team, `data-scope.service.ts:193`). **Assert tiền điều kiện trong `beforeAll`** (direct pool): `tO.assignee_user_id = O`, có hàng `team_members(T, O)` chưa xoá mềm, `tO.project_id = P`, `E.direct_manager_id = M.userId` — thiếu một cái ⇒ đỏ ngay, không chạy tiếp.

| #   | Ca (tên trung tính)                                                                                                        | Kỳ vọng sau vá                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R1  | `GET /tasks/board` không còn phục vụ (không 2xx)                                                                           | `N` → body không chứa `tO`, rồi status ∈ {400,404} |
| R2  | `GET /tasks/by-project/:projectId` không còn phục vụ (không 2xx)                                                           | `N` + `P` → body không chứa `tO`, rồi status 404   |
| R3  | `GET /tasks/by-team/:teamId` không còn phục vụ (không 2xx)                                                                 | `N` + `T` → body không chứa `tO`, rồi status 404   |
| R4  | I-1: với `N` và `M`, id trả về của mỗi đường đọc đời cũ ⊆ id của `GET /tasks` (không 2xx ⇒ tập rỗng)                       | đúng cho cả 3 đường                                |
| S1  | chốt tĩnh: controller không khai GET `board` / `by-project/:projectId` / `by-team/:teamId`                                 | xanh                                               |
| A1  | ALLOW: `N` `GET /tasks` thấy `tN`, không thấy `tO`                                                                         | 200                                                |
| A2  | ALLOW: `H` `GET /tasks` thấy `tN`, `tO`, `tE` (neo chống xanh-rỗng: `tO` tồn tại và đọc được ở phạm vi rộng)               | 200                                                |
| A3  | ALLOW: `M` `GET /tasks` thấy `tE`, không thấy `tO`                                                                         | 200                                                |
| A4  | ALLOW: `N` `GET /tasks/:tN` 200 · `GET /tasks/:tO` 404 (đường chi tiết giữ cùng phạm vi)                                   | như cũ                                             |
| A5  | ALLOW: `GET /tasks/my` vẫn 200 (anh em literal của `:taskId`)                                                              | 200                                                |
| X1  | cross-tenant: người gọi công ty B `GET /tasks` không chứa id công ty A; `by-project/<P của A>` · `by-team/<T của A>` ≠ 2xx | xanh                                               |

- **Thứ tự assertion trong R1–R3 (F3):** khẳng định nội dung (body không chứa `tO`) đứng **trước** khẳng định status, để lượt RED ghi đúng nguyên nhân thay vì chỉ "route còn tồn tại".
- R4 sau vá xanh-rỗng có chủ đích (không 2xx ⇒ tập rỗng); vai trò của nó là chặn route bị thêm lại. Neo thật là A1–A3.
- Thứ tự commit: spec trước (lượt RED) → vá → cả bảng xanh. Thông điệp lỗi thực tế của từng ca ở lượt RED + số ca đỏ/xanh ghi vào tệp ngoài repo, không vào repo.

**Lưới hồi quy** (wrapper, ≤ 3 tệp/lượt): `tasks-core-param-uuid` · `api-keys.deny-path` · `labels` · `dashboard-widget-security` · `routehttp3-tasks-goals` · unit `src/tasks/**` · `test/foundation/param-uuid-ratchet.unit-spec.ts` · `route-guard-coverage.e2e-spec.ts` · `route-http-coverage.e2e-spec.ts` · `pipeline-parity.unit-spec.ts` (spec mới phải qua) · typecheck `@mediaos/api` · eslint các tệp đổi.

## §5 Đột biến (mỗi cái phải ĐỎ ít nhất một ca)

| #   | Đột biến                                                                     | Ca giết                                                           |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| D1  | thêm lại handler `getBoard`                                                  | R1, R4, S1, census `MIN_COVERED_COUNT`/totals                     |
| D2  | thêm lại handler `getProjectTasks`                                           | R2, R4, S1                                                        |
| D3  | thêm lại handler `getTeamTasks`                                              | R3, R4, S1                                                        |
| D4  | `resolveReadScopeExists` luôn trả `undefined` (mất phạm vi trên đường chuẩn) | A1, A3, A4 (R4 không đủ một mình)                                 |
| D5  | fixture: bỏ/xoá mềm `tO` (xanh-rỗng)                                         | A2 + assert tiền điều kiện                                        |
| D6  | gỡ `ParseUUIDPipe` của `getTask`                                             | R1 (đòi 400/404) + `tasks-core-param-uuid`                        |
| D7  | xoá dòng verdict param-uuid nhưng giữ handler                                | `param-uuid-ratchet` ca (5) song ánh                              |
| D8  | gỡ nhầm `projectExistsTx` (dùng chung)                                       | typecheck + `labels`/`project-states` int-spec                    |
| D9  | `M` được cấp @Company thay vì @Team trong fixture                            | A3                                                                |
| D10 | bỏ `await this.projects.getProject` trong `gateProjectProgress` (F2)         | `dashboard-widget-security` ca 404 (status + spy aggregate)       |
| D11 | fixture: không `UPDATE` `assignee_user_id` / `direct_manager_id` (F3)        | assert tiền điều kiện `beforeAll`                                 |
| D12 | spy S5 đặt trên method/instance mà handler không gọi (N2)                    | `dashboard-widget-security` S5 ALLOW (`toHaveBeenCalledTimes(1)`) |

Chạy D1, D4, D5, D6, D10 thật trên nhánh (D12 đã chạy ở bước RED: spy đặt lại trên method cũ ⇒ ca ALLOW đỏ «0 lần gọi», hai ca deny vẫn xanh) (đổi tạm → đo đỏ → hoàn tác); D2/D3 tương đương D1; D7–D9, D11 ghi bằng lập luận + ca có sẵn.

## §6 Tệp đổi

Trong `paths` của WO:

- `apps/api/src/tasks/tasks.controller.ts` · `tasks.service.ts` · `tasks.repository.ts` · `tasks.permissions.spec.ts`
- `apps/api/test/integration/task-read-paths-scope.int-spec.ts` (MỚI)
- `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (sinh lại)
- `docs/plans/S20-SEC-TASKLEGACYREAD-1.md`

**pathsNeeded** (ngoài `paths`, tối thiểu):

- `apps/api/src/tasks/tasks.dto.ts` — gỡ DTO mồ côi
- `apps/api/src/tasks/tasks.service.spec.ts` — gỡ khối kiểm hàm bị xoá
- `apps/api/test/integration/tasks-board.int-spec.ts` — XOÁ
- `apps/api/test/integration/tasks-core-param-uuid.int-spec.ts` — gỡ 5 ca + fixture team mồ côi
- `apps/api/test/integration/labels.int-spec.ts` — đổi đường đọc nhãn, gỡ ca lọc nhãn
- `apps/api/test/integration/api-keys.deny-path.int-spec.ts` — đầu dò → `/tasks`
- `apps/api/test/integration/dashboard-widget-security.int-spec.ts` — spy → `ProjectsService.countsByStatusLeaf` (F2)
- `apps/api/src/dashboard/dashboard-widget-handlers.service.ts` — chỉ comment `:414/:426/:446` (F2)
- `apps/api/test/foundation/param-uuid-verdicts.ts` · `param-uuid-ratchet.unit-spec.ts` · `route-http-coverage.e2e-spec.ts`
- `scripts/perf-smoke.mjs` — đầu dò → `GET /tasks`

Thêm ở bước vá gate (§11):

- `packages/contracts/src/task.ts` — gỡ họ DTO của các route đọc danh sách đời cũ (0 nơi dùng, đo)
- `apps/api/src/tasks/tasks.module.ts` · `apps/api/src/dashboard/dashboard-widget-catalog.const.ts` · `apps/api/src/dashboard/dashboard-cache-invalidation.dto.ts` — chỉ comment
- `docs/DEVOPS/DEVOPS-13_…` · `docs/DEVOPS/DEVOPS-15_…` — ghi chú route đã gỡ

KHÔNG đổi: migration, FE, `harness/backlog.mjs` (luồng chính), dependency.

## §7 Deploy + rollback

- **Chỉ API** (+ gỡ export contracts không có nơi dùng — bundle FE không đổi), không migration, không FE ⇒ Pages không đổi. Quyết định owner giữ nguyên: merge và cập nhật API PROD **trong cùng ngày**.
- **Thời điểm mở PR (F1):** luồng chính chỉ mở PR khi owner sẵn sàng deploy API trong **cùng khung giờ** — thu hẹp khoảng giữa lúc PR công khai và lúc PROD nhận bản vá.
- **Đầu dò hậu deploy (gate M1):** ngay sau khi cập nhật API PROD, gọi ba đường cũ với một token hợp lệ ⇒ mong 400/404 và body không có mảng `data`; ghi kết quả ở kênh owner (ngoài repo), không dữ liệu PROD vào repo. Không để PR mở lâu sau khi push nhánh.
- **Rollback:** quay về build API trước (không có thay đổi DB ⇒ an toàn, không cần down-migration). Chỉ dùng khi đường chuẩn hỏng.
- **Rebase song song (F8):** census json, `route-http-coverage.e2e-spec.ts` và `param-uuid-verdicts.ts` là tệp số đếm dùng chung với các chuỗi đang chạy song song. Sau MỖI lần rebase lên master: sinh lại census bằng `ROUTE_CENSUS_WRITE=1`, đặt `MIN_COVERED_COUNT` và sàn param-uuid theo **số spec in ra**. Cấm gộp số bằng tay khi giải xung đột.
- `check.sh --all --lane-db` + FULL gate (security-reviewer + silent-failure-hunter + santa) là việc của luồng chính trước PR.

## §8 Ngoài phạm vi / nợ

- ~~`packages/contracts` còn họ DTO board~~ — đã gỡ ở bước vá gate (§11).
- `TasksService.getMyTasks` + `repo.findByAssignee` mồ côi **từ trước** WO (controller dùng `TaskCoreService.getMyTasks`) [ĐO: chỉ spec gọi] — không do WO này lộ ra ⇒ ghi nợ, gỡ ở WO dọn mã chết riêng (gate L3).
- Chốt tĩnh dạng danh sách GET dương (S1) mới có ở `TasksController`; các controller khác có đường đọc danh sách (dự án, kanban, feed) chưa có ratchet phạm vi đọc tương đương — ngoài phạm vi.
- `DashboardWidgetHandlersService` inject `TasksService` nhưng 0 lời gọi `this.tasks.` [ĐO].
- Comment nhắc ký hiệu bị gỡ: đã cập nhật ở `dashboard-widget-catalog.const.ts`, `dashboard-cache-invalidation.dto.ts`, `tasks.module.ts`; DEVOPS-13/15 thêm ghi chú (số đo cũ giữ — tài liệu lịch sử). Giữ nguyên: `me-aggregation.service.ts:64` (danh sách hàm CẤM gọi — vẫn đúng nghĩa), `migrations/0493` (migration đã áp — không sửa), `apps/app/src/components/dashboard/ProjectProgressWidget.tsx:5` (comment FE — dọn ở WO FE kế, giữ diff vùng đỏ không chạm FE).
- Các route ghi đời cũ trong `TasksController` (`PATCH :taskId/status`, labels) — ngoài phạm vi.
- Các đường đọc danh sách khác (`/tasks/my`, `:taskId/subtasks`, kanban, feed dự án) — ngoài I-1 của WO này (F7).

## §9 Plan-review v1 → v1.1

| #   | Mức     | Quyết định | Ghi chú                                                                                                                                             |
| --- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | BLOCKER | ÁP         | Lịch sử nhánh viết lại (commit plan v1 thay bằng v1.1 trên `6e2e58e7`, chưa từng push); phần chi tiết chuyển ra kênh owner; §7 thêm thời điểm mở PR |
| F2  | HIGH    | ÁP         | Đo lại toàn bộ tham chiếu (§2.2); thêm `dashboard-widget-security.int-spec.ts` + D10                                                                |
| F3  | MEDIUM  | ÁP         | `UPDATE` hai cột + assert tiền điều kiện + thứ tự assertion; D11                                                                                    |
| F4  | MEDIUM  | ÁP         | Sửa docblock luật hạ sàn (controller **hoặc handler**) + dòng lịch sử; lý do `MIN_COVERED_COUNT` nêu uncovered = 0                                  |
| F5  | MEDIUM  | ÁP         | Đọc nhãn qua `repo.listLabelsForTaskIdsTx` trong `withTenant`; `TasksService` của spec giữ (vẫn dùng ghi)                                           |
| F6  | LOW     | ÁP         | Gỡ seed team + `teamId`; giữ `orgUnitId` (còn dùng `:195`, `:237`)                                                                                  |
| F7  | LOW     | ÁP         | Thu hẹp I-1 về ba đường của WO; bằng chứng done_when 3 = diff census −3/+0 (§2.4)                                                                   |
| F8  | LOW     | ÁP         | Luật sinh lại số sau rebase (§7)                                                                                                                    |

### Plan-review v1.1 → v1.2 (áp ở bước RED)

| #   | Mức    | Quyết định  | Ghi chú                                                                                                                  |
| --- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| N1  | —      | LUỒNG CHÍNH | Thời điểm push nhánh — ngoài bước RED                                                                                    |
| N2  | MEDIUM | ÁP          | Ca ALLOW S5 + D12; `ProjectsService` chỉ provide ở `tasks.module.ts:89` (export `:142`) ⇒ spy trúng instance của handler |
| N3  | LOW    | ÁP          | §4: seed `teams` trước `team_members` (FK `org.ts:107-109`)                                                              |
| N4  | LOW    | ÁP          | §3 bước 7: sửa câu luật trùng ở `param-uuid-ratchet.unit-spec.ts:330` (thi công ở bước vá)                               |
| N5  | LOW    | ÁP          | §3 bước 6: ràng buộc nội dung comment thay thế ở `dashboard-widget-handlers.service.ts`                                  |
| N6  | LOW    | ÁP          | §3 bước 6: `let db`/`let repo` ở phạm vi `describe` của `labels.int-spec.ts` (thi công ở bước vá)                        |

Ca cũ khẳng định hành vi trái I-1 (gỡ/đổi ở bước vá theo §3 bước 5–6; ca đối nghịch ở spec mới): `tasks-core-param-uuid` ALLOW-200 `by-project`/`by-team` + định tuyến `board` 200 (↔ R1–R3) · `api-keys.deny-path` (A) `board` 200 (đổi đầu dò) · `tasks-board.int-spec.ts` · ca lọc nhãn `labels.int-spec.ts` · khối `listBoard`/`listByProject`/`listByTeam` của `tasks.service.spec.ts` · dòng `getBoard` của `tasks.permissions.spec.ts` (↔ S1).

## §10 Thi công (GREEN) — số đo thật

| Mục                                      | Kỳ vọng plan          | Đo được                                                                     |
| ---------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| Census JSON sinh lại (`totals.routes`)   | 692 → 689             | 692 → **689** · `gated` 653 → **650** · các tổng khác giữ nguyên            |
| done_when 3 — diff tập route so với base | −3 / +0               | **−3 / +0** (đúng ba route của WO)                                          |
| `route-http-coverage` (số spec in ra)    | 689, uncovered 0      | **689/689 (100.0%) — CHƯA phủ: 0** ⇒ `MIN_COVERED_COUNT = 689`              |
| `PARAM_UUID_MEASURED_SIZE` · đếm `piped` | 185 → 183 · 184 → 182 | **183** · **182** (ratchet xanh)                                            |
| `tasks.repository.ts`                    | chỉ giảm              | 933 → **791** dòng                                                          |
| Bảng `CASES` của `tasks-core-param-uuid` | gỡ 2 ca               | 43 → **41** (ca (0) neo số theo census AST; docblock đầu tệp cập nhật cùng) |

Lệch nhỏ so với §3 (ghi để reviewer đối chiếu):

- `tasks.service.ts`: gỡ thêm import `ForbiddenException` không dùng (cảnh báo eslint có sẵn từ trước, cùng khối import đang sửa).
- `tasks-core-param-uuid.int-spec.ts`: ngoài 5 ca + seed team, cập nhật số tham số 43 → 41 ở docblock, tên `describe` và ca (0) — bắt buộc để ca (0) khớp census AST.
- `api-keys.deny-path.int-spec.ts`, `labels.int-spec.ts`: prettier định dạng lại toàn tệp (tệp gốc chưa theo prettier); thay đổi nội dung chỉ là đầu dò `/tasks` và đường đọc nhãn.
- Docblock `GET /tasks` ở controller thêm một câu nêu I-2 (đường đọc danh sách theo bộ lọc duy nhất của controller).

## §11 Gate FULL → vá gate (đầu `aeaa4d65`)

Reviewer: security · correctness · silent-failure (santa: hai PASS_WITH_FINDINGS). Mỗi finding xác minh bằng mã trước khi quyết.

| #                                                   | Mức        | Quyết định      | Đo / ghi chú                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1                                                  | MEDIUM     | NỢ VẬN HÀNH     | Không vá được bằng mã của nhánh: khoảng giữa lúc nhánh công khai và lúc API PROD nhận bản vá. §7 giữ quyết định owner (mở PR khi sẵn sàng deploy, merge + deploy API cùng ngày) + thêm đầu dò hậu deploy                                              |
| L1 · F1 (correctness) · F2 (silent, phần contracts) | MEDIUM/LOW | ĐÃ VÁ           | Đo trước: 5 ký hiệu họ DTO board, 0 nơi dùng ngoài `task.ts` trong `apps/` + `packages/`. Gỡ cùng comment trỏ tới chúng; `task.ts` 856 → 826 dòng; dist contracts không còn ký hiệu; typecheck api · app · console · auth · web-core xanh             |
| L2                                                  | LOW        | ĐÃ VÁ           | S1 → quy tắc DƯƠNG: tập path GET của `TasksController` phải khớp đúng 8 path đã duyệt. Đột biến thêm một GET tên mới ⇒ đỏ `expected [ '/', ':taskId', …(7) ] to deeply equal [ '/', ':taskId', …(6) ]` (danh sách phủ định cũ không bắt được tên mới) |
| L3                                                  | LOW        | NỢ (§8)         | Mồ côi từ trước WO, không do WO lộ ra                                                                                                                                                                                                                 |
| F2 (correctness)                                    | LOW        | ĐÃ VÁ (ghi chú) | R4 ghi rõ là lưới phụ; lớp chính R1–R3 · S1 · A1–A3                                                                                                                                                                                                   |
| F1 (silent)                                         | LOW        | ĐÃ VÁ           | `idsOf` ném khi 2xx mà `data` không phải mảng; không 2xx vẫn ⇒ tập rỗng                                                                                                                                                                               |
| F3 (correctness)                                    | LOW        | KHÔNG VÁ        | `git diff -w` của `api-keys.deny-path.int-spec.ts`: chỉ đổi tên ca (A) + hai đầu dò `/tasks/board` → `/tasks`; phần còn lại là ngắt dòng prettier                                                                                                     |
| F4 (correctness) · F2 (silent, phần comment)        | LOW        | ĐÃ VÁ một phần  | Cập nhật comment `tasks.module.ts`, `dashboard-widget-catalog.const.ts`, `dashboard-cache-invalidation.dto.ts`; ghi chú ở DEVOPS-13/15. Phần giữ: xem §8                                                                                              |

Kiểm sau vá: `tasks.permissions.spec` + `task-read-paths-scope.int-spec` (lane, 10 ca chạy thật) xanh 120/120; contracts build + typecheck api/FE xanh. Bộ đột biến chạy lại trên đầu mới: 16/16 đột biến bị giết (D1–D3 thêm lại handler: S1 danh sách dương + census route + R1–R3/R4 đỏ; D5a · D11a · D11b dừng ở assert tiền điều kiện `beforeAll`; còn lại như §5), 6 lượt nền xanh, cây sạch sau mỗi lượt.
