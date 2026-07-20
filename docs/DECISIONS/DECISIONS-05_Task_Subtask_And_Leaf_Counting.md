# DECISIONS-05: CÔNG VIỆC CON (SUBTASK) & ĐẾM-LÁ

> **📚 Bộ tài liệu DECISIONS — Hệ thống Quản lý Doanh nghiệp**
> **DECISIONS-05 Công việc con & đếm-lá** · (tiếp nối DECISIONS-01 Chốt câu hỏi mở · DECISIONS-02 Khoá stack & bất biến · DECISIONS-03 Cột Kanban & FSM · DECISIONS-04 Quyền per-project)
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Đặc tả: SPEC-06 TASK §14.21](<../SPEC/SPEC-06 TASK.md>) · [DB: DB-06 §4.16 · §7.4](<../DB/DB-06 TASK Database Design.md>) · [API: API-06 §13.7 · §13.8](<../API Design/API-06_TASK_API_Design.md>) · [DECISIONS-03 D-30 (công thức canonical MV)](<DECISIONS-03_Task_Pipeline_Column_And_FSM.md>) · [DECISIONS-04 D-24 (ma trận role×action)](<DECISIONS-04_Task_Per_Project_Role.md>) · [Kế hoạch thi công: S5-TASK-SUBTASK-1](<../plans/S5-TASK-SUBTASK-1.md>)

---

