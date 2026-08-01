# S7-GOAL-PROJTAB-1 — Tab "Mục tiêu" trong trang dự án

> **Trạng thái:** plan, CHƯA thi công. Owner chốt 2026-08-01: làm **sau khi bấm xong G1..G10** của
> `RELEASE-10` (ngoài cửa sổ go-live). Xếp vào post-go-live backlog `RELEASE-14`.
>
> **Một câu:** trang dự án có thêm tab **Mục tiêu** trả lời hai câu hỏi — *dự án này phục vụ mục tiêu
> nào* và *việc thực tế trong dự án đã nối vào mục tiêu chưa*.

---

## 1. Vì sao làm — và vì sao rẻ

Module GOAL (SPEC-10) đã ship đủ vòng đo: cây mục tiêu, gắn/tháo việc, 4 chế độ đo, check-in, chốt kỳ.
Nhưng **đường đi hiện tại chỉ có một chiều**: từ mục tiêu → nhìn xuống việc (`GOAL-SCREEN-002` tab
"Công việc gắn"). Người quản lý dự án đứng ở trang dự án **không có đường nào** thấy dự án của mình
đang phục vụ mục tiêu nào, và càng không thấy việc nào trong dự án còn "mồ côi" — chưa nối vào mục tiêu
nào cả. Đó là chiều ngược lại, và nó là chiều người dùng đứng nhiều hơn.

Khảo sát code 2026-08-01 — **hạ tầng cần dùng đã có sẵn 100%, không cần migration, không cần quyền mới:**

| Thứ cần | Có sẵn ở |
| --- | --- |
| `tasks.goal_id` (FK + index `(company_id, goal_id) where goal_id is not null`) | mig `0505`, `schema/workflow.ts:441` |
| Lọc mục tiêu theo dự án `GET /goals?projectId=` | `goals.repository.ts:178` |
| Liệt kê / gắn bulk / tháo việc | `goal-tasks-link.service.ts` (GOAL-API-010) |
| Task DTO **đã kèm** `goalId`/`goalCode`/`goalName` ở cả list lẫn detail | `task-core.repository.ts:230` + `.mapper.ts:152` |
| % mục tiêu tự tính lại **cùng transaction** khi task đổi trạng thái | `task-actions.service.ts` → `recomputeForTaskTx` |
| Dialog chọn việc để gắn — **đã tự neo `projectId`** khi goal cấp `project` | `GoalTaskPickerDialog.tsx:57` |
| Thanh %, badge, bảng, empty/error | `apps/app/src/routes/goals/components/**` |

⇒ Phần mới thật sự chỉ có: **1 endpoint đếm** + **1 màn hình FE** + **1 prefill form**.

---

## 2. Màn hình

Tab thứ 8 của vỏ workspace dự án (`PROJECT_WORKSPACE_TABS`), khoá `goals`, nhãn "Mục tiêu",
deep-link `?tab=goals`.

```
┌─ Khối 1 · Mục tiêu của dự án (2) ─────────────────── [+ Tạo mục tiêu] ─┐
│ GOAL-0007  Tăng lượt xem kênh Q3      ▓▓▓▓▓░░ 62%   [đo: theo việc]    │
│ Owner: Nguyễn Văn Cảnh · Q3/2026 · Active     [Gắn việc]   [Mở →]      │
│ GOAL-0012  Ra mắt series mới          — chưa đo     [đo: nhập tay] 🔒  │
└───────────────────────────────────────────────────────────────────────┘
┌─ Khối 2 · Việc của dự án theo mục tiêu ───────────────────────────────┐
│ GOAL-0007  Tăng lượt xem kênh Q3                12 việc · 7 xong      │
│ GOAL-0031  Chuẩn hoá quy trình  (mục tiêu phòng) 3 việc · 1 xong      │
│ ⚠ Chưa gắn mục tiêu                             18 việc  [Gắn hàng loạt]│
└───────────────────────────────────────────────────────────────────────┘
```

**Khối 1 — mục tiêu *của* dự án.** `GET /goals?projectId=<id>` → goal `level='project'` neo đúng dự án
này. Mỗi dòng: mã, tên, owner, kỳ, `GoalProgressBar`, badge chế độ đo, badge trạng thái, khoá 🔒 nếu
đã chốt kỳ. Bấm dòng → `/goals/:id` (trang chi tiết đã có — KHÔNG dựng lại).

**Khối 2 — phủ mục tiêu của việc thực tế.** Gom **mọi** việc trong dự án theo `goal_id`, kể cả việc
đang trỏ tới mục tiêu **cấp phòng ban / cấp nhân viên** (khối 1 không thấy những mục tiêu này, nhưng
chúng vẫn đang ăn việc của dự án — bỏ sót là bức tranh sai). Dòng cuối là nhóm **chưa gắn** — đây mới
là giá trị chính của tab: nó chỉ ra chỗ công việc thực tế đang trôi ngoài mọi mục tiêu.

---

## 3. Lane thi công

### Lane 1 — BE: endpoint đếm phủ mục tiêu (crown-ish, FULL gate)

**Vì sao cần BE:** `GET /tasks` trần **200 dòng/trang và KHÔNG trả tổng số**
(`TASK_CORE_PAGE_LIMIT_MAX`, memory `apifetch-drops-pagination-bare-array`). Gom ở client ⇒ dự án
>200 việc cho số **sai mà không ai biết**. Owner chốt: đếm ở server.

```
GET /api/v1/goals/project-coverage?projectId=<uuid>
```

- **Đặt trong `GoalsController`**, khai **TRƯỚC** `@Get(':id')` — nếu không Nest sẽ khớp
  `:id='project-coverage'` (tiền lệ đã có: `@Get('tree')`).
- **HAI CỔNG, mirror `listLinkedTasks`:** `@RequirePermission('view','goal')` **VÀ** phạm vi đọc của
  cặp `('read','task')` áp bằng đúng `DataScopeService.resolveAndAssert` +
  `TaskCoreRepository.buildReadScopeExists`. **Đây là điểm dễ sai nhất của WO này:** đếm không áp
  scope ⇒ một Member thấy "18 việc chưa gắn" gồm cả việc họ không có quyền mở — rò rỉ *số lượng* và
  *cơ cấu* việc qua đường vòng (bài học `read-path-gate-pair-must-match-download-pair`).
- **Quyền đọc chính dự án:** `ProjectAccessService` (đã được inject sẵn ở `goal-tasks-link.service.ts`)
  — không xem được dự án thì không đếm được việc của nó.
- **`companyId` bắt buộc trong `withTenant`** + resolve `projectId` dưới tenant scope trước khi đếm:
  FK đơn cột không ép cùng-tenant (finding gate `S5-GOAL-DB-1`, và `0535` chỉ mới bịt phần lớn).

**Công thức đếm PHẢI trùng khít engine tính %** (`goal-progress-engine.repository.ts:72`), nếu không
màn hình tự mâu thuẫn với chính nó:

```sql
count(*)                                            as total,
count(*) filter (where tk.task_status = 'Done')     as done
where tk.deleted_at is null
  and tk.task_status is distinct from 'Cancelled'   -- việc đã huỷ KHÔNG nằm ở mẫu số
  -- KHÔNG lọc parent_task_id: engine đếm cả việc con đã gắn
```

Contract (`packages/contracts/src/goal.ts`, khối APPEND):

```ts
export const projectGoalCoverageSchema = z.object({
  goals: z.array(z.object({
    goalId: z.string().uuid(),
    goalCode: z.string(),
    goalName: z.string(),
    level: goalLevelSchema,          // để FE ghi rõ "mục tiêu phòng ban" / "của nhân viên"
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  })),
  unlinked: z.object({
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  }),
});
```

Một truy vấn `group by tk.goal_id` + `left join goals` — **KHÔNG N+1**, không vòng lặp gọi lại.

### Lane 2 — FE: `ProjectGoalsTab.tsx`

- Đăng ký khoá tab `goals` vào `PROJECT_WORKSPACE_TABS` (`workspace-constants.ts`) + nhãn i18n +
  nhánh render trong `ProjectDetailPage.tsx`.
- Gate hiện tab: `useCan('view','goal')` — cặp goal là `is_sensitive=false` nên **`useCan` là đủ,
  KHÔNG dùng `useCanExact`** (`GOAL_ENGINE_PAIRS` đã ghi rõ). Deep-link `?tab=goals` khi thiếu quyền →
  `EmptyState` forbidden tại chỗ, mirror tab report/activity.
- Nút **Gắn việc** dùng lại `GoalTaskPickerDialog` nguyên vẹn (nó tự neo `projectId` cho goal cấp
  project). Gate ghi = **hai cặp**: `('update','goal')` **VÀ** `('update','task')`
  (`TASK_UPDATE_PAIR_FOR_GOAL_LINK`) — thiếu cặp thứ hai thì hiện nút rồi ăn 403.
- **Cảnh báo mềm 200-kèm-`warnings[]` KHÔNG phải lỗi** (mục tiêu cấp phòng nhận việc lệch phòng là hợp
  lệ theo SPEC-10 §12): hiện vàng, KHÔNG hiện đỏ, KHÔNG rollback UI khi dữ liệu đã ghi.
- Mục tiêu **đã chốt kỳ** (`finalizedAt`) → mọi control ghi disabled (GOAL-ERR-005).
- `progressPercent === null` là **"chưa đo", KHÁC 0%** → render "—", không render thanh 0%.

### Lane 3 — FE nhỏ: prefill form tạo mục tiêu