> ## ⚠️ ĐỌC TRƯỚC KHI THÊM BẤT KỲ WRITER NÀO CHO BẢNG `tasks`
>
> **Bài học xuyên suốt 3 vòng review đối kháng của đợt này:** ba bất biến của WO này — `state_id` của việc con là NULL (D-36) · cây luôn cùng một dự án (D-36a) · cây đúng 1 cấp (D-33) — **KHÔNG được phát biểu như tính chất của DỮ LIỆU rồi thôi**. Một bất biến chỉ sống nếu **liệt kê CHO HẾT các WRITER có thể phá nó**, và **chốt ở PHƯƠNG THỨC DÙNG CHUNG** chứ không rải điều kiện ở từng route.
>
> Cả ba vòng review đều tìm ra lỗi **cùng một họ** này, mỗi vòng một writer khác nhau:
>
> | Vòng | Writer bị bỏ sót | Hậu quả nếu để nguyên |
> | --- | --- | --- |
> | 1 | `syncStateWithStatusTx` | đánh dấu việc con "Done" ⇒ nó **ghi lại `state_id`** ⇒ con nhảy lên board |
> | 2 | `applyStateChangeTx` (dùng chung cho `POST /move-state` **và** `PATCH {stateId}`) | hai route vẫn set được `state_id` cho việc con |
> | 3 | `updateTask` nhánh `dto.projectId` | cha sang dự án khác, con ở lại ⇒ **việc sống mà tàng hình ở CẢ HAI dự án** |
>
> Cả ba đều là writer **đã tồn tại từ trước**, không phải code mới của WO này — nên đọc diff của WO sẽ không thấy chúng. Ai thêm route mới, service mới, hay bất kỳ đường ghi nào lên `tasks` sau này **PHẢI đối chiếu lại D-33 · D-36 · D-36a** và tự trả lời: *"đường ghi của tôi có phá được ba bất biến đó không, và chốt của tôi nằm ở method dùng chung hay ở route?"*

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                                              |
| ------------- | --------------------------------------------------------------------- |
| Mã tài liệu   | DECISIONS-05                                                           |
| Tên tài liệu  | Công việc con (subtask) 1 cấp & quy tắc đếm-lá cho dashboard/báo cáo   |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ                                   |
| Tên sản phẩm  | Enterprise Management System                                           |
| Phiên bản     | v1.0                                                                   |
| Trạng thái    | 12 quyết định đề xuất — **D-31 (đóng SPEC-06 §24 Q#14) · D-40 cần OWNER-CONFIRM tại PR** |
| Giai đoạn     | Sprint 5 — đợt subtask chuỗi redesign TASK (sau A #234-241 · B #242 · D1 #243 · detail #245 · dashfix #246) |
| Ngày tạo      | 20/07/2026                                                             |
| Ngày cập nhật | 20/07/2026                                                             |
| Người duyệt   | Cian (Product Owner) — chốt khi merge PR (crown)                       |

---

## 2. Bối cảnh

Product Owner chốt 18/07/2026 (chuẩn tham chiếu MISA AMIS): **"Mỗi dòng công việc con phải có người thực hiện và hạn riêng"** — tức việc con là **công việc thật**, không phải một dòng checklist. Kèm theo là quyết định về CON SỐ: *"công việc có việc con thì đếm theo việc con"* (đếm-lá).

Hai vế này độc lập về kỹ thuật nhưng phải đi cùng một đợt: mở CRUD việc con mà không đổi cách đếm sẽ làm mọi con số trên dashboard và báo cáo dự án **đếm trùng** (cha + con), tức tự tạo ra lỗi số liệu ngay trong đợt sinh ra tính năng.

### 2.1 Hiện trạng đã kiểm chứng (20/07/2026)

| Hạ tầng | Trạng thái | Vị trí |
| --- | --- | --- |
| Cột `tasks.parent_task_id` + CHECK không tự làm cha chính mình | ✅ có, **chưa ai dùng** | mig `0478:327`, CHECK `0478:368` |
| Board đã lọc `parent_task_id IS NULL` | ✅ có (ship đợt A) | `task-core.repository.ts:278`, bật tại `task-kanban.service.ts:84` |
| FK `parent_task_id → tasks(id)` mang `company_id` | ❌ **không** — RI check của Postgres bỏ qua RLS ⇒ hiện chỉ app-check giữ | mig `0478:327` |
| Index phục vụ vị từ cha/con | ❌ không — FK không được Postgres tự index | — |
| `mv_dashboard_task_status` đếm theo công thức canonical D-30 | ✅ vừa ship | mig `0502` |
| Báo cáo dự án (`countsByStatus` · `overdueCount` · `assigneeWorkload`) | ⚠️ đếm THÔ mọi task | `projects.repository.ts:804/818/830` |
| Widget dashboard `project-progress` | ⚠️ đếm trong bộ nhớ, **âm thầm cắt ở 200 hàng** | `dashboard-widget-handlers.service.ts:396-419` |
| Checklist (`checklist_items`: title/is_done/done_by/done_at/order_index) | ✅ có, badge riêng (PR #207) | `task-checklists.repository.ts` |

⇒ `parent_task_id` là hạ tầng **nằm ngủ**: cột có, CHECK có, board đã lọc sẵn — nhưng chưa một đường ghi nào tạo ra việc con, và chưa một đường đọc nào biết tới khái niệm "lá". Đợt này bật nó lên.

---

## 3. Chi tiết các quyết định

### D-31 — Mô hình: việc con là TASK THẬT, đúng 1 cấp ⚠️ OWNER-CONFIRM

- **Câu hỏi:** Hiện thực "công việc con" bằng cách mở rộng `checklist_items` (thêm assignee + hạn) hay bằng task thật trên `tasks.parent_task_id`? Và cho phép mấy tầng?
- **Quyết định:** **Task thật** trên `tasks.parent_task_id`, **độ sâu ĐÚNG 1 CẤP**. Task được chọn làm cha PHẢI có `parent_task_id IS NULL`.
- **Lý do:**
  - Owner chốt 18/07: mỗi dòng con có **người thực hiện + hạn riêng** — đó là định nghĩa của một task, không phải của một dòng checklist. `checklist_items` chỉ mang `title/is_done/done_by/done_at/order_index`; nhét assignee + deadline + trạng thái vào đó là dựng lại bảng `tasks` bên trong bảng checklist.
  - **1 cấp:** ảnh chuẩn tham chiếu chỉ 1 cấp; đa cấp kéo theo rollup **đệ quy** cho MỌI con số (đếm-lá, %, quá hạn) — không tương xứng nhu cầu đã biết (YAGNI).
- **Kéo theo — checklist GIỮ NGUYÊN, KHÔNG gộp:** `checklistDone`/`checklistTotal` (PR #207) vẫn là badge **riêng, độc lập**. Hai khái niệm khác nhau: *checklist* = hạng mục con trong đầu MỘT người; *subtask* = việc có chủ + hạn riêng. Không thay cái này bằng cái kia.
- **Đóng câu hỏi mở SPEC-06 §24 Q#14** (*"Có cần hỗ trợ sub-task trong MVP không, hay checklist là đủ?"*) ⇒ **CÓ subtask, checklist giữ song song**.
- **Đây là quyết định sản phẩm** (mở một khái niệm mới trong MVP) ⇒ **OWNER-CONFIRM tại PR**: owner phê duyệt khi chốt merge (crown luôn cần người chốt).

### D-32 — Hai vị từ "con", đặt tên tường minh

- **Câu hỏi:** "Task này có con" nghĩa là gì — có tính con đã huỷ không?
- **Quyết định:** **HAI vị từ khác nhau, có tên riêng**. Đây là nguồn nhầm lẫn số 1 của WO này; mọi nơi trong code PHẢI dùng đúng tên và có comment trỏ D-32.

| Tên | Định nghĩa | Dùng ở đâu |
| --- | --- | --- |
| `ACTIVE_CHILD` (**CẤU TRÚC**) | con `deleted_at IS NULL`, **MỌI trạng thái kể cả `Cancelled`** | xoá lan (D-38) · luật độ sâu (d) của D-33 · câu hỏi "task này có phải là cha không" |
| `COUNTABLE_CHILD` (**ĐẾM**) | `ACTIVE_CHILD` **và** `task_status IS DISTINCT FROM 'Cancelled'` | định nghĩa "lá" (D-34) · mẫu số tiến độ · rail avatar (D-40) |

- **Vì sao PHẢI tách (cả hai chiều đều hỏng nếu hợp nhất):**
  - Nếu "lá" dùng `ACTIVE_CHILD`: một task cha đang `Todo` & **quá hạn** mà có ĐÚNG 1 con đã `Cancelled` sẽ **rớt khỏi** `countsByStatus`/`overdueCount`/`assigneeWorkload` ⇒ dự án hiện *"0 việc phải làm, 0 quá hạn"* trong khi cha vẫn sống và trễ hạn. **Việc đã huỷ không được phép che khuất việc còn sống.**
  - Nếu xoá-lan/độ-sâu dùng `COUNTABLE_CHILD`: con `Cancelled` thành **mồ côi** khi xoá cha, và cây lên được **3 tầng** (task có con Cancelled vẫn được gán làm con).
- **Ghi cho người sau:** hai vị từ là **BẮT BUỘC, không phải trùng lặp**. Cả hai được pin bằng test — đừng "hợp nhất cho gọn".

### D-33 — Chống chu trình + bất biến cây: 4 luật **CỘNG KHOÁ HÀNG**

- **Câu hỏi:** Kiểm gì khi gán `parentTaskId = P` cho task T, và kiểm như thế là đủ chưa?
- **Quyết định — 4 luật, kiểm trong CÙNG tx, **SAU khi đã khoá**:**
  1. **(a)** `P ≠ T` — DB đã có CHECK (`0478:368`), BE vẫn kiểm để trả 400 sạch thay vì `23514` raw.
  2. **(b)** P tồn tại, **cùng company**, `deleted_at IS NULL`.
  3. **(c)** `P.parent_task_id IS NULL` (P là gốc) — chặn tầng 3.
  4. **(d)** T **KHÔNG có `ACTIVE_CHILD`** nào — task đang làm cha thì không được thành con. *(chỉ áp cho `update`)*
- **⚠️ KHOÁ LÀ MỘT PHẦN CỦA BẤT BIẾN, KHÔNG PHẢI TỐI ƯU HIỆU NĂNG.** Dưới `READ COMMITTED`, 4 luật kiểm-rồi-ghi **không serialize**. Ví dụ thật: `PATCH A {parent:B}` ‖ `PATCH B {parent:A}` — cả hai cùng thấy đối phương là gốc và chưa có con ⇒ commit cả hai ⇒ **CHU TRÌNH A↔B**. Tương tự: tạo con C dưới P ‖ gán `P.parent = Q` ⇒ **3 tầng**.

#### Luật khoá — MỘT luật duy nhất cho toàn WO, KHÔNG có ngoại lệ theo đường

Khoá bằng **MỘT** câu:

```sql
SELECT id FROM tasks
 WHERE company_id = $1 AND id = ANY($2)
 ORDER BY id
   FOR UPDATE
```

trong đó `$2` = **TOÀN BỘ tập hàng mà thao tác sẽ chạm**; **đọc lại sau khoá** rồi mới kiểm (a)(b)(c)(d). `ORDER BY id` là **thứ tự khoá TOÀN CỤC**.

| Đường | Tập hàng phải khoá (bỏ phần tử NULL) |
| --- | --- |
| `create` có `parentTaskId` | `{P}` |
| `update parentTaskId` | `{oldP, T, newP}` — **`oldP` BẮT BUỘC CÓ** |
| `update projectId` của task CÓ con | `{T}` — xem D-36a |
| `delete` CHA | đọc con TRƯỚC (không khoá) → khoá `{P} ∪ children` → **đọc lại tập con sau khoá**; tập đổi ⇒ làm lại ĐÚNG MỘT lần, còn lệch ⇒ **409** (fail-closed) |
| `delete` CON (task là lá) | `{T}` — đã kiểm: không bất biến nào đòi khoá thêm cha. Ghi ra để không hiểu nhầm thành "xoá con thì bỏ qua khoá", cũng không over-lock |
| `reorder` | `{P} ∪ children`, cùng khuôn `delete` cha |

- **⚠️ VÌ SAO PHẢI CÓ `oldP`** (lỗ hổng thật, không phải lý thuyết): `DELETE oldP` khoá `oldP` rồi đọc con → thấy T. Song song `PATCH T {parent:newP}` chỉ khoá `{T, newP}`, **không đụng `oldP`** ⇒ commit trước. Delete sau đó soft-delete từng con `where id = T` — T vẫn tồn tại, `deleted_at` còn NULL ⇒ **T bị xoá lan dù đã là con của `newP`**. Con sống của một cha không liên quan biến mất, **câm**.
- **⚠️ VÌ SAO PHẢI LÀ id-TĂNG-DẦN TOÀN CỤC, không phải "cha trước":** "cha trước" gây **ABBA** với `PATCH A{parent:B}` ‖ `PATCH B{parent:A}` (mỗi bên giữ gốc của mình); và "cha trước" ở `delete` trộn với "id tăng dần" ở `update` cũng ABBA (delete giữ cha-id-cao xin con-id-thấp; update giữ con-id-thấp xin cha-id-cao). **Một luật cho mọi đường mới thoát.**
- **Kỹ thuật:** giữ **ĐÚNG MỘT** câu `SELECT ... ORDER BY id FOR UPDATE`, KHÔNG tách thành nhiều lệnh khoá lẻ — node `LockRows` nằm **trên** `Sort` nên hàng được khoá đúng thứ tự đã sắp; tách ra là mất bảo đảm thứ tự.
- **Idiom `FOR UPDATE` của repo** (dùng lại, đừng phát minh): `attendance-adjustment.repository.ts:105-108` — khoá **trên MỘT bảng duy nhất, KHÔNG JOIN** (*"a joined FOR UPDATE would lock the employee/user rows too and can surprise"*). Câu khoá của WO này vì thế chỉ `FROM tasks`, không join `projects`/`employee_profiles`/`users`.
- **Về nhánh 409 — giữ nhưng ĐỪNG đòi test:** một khi đã giữ khoá trên P thì **tập con bị đóng băng** (mọi writer thêm/bớt con đều buộc phải khoá P trước: `create` khoá `{P}`; `update` khoá `{oldP,T,newP}` ⇒ luôn chạm P). Tập con do đó chỉ đổi được **đúng một lần** — giữa lần đọc-không-khoá và lúc lấy được khoá — nên lần đọc lại thứ hai không thể lệch nữa. ⇒ nhánh 409 là **không-với-tới-được theo thiết kế**: giữ nó (fail-closed đúng đắn) + comment *"defensive, unreachable khi luật khoá còn nguyên"* để reviewer sau không xoá như dead code, nhưng **không viết test** cho nó (không dựng được một cách xác định). **Nếu nó bắn thật ⇒ tín hiệu luật khoá đã bị phá.**
- **Hai điều kiện vận hành kèm theo:**
  1. Mọi `UPDATE` mang vị từ cấu trúc (`parent_task_id = $parent`) phải **ASSERT SỐ HÀNG ẢNH HƯỞNG** đúng kỳ vọng; lệch ⇒ **rollback** (không im lặng ghi thiếu).
  2. Map lỗi `40P01` (deadlock) / `40001` (serialization) thành **409 retry-able**, KHÔNG để rơi ra 500 raw.
- **Ghi chú cơ chế:** khuôn "đọc lại sau khoá" đã có ở `task-core.service.ts:493-502` — nhưng ở đó khoá đến từ **UPDATE ngầm** (`:490`), KHÔNG phải `FOR UPDATE` tường minh. WO này khoá hàng **CHA** vốn không bị UPDATE ⇒ **bắt buộc `SELECT ... FOR UPDATE` tường minh**; copy nguyên cơ chế của `:490` là **không khoá gì cả**.
- **💣 MÌN TƯƠNG LAI — ghi lại vì rẻ và chặn đúng loại lỗi repo đã dính nhiều lần:** luật (d) dùng `ACTIVE_CHILD` (`deleted_at IS NULL`) ⇒ task có con **ĐÃ XOÁ** vẫn được gán làm con. Hôm nay vô hại vì **không có route khôi phục task**. **Bất kỳ route khôi phục nào trong tương lai PHẢI kiểm lại D-33 trước khi bỏ `deleted_at`** — nếu không, khôi phục một con cũ sẽ sinh cây 3 tầng.
- **Hệ quả:** khoá cha cũng chính là thứ đóng **PHANTOM** của D-38 (con mới được chèn sau lúc `SELECT` của xoá-lan).

### D-34 — Đếm-lá: con số trên dashboard/báo cáo tính theo LÁ

- **Câu hỏi:** Task cha có việc con thì đếm cha, đếm con, hay đếm cả hai?
- **Quyết định (owner chốt 18/07, ràng buộc cứng):** **"Lá"** = task `deleted_at IS NULL` **và KHÔNG có `COUNTABLE_CHILD`** (D-32). Task không con ⇒ chính nó là lá.
- **Áp cho ĐÚNG 3 nơi — cả ba PHẢI dùng CÙNG một vị từ, CÙNG một release:**
  1. MV `mv_dashboard_task_status` (mig `0503`);
  2. Báo cáo dự án: `countsByStatus` · `overdueCount` · `assigneeWorkload` (`projects.repository.ts:804/818/830`);
  3. Widget dashboard `project-progress` (`dashboard-widget-handlers.service.ts:396-419`) — xem D-35.
- **KHÔNG áp cho:** board (quy tắc riêng D-36) · "Việc của tôi" · "Việc quá hạn" · ME summary · alerts · job nhắc hạn (D-37).
- **Lệch pha giữa 3 nơi ⇒ hai con số khác nhau trên CÙNG một màn hình** — đúng loại lỗi WO này sinh ra để tránh. Đây là lý do ba lane phải cùng một PR.

#### Hệ quả ĐÃ BIẾT và CHẤP NHẬN (owner xác nhận — ghi vào ADR + ghi chú UI, KHÔNG phải bug)

1. **Tổng nhảy KHÔNG đều:** thêm con **ĐẦU TIÊN** vào task chưa có con ⇒ tổng **KHÔNG đổi** (cha rời tập lá, con vào thay). Con **THỨ HAI** mới +1.
2. **Board ≠ báo cáo** trên cùng một dự án: board chỉ hiện cha, báo cáo chỉ đếm lá.
3. **`assigneeWorkload`:** người **CHỈ ôm task cha** (mọi con giao người khác) **tụt về 0** trên biểu đồ tải — đúng theo đếm-lá, nhưng phản trực giác ⇒ **bắt buộc** có ghi chú UI + test pin.
4. **HUỶ VIỆC CON CUỐI CÙNG LÀM TỔNG TĂNG 1.** Hệ quả trực tiếp của D-32, kiểm bằng số học:

   | Bước | Trạng thái | Tập lá | Tổng |
   | --- | --- | --- | --- |
   | đầu | P có C1(Todo) + C2(Todo) | {C1, C2} | 2 |
   | huỷ C1 | P còn COUNTABLE_CHILD là C2 | {C1, C2} | 2 |
   | huỷ nốt C2 | P hết COUNTABLE_CHILD ⇒ **P quay lại làm lá** | {P, C1, C2} | **3** |

   Huỷ một việc mà tổng số việc **tăng**. **CHẤP NHẬN** vì trạng thái cuối là ĐÚNG: mọi con đã huỷ ⇒ P lại là việc thật phải làm, phải được đếm. Phương án thay thế (lá tính theo `ACTIVE_CHILD`) cho trạng thái cuối **SAI**: P sống và quá hạn nhưng **tàng hình**. Chuỗi 2→2→3 được pin bằng test có comment trỏ ADR — kẻo người sau vá như bug.

### D-35 — Widget `project-progress` dùng CHUNG công thức, KHÔNG dùng chung method

- **Bối cảnh:** `fetchProjectProgress` hiện tự đếm trong bộ nhớ từ `tasks.listByProject(..., {limit: 200})` — không lọc parent **và** âm thầm cắt ở 200 hàng. Sau `0503`, cùng MỘT màn dashboard sẽ hiện **hai con số khác nhau** cho cùng một dự án (widget `task-status` đếm lá vs `project-progress` đếm thô).
- **Quyết định: CHIA SẺ VỊ TỪ, KHÔNG CHIA SẺ METHOD.** Widget **TUYỆT ĐỐI KHÔNG** gọi `aggregateReportTx`. Thay vào đó khai một method **hẹp riêng** `countsByStatusLeafTx(tx, companyId, projectId)` trả **đúng** `byStatus` theo lá, dùng **chung hàm vị từ** `isLeaf('tk')` với `aggregateReportTx` và với `0503`.
- **Lý do — đây là một ranh giới QUYỀN đã ghi thành văn, đã xác minh trên code:**
  - widget `PROJECT_PROGRESS` gate `('read','project')` — **NON-sensitive** (`dashboard-widget-catalog.const.ts:246`);
  - route report gate `('view-report','project')` — **`isSensitive: true`** (`projects.controller.ts:186`);
  - `projects.service.ts:641-653` ghi tường minh: *"dùng SCOPE của `view-report:project` (SENSITIVE) — KHÔNG mượn `read:project`"*, để người có `view-report@Team` chỉ báo cáo được project team dù `read@Company`.

  Gọi thẳng `aggregateReportTx` từ widget ⇒ `assigneeWorkload` kèm `employeeName` (**PII**) và `overdueCount` bị fetch vào một đường gate `read:project` rồi vứt đi — cách đúng một lần refactor là thành rò thật.

  > **Đính chính để lập luận không tự mâu thuẫn (finding FULL-gate):** phần *"chia sẻ method làm gate SENSITIVE thành trang trí"* chỉ đúng **một nửa**. Vì `aggregateReportTx` cũng đếm toàn dự án không lọc theo actor, nên chia sẻ **vị từ** cho ra con số `byStatus` **y hệt** con số nằm sau `view-report:project`. Cái mà phương án này thật sự giữ lại **không phải là con số**, mà là **PII + `overdueCount`**. Nói cho đúng: *widget giữ kín PII, không giữ kín số đếm.* Nếu owner muốn số đếm cũng phải SENSITIVE thì phải **nâng gate widget** — xem câu hỏi mở §7.2.
- **Ghi thẳng để về sau không ai tranh cãi:** sau D-35, `byStatus` trở nên **suy ra được chính xác** dưới `read:project`. Ranh giới SENSITIVE của route report từ nay chỉ còn bảo vệ `overdueCount` + `assigneeWorkload` (PII). Nếu owner thấy `byStatus` PHẢI sensitive thì đó là **quyết định nâng gate widget**, phải **OWNER-CONFIRM** — **không sửa ngầm trong lane**.
- **Docblock bắt buộc** trên `countsByStatusLeafTx` (bài học *reused-method-must-be-actor-scoped*): *"KHÔNG tự scope theo actor — CHỈ gọi SAU khi đã authorize project"*. `getProject` ở `dashboard-widget-handlers.service.ts:386` là thứ **DUY NHẤT** giữ scope cho đường widget; bước authorize project TRƯỚC (`:385`) phải giữ nguyên — `listByProject` chỉ tenant-guard, bỏ là **mở IDOR**.
- **Hệ quả kéo theo (không im lặng):**
  - Hình dạng `byStatus` của widget **đổi thật**: mất key `"Unknown"` (task_status NULL nay coalesce về `Todo`), luôn trả **đủ 5 key kể cả 0**, `total` **tự dẫn xuất = tổng 5 key LÁ** (không còn là `rows.length`), `status:"Empty"` đổi nghĩa thành *"0 task LÁ"*.
  - **CACHE — CHỦ ĐÍCH KHÔNG THÊM ENTRY, kèm lý do (điều kiện của plan):** `DASH_CACHE_INVALIDATION_MAP` hiện chỉ map `TASK_STATUS_CHANGED → PROJECT_PROGRESS`. Tạo/xoá/đổi-cha một việc con **có** làm số đếm-lá đổi, nên về nguyên tắc cần wipe cache. **Không thêm** vì map đó ăn theo **event outbox**, mà `TaskCoreService` hiện **không enqueue outbox nào** cho create/update/delete task (`grep outbox` → 0 hit ở file đó) ⇒ thêm entry là **cấu hình chết**, tạo ảo giác đã xử lý. Hệ quả chấp nhận: widget `project-progress` có thể hiện số cũ **tối đa `DASH_WIDGET_TTL_SECONDS.TASK` = 60 giây** sau khi thêm/xoá việc con. Đường đúng là bổ sung producer outbox cho vòng đời task — **WO riêng**, không nhét vào WO này.
  - Việc này đồng thời **bỏ cái cắt-200-âm-thầm** có sẵn (dự án >200 task đang báo % sai) — sửa kèm **có chủ đích**.
  - **Cache invalidation:** `dashboard-cache-invalidation.const.ts` hiện chỉ map `TASK_STATUS_CHANGED → PROJECT_PROGRESS`. Tạo con · xoá con · đổi cha đều đổi số đếm-lá ⇒ phải **APPEND** thêm `TASK_CREATED`/`TASK_DELETED`/`TASK_UPDATED` vào map (hot-file: append, không rewrite; tránh entry quét sạch mọi widget). Không làm thì widget đứng số cũ tới hết TTL — đúng vào WO mà cả mục tiêu là "một con số".

### D-36 — Việc con ẨN khỏi board, `state_id` ép NULL **và GIỮ NULL**

- **Câu hỏi:** Việc con có thành thẻ trên board không, và `state_id` của nó mang giá trị gì?
- **Quyết định:** **Không lên board. `state_id` của việc con = NULL và phải GIỮ NULL.**
  - Board đã lọc sẵn `parent_task_id IS NULL` từ đợt A (`task-core.repository.ts:278`) — **CẤM GỠ**.
  - Đã ẩn khỏi board thì cột pipeline **không mang nghĩa**; để `state_id` sống trên việc con là **mời desync D-20/D-21 quay lại qua cửa sau**.
  - Tab **"Danh sách"** của vỏ workspace dự án **cũng chỉ hiện cha** (parity Bảng↔Danh sách đã ship đợt D1 — hai tab lọc qua cùng helper).
  - Việc con **BẮT BUỘC cùng dự án với cha** (cả hai NULL cũng hợp lệ) — chặn ở BE **400**.
- **⚠️ ÉP LÚC TẠO LÀ CHƯA ĐỦ — phải QUÉT HẾT WRITER của `state_id`** (đây chính là bài học ở đầu tài liệu). Hai writer đã tồn tại từ trước:

  | Writer | Vì sao lọt | Chốt |
  | --- | --- | --- |
  | `syncStateWithStatusTx` (`task-actions.service.ts:242`, thân `:669-684`) | chạy trên **MỌI** lần đổi trạng thái, chỉ early-return khi `projectId === null`. Việc con bắt buộc cùng project với cha ⇒ `projectId ≠ NULL` ⇒ đánh dấu con **"Done"** (chính là luồng cốt lõi của D-34) sẽ **ghi lại `state_id`** ⇒ con nhảy lên board | early-return khi task có `parent_task_id` |
  | `applyStateChangeTx` (`task-core.service.ts:462-539`) — method **DÙNG CHUNG** của CẢ `POST /tasks/:id/move-state` (TASK-API-213) LẪN `PATCH /tasks/:id {stateId}` (`:355-358`) | chỉ từ chối khi `!projectId` (`:471`); việc con CÓ `projectId` ⇒ **cả hai route** vẫn set được `state_id` | thêm điều kiện đầu: `parent_task_id IS NOT NULL` ⇒ **400** (tái dùng `STATE_INVALID`) |

- **Chốt ở METHOD DÙNG CHUNG, không vá ở route** — một chốt trong `applyStateChangeTx` phủ **cả hai** route. Kỹ thuật: thêm `parentTaskId` vào `findRawByIdTx` (`task-core.repository.ts:315-332`) **cùng lượt** với việc thêm `parentTaskId` vào `findStateSyncRowTx`.
- **Nghiệm thu phải kiểm `state_id` SAU KHI ĐỔI TRẠNG THÁI**, không chỉ lúc tạo — test chỉ-kiểm-lúc-tạo là **xanh giả**.
- **Đường ghi `state_id` không được mở thêm:** `TaskCorePatchValues` không có `stateId`, và `setTaskStateTx` mang ràng buộc tường minh *"CHỈ được gọi từ `applyStateChangeTx` — KHÔNG nối route mới vào writer này (R9)"*. Việc gỡ `state_id` của một task khi nó thành con đi qua **writer hẹp riêng** `clearTaskStateForSubtaskTx` (chỉ `set state_id = null where ... and parent_task_id is not null`), kèm docblock nói rõ đây **không phải state-change nghiệp vụ** mà là hệ quả cơ học của D-36.
- **Không để thẻ biến mất CÂM:** thẻ rời board là thay đổi người dùng nhìn thấy ⇒ dòng activity `TASK_UPDATED` của lần đổi cha PHẢI mang **cả `parentTaskId` và `stateId` ở old/new** (một dòng mô tả cả hai, KHÔNG thêm action code mới) để timeline (#245) dựng được dòng cũ→mới.
- **Gỡ cha ⇒ `state_id` VẪN NULL:** task thành gốc **không cột**, người dùng kéo vào cột sau bằng `move-state`. **Không tự đoán cột mặc định** — auto-map là cửa desync.

### D-36a — Dự án của cây là bất biến, và `PATCH {projectId}` là writer phá được nó **mà không cần đồng thời**

- **Bối cảnh:** `updateTask` hiện gán tự do (`task-core.service.ts:324`: `if (dto.projectId !== undefined) patch.projectId = dto.projectId`). **Ba đường** vỡ D-36:
  1. **tuần tự:** `PATCH P {projectId:X}` khi P có `ACTIVE_CHILD` ⇒ cha sang dự án X, con ở lại dự án cũ;
  2. **chiều ngược:** `PATCH C {projectId:X}` khi C là con ⇒ con lệch dự án cha;
  3. **đồng thời:** `PATCH C {parent:P}` (kiểm cùng-project ✓ lúc đó) ‖ `PATCH P {projectId:X}` — đường sau **không có trong bảng tập khoá** nên không khoá gì ⇒ lọt **kể cả khi luật khoá cài đúng**.
- **Hậu quả — đúng thứ WO này dựng lên để tránh:** báo cáo lọc theo `project_id` (`projects.repository.ts:804/818/830`). Cha ở dự án X vẫn có `COUNTABLE_CHILD` (con trỏ cha qua `parent_task_id`, **không quan tâm project**) ⇒ cha **không phải lá** ở X, còn con là lá ở dự án **CŨ** ⇒ **cha sống, có thể quá hạn, và TÀNG HÌNH ở CẢ HAI dự án** — đúng lỗi "việc sống bị che" mà hệ quả #4 của D-32 vừa lập luận để tránh.
- **Quyết định (YAGNI, KHÔNG cascade):**
  1. T có `ACTIVE_CHILD` **và** `dto.projectId` đổi ⇒ **400**, thông điệp *"gỡ việc con ra trước khi chuyển dự án"*;
  2. T có `parent_task_id IS NOT NULL` ⇒ **cấm đổi `projectId` riêng, 400** (dự án của con do cha quyết).
- **Vì sao không cascade `projectId` xuống con:** nó kéo theo cả `state_id` của cha lẫn con và mở thêm một tập khoá nữa, cho **ít giá trị thật**.
- **Tập khoá:** đã chọn 400 (không cascade) nên **`{T}` là ĐỦ** — giữ khoá T chặn được mọi `create`-child đồng thời (`create` khoá `{P}` = `{T}`).

### D-37 — Danh sách ≠ con số

- **Câu hỏi:** Các màn hình **danh sách việc phải làm** có áp đếm-lá không?
- **Quyết định: KHÔNG.** "Việc của tôi" và "Việc quá hạn" hiện **CẢ cha lẫn con** (owner chốt: việc quá hạn **có** tính con) vì đó là **danh sách việc phải xử lý**; còn **CON SỐ** trên dashboard/báo cáo dùng đếm-lá (D-34).
- **Hệ quả chấp nhận:** người dùng **có thể thấy dashboard 12 mà danh sách 15**. ⇒ **BẮT BUỘC** ghi chú trong UI + SPEC.
- **ME summary** (`me-aggregation.service.ts:256-269`) đi qua `getMyTasks` ⇒ cũng là worklist cá nhân, **GIỮ NGUYÊN**.
- **Ghi tường minh** để reviewer không tưởng là sót: mỗi nơi không đổi (`findMyTasksTx` · `me-aggregation` · `alerts.service` · `task-reminder.job-handler` · board) phải có **một dòng comment trỏ D-37**.

### D-38 — Xoá cha ⇒ xoá lan xuống con, TẤT-CẢ-HOẶC-KHÔNG

- **Câu hỏi:** Xoá task cha thì con ra sao — chặn, để mồ côi, hay xoá theo?
- **Quyết định (owner chốt):** **xoá lan xuống con**, soft-delete (BẤT BIẾN #2), **CÙNG 1 tx**, **tất-cả-hoặc-không**.
  - Khoá cha `FOR UPDATE` theo D-33 → nạp **toàn bộ `ACTIVE_CHILD`** (D-32 — **kể cả `Cancelled`**, nếu không con Cancelled thành mồ côi);
  - kiểm quyền **GHI** từng con; có **≥1 con ngoài phạm vi ghi** ⇒ **403** và **KHÔNG xoá gì cả**;
  - con workflow-driven (không nên tồn tại, fail-closed) ⇒ **400**, không xoá gì;
  - qua hết ⇒ soft-delete **con TRƯỚC rồi cha**, mỗi con 1 activity + 1 audit (append-only).
- **⚠️ HAI PHÉP KIỂM KHÁC NHAU, KHÔNG ĐƯỢC LẪN:**

  | Việc | Dùng phép kiểm |
  | --- | --- |
  | Quyết định **CHẶN** | `checkTaskInScopeTx(mode:'write')` |
  | **Danh sách trả về** trong payload lỗi | quy tắc **ĐỌC** của D-39 |

  Dùng nhầm một lời gọi ⇒ hoặc `blocked[]` **luôn rỗng** (vô dụng, hỏng câm), hoặc **chặn theo quyền ĐỌC** (con đọc-được-nhưng-không-ghi-được bị xoá oan). **Hai test riêng cho hai vế.**
- **Payload 403:** `{ blockedCount, blocked: [{ id, taskCode, title }] }` — mã lỗi `TASK-ERR-047`.
- **Kéo theo kỹ thuật:** `ProjectAccessService.assertTaskInScopeTx` hiện **NÉM 404**, còn D-38 cần một **vị từ boolean**. Thêm `checkTaskInScopeTx(..., mode): Promise<boolean>` và viết lại `assert` = `check` + `throw` — **MỘT nguồn logic, không copy** (copy là chỗ hai đường quyền trôi khỏi nhau).

### D-39 — Phạm vi ĐỌC của con: đọc được cha ⇒ đọc được toàn bộ con

- **Câu hỏi:** Danh sách việc con có lọc theo read-scope của từng con không?
- **Quyết định: KHÔNG lọc — đọc được cha là đọc được toàn bộ con.** Đây là quyết định **có chủ đích**, không phải bỏ sót.
- **Lý do:** việc con là **phần cấu trúc của cha**, không phải đối tượng độc lập. Nếu lọc read-scope từng con thì `subtaskDone/subtaskTotal` (D-34) sẽ **không khớp** danh sách người dùng nhìn thấy (*"2/5" nhưng chỉ liệt kê 3 dòng*) — % mất nghĩa và **trông như bug**.
- **PHẠM VI LỘ RA — chốt DTO HẸP (phương án (i)).** Route `GET /tasks/:taskId/subtasks` trả **DTO hẹp riêng**, đúng tập field cần cho panel:

  `id` · `taskCode` · `title` · `status` · `priority` · `mainAssigneeEmployeeId` · `assigneeName` · `dueAt` · `isOverdue` · `sortOrder` · `canOpen`

  Schema: `subtaskListItemSchema` (`packages/contracts/src/task.ts`). `canOpen` = con có nằm trong phạm vi đọc **riêng** của actor không — server tính bằng **2 truy vấn tập hợp** (toàn bộ con, và con qua `scopeExists`), KHÔNG phải N+1. FE dùng nó để render con ngoài tầm với dạng read-only (xem gạch đầu dòng "THỪA HƯỞNG DỪNG Ở ĐÚNG ROUTE NÀY" bên dưới).

  **Vì sao không trả `taskCoreResponseSchema`:** DTO đầy đủ còn mang `description` (tới 20 000 ký tự), `projectName`, `creatorName`, `reporterName`, `departmentId` — panel **không cần**, mà thừa hưởng đọc lại làm tập lộ ra rộng hơn mức cần thiết. **Không được để câu mô tả trong tài liệu hẹp hơn cái route thật sự trả** — nếu implementer chọn trả DTO đầy đủ thì phải quay lại sửa dòng này trước, không im lặng.
  > **✅ ĐÃ ĐÓNG (20/07/2026).** Lệch được phát hiện đúng lúc viết ADR: lane `subtask-be-core` ban đầu trả `TaskCoreResponseDto[]` (phương án ii) trong khi ADR chốt (i). Đóng bằng cách **thu hẹp CODE theo ADR**, không nới ADR theo code — thêm `subtaskListItemSchema` vào `packages/contracts` và map `listSubtasks`/`reorderSubtasks` sang DTO hẹp. Ghi lại ở đây vì đây chính là loại lệch mà một quyết định về **phạm vi lộ dữ liệu** hay chết âm thầm: tài liệu nói hẹp, route trả rộng, không ai đối chiếu.
- **Chấp nhận lộ ở mức đó** vì người chịu trách nhiệm việc cha đương nhiên phải thấy phân rã của nó.
- **THỪA HƯỞNG DỪNG Ở ĐÚNG ROUTE NÀY:** `GET /tasks/:childId` vẫn kiểm scope trên **chính con** ⇒ có con hiện trong panel mà bấm vào là **404**, nút sửa/xoá sẽ **403**. **Chốt hành vi FE:** con ngoài tầm với render **READ-ONLY, KHÔNG link, KHÔNG nút** — đừng mời gọi hành vi sẽ lỗi.
- **Đối xứng — quyền GHI KHÔNG thừa hưởng:** sửa / đổi trạng thái / xoá riêng một con vẫn kiểm quyền trên **CHÍNH con đó** (least-privilege). **Chỉ ĐỌC là thừa hưởng.** Đổi trạng thái một con đi đường `POST /tasks/:id/status` sẵn có.
- **Hệ quả tốt:** `blocked[]` của D-38 liệt kê được mọi con bị chặn mà **không rò rỉ thêm gì**.

### D-40 — Rail avatar CÓ tính con ⚠️ OWNER-CONFIRM

- **Câu hỏi (câu hỏi mở còn treo ở backlog):** lọc board theo người X thì thẻ cha có hiện khi X chỉ là người thực hiện của một **việc con**?
- **Quyết định: CÓ.** Lọc board theo người X giữ thẻ **CHA** khi: assignee của chính cha là X **HOẶC** tồn tại `COUNTABLE_CHILD` (D-32) của cha có assignee là X. **Board vẫn chỉ hiện cha (D-36) — con không thành thẻ.**
- **Lý do:** nhất quán với quyết định "việc quá hạn có tính con" (D-37) — nếu X đang gánh một việc con thì công việc cha đó **thuộc phần việc của X**.
- **Thi hành:** cần nhánh `OR EXISTS` trong `listTx` (`task-core.repository.ts:267-278`) khi có **cả** `assigneeEmployeeId` lẫn `parentOnly`. Không có `parentOnly` ⇒ **giữ nguyên hành vi cũ**.
- **Ghi chú UI bắt buộc:** thẻ có thể hiện dù người được lọc **không phải** người thực hiện của chính thẻ đó — badge tiến độ việc con trên thẻ là **dấu hiệu nhìn thấy được** giải thích vì sao.
- **Đây là quyết định sản phẩm** (đổi ngữ nghĩa một bộ lọc người dùng đang dùng) ⇒ **OWNER-CONFIRM tại PR**. Owner đã đề xuất *"CÓ, nhất quán với quyết định quá hạn"*; ADR ghi theo owner và chờ chốt tường minh khi merge.

### D-41 — KHÔNG cascade khi HUỶ cha

- **Câu hỏi:** Chuyển cha sang `Cancelled` thì con có tự huỷ theo không?
- **Quyết định: KHÔNG.** `Cancelled` ở cha **không** tự huỷ con.
- **Lý do:** owner chưa yêu cầu; **huỷ hàng loạt câm là thứ khó hoàn tác**.
- **Ghi tường minh vì D-38 chỉ nói về XOÁ** — người sau đừng suy diễn từ D-38 sang huỷ.
- **Hệ quả đếm:** cha `Cancelled` **còn `COUNTABLE_CHILD`** ⇒ cha **không phải lá**; các con **vẫn được đếm**.

---

## 4. Mã mới cấp trong đợt này

**Mã lỗi** (đã grep `TASK-ERR-[0-9]{3}` toàn repo trước khi cấp; cao nhất đang dùng là `TASK-ERR-042`):

| Mã | Tên | HTTP | Quyết định |
| --- | --- | --- | --- |
| `TASK-ERR-043` | `SUBTASK_PARENT_NOT_FOUND` | 404 | D-33 (b) — cha không tồn tại / đã xoá / khác company |
| `TASK-ERR-044` | `SUBTASK_DEPTH_EXCEEDED` | 400 | D-33 (c) — cha đã là con (cây quá 1 cấp) |
| `TASK-ERR-045` | `SUBTASK_HAS_CHILDREN` | 400 | D-33 (d) — task đang có con không thể thành con |
| `TASK-ERR-046` | `SUBTASK_PROJECT_MISMATCH` | 400 | D-36 — con không cùng dự án với cha. **Dùng chung** cho hai luật D-36a (`SUBTASK_PARENT_PROJECT_LOCKED` · `SUBTASK_CHILD_PROJECT_LOCKED`) và cho `SUBTASK_REORDER_MISMATCH` (TASK-API-702) — cùng một họ "cấu trúc cây không hợp lệ", không cấp thêm mã |
| `TASK-ERR-047` | `SUBTASK_DELETE_FORBIDDEN` | 403 | D-38 — có ≥1 con ngoài phạm vi GHI. Cùng thông điệp được dùng lại cho nhánh **409 defensive/unreachable** của luật khoá (D-33) |

> Hệ mã số `TASK-ERR-0xx` là **tham chiếu lịch sử** của SPEC-06; bộ **canonical là slug** (SPEC-06 §18a TK-3 / API-06 §25). Ánh xạ slug của 5 mã trên được ghi ở SPEC-06 §18a.1.

**Mã API** (dải `7xx` còn trống, cao nhất hiện là `602`):

| Mã | Route | Quyền |
| --- | --- | --- |
| `TASK-API-701` | `GET /api/v1/tasks/{task_id}/subtasks` | `TASK.TASK.VIEW` (`read:task`) — scope đọc trên **CHA** (D-39) |
| `TASK-API-702` | `PATCH /api/v1/tasks/{task_id}/subtasks/reorder` | `TASK.TASK.UPDATE` (`update:task`) — scope ghi trên **CHA** |

**KHÔNG cặp quyền mới.** Tái dùng `create`/`update`/`delete`/`read:task` ⇒ **không đụng** `TASK_PERMISSION_COUNT` · `TASK_GRANT_MATRIX` · `TASK_EXPECTED_GRANT_COUNTS` · seed (bẫy *canonical-seed-pin-regression*). Nếu review đòi thêm pair ⇒ **DỪNG, báo owner**.

---

## 5. Rollback

- **D-31/D-32/D-33/D-36/D-36a/D-38/D-39/D-41** (đường ghi + bất biến cây): revert code service/repository — **không đụng schema/data**. Dữ liệu việc con đã tạo vẫn hợp lệ với model cũ (`parent_task_id` vốn đã tồn tại từ `0478`).
- **D-34/D-35** (đếm-lá): revert vị từ `isLeaf` ở `projects.repository.ts` + `countsByStatusLeafTx`, và **DROP + CREATE lại MV theo NGUYÊN VĂN công thức `0502`**. Đây là đổi **ngữ nghĩa số liệu người dùng nhìn thấy** ⇒ khối rollback phải được viết sẵn dạng comment trong header migration `0503` (tiền lệ `0478:405-418`). MV là dữ liệu dẫn xuất — không mất dữ liệu gốc.
- **Migration `0503` phần cấu trúc** (`tasks_parent_active_idx` + `UNIQUE (id, company_id)` + FK composite): thuần additive ⇒ down = `DROP INDEX` / `DROP CONSTRAINT`. **Lưu ý:** gỡ FK composite là **tháo backstop cross-tenant tầng DB** (BẤT BIẾN #1) — chỉ làm khi đồng thời revert cả đường ghi.
- **D-40** (rail avatar): revert nhánh `OR EXISTS` trong `listTx` — hành vi lọc quay lại như trước, không đụng dữ liệu.

---

## 6. Tài liệu phải cập nhật theo

| Tài liệu | Mục | Nội dung đổi |
| --- | --- | --- |
| SPEC-06 | §14.21 (mới) | `TASK-FUNC-021` Công việc con: CRUD · 1 cấp · cùng dự án · ẩn khỏi board · tiến độ cha · xoá lan · đếm-lá · ghi chú "danh sách ≠ con số" · rail avatar |
| SPEC-06 | §6.8 · §13.8 | Board chỉ hiện cha ⇒ trỏ D-36 (thay tham chiếu tới file kế hoạch) |
| SPEC-06 | §13.6 · §15.3 | `parent_task_id` **đã hỗ trợ** ⇒ trỏ D-31 (bỏ diễn đạt "nếu hỗ trợ") |
| SPEC-06 | §16.3 · §18a · §18a.1 · §24 | Mã `TASK-API-701/702` · mã lỗi `TASK-ERR-043…047` + ánh xạ slug · đóng câu hỏi mở #14 |
| API-06 | §10.3 · §13.7 · §13.8 (mới) | Hai endpoint việc con; reorder **KHÔNG ghi activity/audit** |
| API-06 | §13.2 · §13.4 · §13.5 · §13.6 | `parent_task_id` trong create/update · `subtask_total`/`subtask_done` trong response · quy tắc xoá lan D-38 dứt khoát (thay câu "chặn hoặc cascade theo cấu hình") |
| API-06 | §15.1 · §25 · §26.2 · §28.2 | Board chỉ cha ⇒ D-36; mã lỗi mới; luật cây trong business validation |
| DB-06 | §4.16 (mới) · §5.2 · §7.4 · §9.2 | Định nghĩa `ACTIVE_CHILD`/`COUNTABLE_CHILD`; `parent_task_id` là đường sống; FK composite + `tasks_parent_active_idx`; luật khoá |
| DECISIONS-03 | §D-30 hệ quả 3 | Dòng nối: đếm-lá **đã áp** tại D-34 / mig `0503` |

---

## 7. Câu hỏi mở còn lại (cho owner)

1. Có mở **đa cấp** (cây > 1 tầng) sau MVP không? D-31 chốt 1 cấp theo YAGNI; mở đa cấp là viết lại rollup đệ quy cho **mọi** con số, không phải nới một điều kiện.
2. `byStatus` có nên là dữ liệu **SENSITIVE** không? Sau D-35 nó suy ra được dưới `read:project`. Nếu owner muốn khoá lại thì đó là quyết định **nâng gate widget `project-progress`** lên `view-report:project`.
3. Việc con có cần **watcher / comment / file riêng** không? Đợt này việc con dùng chung mọi route task sẵn có, không có ràng buộc riêng.
4. Có route **khôi phục task** (undelete) không? Nếu có, xem 💣 mìn tương lai ở D-33 — phải kiểm lại luật cây **trước** khi bỏ `deleted_at`.
5. Huỷ cha có nên hỏi người dùng *"huỷ luôn các việc con?"* ở tầng UI không? D-41 chốt BE không cascade; một hộp thoại xác nhận ở FE là quyết định sản phẩm riêng.