`GoalFormPage` hiện **không đọc search param** (`defaultValues: EMPTY_GOAL_FORM`). Thêm đường
`/goals/new?level=project&projectId=<id>` để nút "+ Tạo mục tiêu" trong tab mở form đã chọn sẵn cấp +
dự án. Giá trị từ URL là **gợi ý, không phải quyền** — server vẫn validate GOAL-ERR-001/011/012.

### Lane 4 — Docs & governance

- `SPEC-10 §9`: thêm **`GOAL-SCREEN-007` — Tab Mục tiêu trong trang dự án**; `§15` thêm
  **`GOAL-API-014`** cho endpoint đếm.
- `SPEC-06 §13.3`: thêm tab thứ 8 vào danh sách tab của `TASK-SCREEN-003`, **trỏ chéo sang SPEC-10** —
  KHÔNG nhân bản rule GOAL sang SPEC-06 (chống drift).
- `RELEASE-14`: thêm dòng PGL cho WO này.

---

## 4. Bẫy đã nhận diện (đọc từ code, không phải phỏng đoán)

1. **Số của khối 2 ≠ % của mục tiêu — với mục tiêu cấp phòng/nhân viên.** Engine đếm việc gắn goal
   **ở mọi dự án**; khối 2 chỉ đếm trong dự án đang mở. Với goal cấp `project` hai số trùng nhau
   (GOAL-ERR-008 chặn gắn việc khác dự án), với goal cấp phòng thì **không**. ⇒ nhãn phải ghi rõ
   *"trong dự án này"*, nếu không màn hình tự mâu thuẫn và người dùng mất niềm tin vào cả hai con số.
2. **Gắn việc KHÔNG làm % tự tăng cho mọi chế độ đo.** Chỉ `progress_mode='tasks'` mới đếm việc;
   `manual` / `children` bỏ qua hoàn toàn; `project` soi gương tiến độ dự án. ⇒ badge chế độ đo là
   **bắt buộc**, và khi gắn việc vào mục tiêu `manual` phải nói trước "mục tiêu này đo bằng tay, gắn
   việc sẽ không đổi %".
3. **Thêm tab thứ 8 ⇒ người đã tự sắp thứ tự tab sẽ thấy "Mục tiêu" ở CUỐI.**
   `sanitizeWorkspaceTabOrder` cố ý nối tab mới vào đuôi để thứ tự đã lưu không nuốt mất tab. Đúng
   thiết kế — nhưng phải biết trước để không báo là lỗi.
4. **Đếm không áp data-scope = rò rỉ.** Xem lane 1. Đây là lý do WO này đi **FULL gate** dù trông như
   việc FE.
5. **`GET /goals?projectId=`** trả goal đã lọc theo scope của goal, nhưng **không** kèm tên dự án/owner
   dạng chuỗi — `ownerEmployeeId` là UUID. FE cần tên thì lấy từ đâu phải quyết trong lúc code (hoặc
   hiển thị theo dữ liệu có sẵn, hoặc BE bổ sung — **không** gọi thêm N request tên người).
6. **Route tĩnh phải khai trước route `:id`** — xem lane 1.

---

## 5. Definition of Done

- [ ] Test **RED trước** (deny-path): người có `view:goal` nhưng thiếu `update:task` → **không** thấy
      nút gắn/tháo; người ngoài phạm vi đọc dự án → 403 ở endpoint đếm; **số đếm của actor scope hẹp
      KHÁC số của admin trên cùng dự án** (bằng chứng scope thật sự được áp, không phải chỉ có mặt).
- [ ] Int-spec trên **DB cô lập** (`LANE_DB`) — cross-tenant: `projectId` của công ty khác → 404/403,
      KHÔNG trả số 0 im lặng.
- [ ] Unit test FE: 4 trạng thái (loading/error/empty/có dữ liệu) · goal chốt kỳ → nút disable ·
      `progressPercent=null` → "—" · warning 200 → vàng không đỏ.
- [ ] Tab ẩn đúng khi thiếu `view:goal`; deep-link `?tab=goals` → EmptyState forbidden.
- [ ] i18n `vi` đủ, không chuỗi cứng; không hard-code permission.
- [ ] FULL gate (`security-reviewer` + `silent-failure-hunter`) + LIGHT (`typescript-reviewer` +
      `react-reviewer` + `quality-gate`) PASS.
- [ ] Docs lane 4 xong; `harness/backlog.mjs` cập nhật.

---

## 6. Cái KHÔNG làm ở đợt này

- **Không** dựng lại trang chi tiết mục tiêu trong tab (bấm là sang `/goals/:id`).
- **Không** thêm chế độ đo mới, không đụng engine tính %.
- **Không** cho tạo/sửa mục tiêu cấp phòng ban từ trong tab dự án (sai ngữ cảnh sở hữu).
- **Không** phân rã template từ tab này (đã có `GOAL-SCREEN-004`).
