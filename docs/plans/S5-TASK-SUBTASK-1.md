```yaml
wo: S5-TASK-SUBTASK-1
zone: red
generated_by: session 2026-07-20 (đợt subtask — sau A #234-241 · B #242 · D1 #243 · detail #245 · dashfix #246)
revision: 4 — rev2 vá 9 BLOCKING vòng 1; rev3 vá 3 BLOCKING vòng 2 (luật khoá thiếu oldP + ABBA · widget non-sensitive mượn aggregate sau gate SENSITIVE · huỷ con cuối làm tổng tăng); rev4 vá 2 BLOCKING vòng 3 — CÙNG MỘT HỌ "liệt kê cho hết WRITER phá được bất biến": PATCH {projectId} phá D-36 không cần đồng thời (D-36a mới) · applyStateChangeTx còn ghi state_id lên subtask qua move-state và PATCH {stateId}. Mọi claim của reviewer đều đã tự xác minh lại trên code thật trước khi sửa.
summary: >
  Công việc con = subtask THẬT qua parent_task_id (cột đã có từ mig 0478:327, chưa ai dùng).
  CRUD 1 cấp + người thực hiện/hạn/trạng thái riêng + ẩn khỏi board + tiến độ thẻ cha
  + ĐẾM LÁ cho MV dashboard, báo cáo dự án và widget project-progress.
  KHÔNG migration cột; CÓ migration định nghĩa lại MV + index + FK composite chống cross-tenant.

lane_order: >
  adr → contracts (+build contracts & web-core dist NGAY) → be-core → { migration-0503 ‖ be-report ‖ be-dashboard }
  → fe. BẮT BUỘC CÙNG 1 RELEASE/PR: migration-0503 + be-report + be-dashboard — ba nơi này phải dùng CÙNG
  một vị từ lá; lệch pha giữa chúng ⇒ hai con số khác nhau trên CÙNG một màn hình, đúng loại lỗi WO này
  sinh ra để tránh. be-report và be-dashboard chạm file khác nhau nên song song được, NHƯNG cả hai NỐI TIẾP
  be-core (dùng hằng vị từ do be-core khai). fe chỉ chạy sau khi contracts dist đã build
  (bẫy stale-contracts-dist-typecheck-false-red · web-core-stale-dist-white-page).

lanes:
  - id: subtask-adr
    task: >
      ADR + SỬA SPEC TRƯỚC KHI CODE (CLAUDE.md §1 — docs là nguồn sự thật, không phải code).
      TẠO docs/DECISIONS/DECISIONS-05_Task_Subtask_And_Leaf_Counting.md — D-31…D-41 (+ D-36a)
      (D-30 ở DECISIONS-03 đang là cao nhất).
      ⚠️ MỘT BÀI HỌC XUYÊN SUỐT 3 VÒNG REVIEW, ghi vào đầu ADR: bất biến của WO này (state_id NULL ·
      cùng dự án · 1 cấp) KHÔNG được phát biểu như tính chất của DỮ LIỆU rồi thôi — phải liệt kê CHO HẾT
      WRITER có thể phá nó, và chốt ở METHOD DÙNG CHUNG chứ không rải ở route. Ba vòng review đều tìm ra
      lỗi cùng một họ này (syncStateWithStatusTx · applyStateChangeTx · PATCH projectId). Người thêm route
      hay writer mới cho `tasks` sau này PHẢI đối chiếu lại D-33/D-36/D-36a.

      • D-31 MÔ HÌNH: việc con = subtask THẬT trên `tasks.parent_task_id`, KHÔNG mở rộng checklist
        (owner chốt 18/07: mỗi dòng con có người thực hiện + hạn riêng; checklist_items chỉ có
        title/is_done/done_by/done_at/order_index). ĐỘ SÂU ĐÚNG 1 CẤP: task được chọn làm cha PHẢI có
        parent_task_id IS NULL. Lý do 1 cấp: ảnh tham chiếu MISA chỉ 1 cấp; đa cấp kéo theo rollup đệ quy
        cho MỌI con số (đếm lá, %, quá hạn) — không tương xứng nhu cầu đã biết (YAGNI).

      • D-32 HAI VỊ TỪ "CON", ĐẶT TÊN TƯỜNG MINH — đây là nguồn nhầm lẫn số 1 của WO này, mọi nơi trong
        code PHẢI dùng đúng tên và có comment trỏ D-32:
          – `ACTIVE_CHILD`  (CẤU TRÚC) = con `deleted_at IS NULL`, MỌI trạng thái kể cả Cancelled.
            Dùng cho: xoá lan (D-38) · luật độ sâu (d) · câu hỏi "task này có phải là cha không".
          – `COUNTABLE_CHILD` (ĐẾM) = ACTIVE_CHILD **và** `task_status IS DISTINCT FROM 'Cancelled'`.
            Dùng cho: định nghĩa "lá" (D-33) · mẫu số tiến độ (D-34) · rail avatar (D-40).
        VÌ SAO TÁCH: nếu "lá" dùng ACTIVE_CHILD thì một task cha đang Todo & quá hạn mà có ĐÚNG 1 con đã
        Cancelled sẽ RỚT khỏi countsByStatus/overdueCount/assigneeWorkload ⇒ dự án hiện "0 việc phải làm,
        0 quá hạn" trong khi cha vẫn sống và trễ hạn (lỗi thật, plan-reviewer BLOCKING #6). Việc đã huỷ
        không được phép che khuất việc còn sống. Ngược lại, nếu xoá-lan/độ-sâu dùng COUNTABLE_CHILD thì
        con Cancelled thành mồ côi và cây lên được 3 tầng. Hai vị từ là BẮT BUỘC, không phải trùng lặp —
        pin cả hai bằng test, người sau đừng "hợp nhất cho gọn".

      • D-33 CHỐNG CHU TRÌNH + BẤT BIẾN CÂY — 4 luật **CỘNG KHOÁ HÀNG**. Khi gán `parentTaskId = P` cho
        task T, BE kiểm trong CÙNG tx, SAU khi đã khoá:
          (a) P ≠ T (DB có CHECK 0478:368 — BE vẫn kiểm để trả 400 sạch thay vì 23514 raw);
          (b) P tồn tại, cùng company, deleted_at IS NULL;
          (c) P.parent_task_id IS NULL (P là gốc) — chặn tầng 3;
          (d) T KHÔNG có ACTIVE_CHILD nào — task đang làm cha thì không được thành con. (chỉ áp cho update)
        MÌN TƯƠNG LAI (ghi vào ADR, rẻ và chặn đúng loại lỗi repo đã dính nhiều lần): (d) dùng ACTIVE_CHILD
        (`deleted_at IS NULL`) ⇒ task có con ĐÃ XOÁ vẫn được gán làm con. Hôm nay vô hại vì KHÔNG có route
        khôi phục task. **Bất kỳ route khôi phục nào trong tương lai PHẢI kiểm lại D-33 trước khi bỏ
        deleted_at** — nếu không, khôi phục một con cũ sẽ sinh cây 3 tầng.
        ⚠️ KHOÁ LÀ MỘT PHẦN CỦA BẤT BIẾN, KHÔNG PHẢI TỐI ƯU: dưới READ COMMITTED, 4 luật kiểm-rồi-ghi
        KHÔNG serialize. Ví dụ thật: R1 `PATCH A {parent:B}` ‖ R2 `PATCH B {parent:A}` — cả hai đều thấy
        đối phương là gốc và chưa có con ⇒ commit cả hai ⇒ CHU TRÌNH A↔B. Tương tự R1 tạo con C dưới P ‖
        R2 gán `P.parent = Q` ⇒ 3 tầng.
        LUẬT KHOÁ — **MỘT LUẬT DUY NHẤT CHO TOÀN WO, KHÔNG CÓ NGOẠI LỆ THEO ĐƯỜNG**:
          khoá bằng MỘT câu `SELECT id FROM tasks WHERE company_id = $1 AND id = ANY($2)
          ORDER BY id FOR UPDATE`, trong đó `$2` = **TOÀN BỘ tập hàng mà thao tác sẽ chạm**, rồi ĐỌC LẠI
          sau khoá mới kiểm (a)(b)(c)(d). Thứ tự `ORDER BY id` là thứ tự khoá TOÀN CỤC.
        TẬP HÀNG PHẢI KHOÁ, theo từng đường (bỏ phần tử null):
          – create có parentTaskId : `{P}`
          – update parentTaskId    : `{oldP, T, newP}`  ← **oldP BẮT BUỘC CÓ**
          – update projectId của task CÓ con : `{T} ∪ children`  ← xem D-36a
          – delete CHA             : đọc con TRƯỚC (không khoá) → khoá `{P} ∪ children` → **đọc lại tập
                                     con sau khoá**; tập đổi ⇒ làm lại ĐÚNG MỘT lần, còn lệch ⇒ 409 (fail-closed)
          – delete CON (task là lá): `{T}` — đã kiểm: không bất biến nào đòi khoá thêm cha. Ghi ra để
                                     implementer không hiểu nhầm thành "xoá con thì bỏ qua khoá" hoặc over-lock
          – reorder                : `{P} ∪ children`, cùng khuôn delete cha
        VỀ NHÁNH 409 — GIỮ NHƯNG ĐỪNG ĐÒI TEST: một khi đã giữ khoá trên P thì **tập con bị ĐÓNG BĂNG**,
          vì mọi writer thêm/bớt con đều buộc phải khoá P trước (create khoá `{P}`; update khoá
          `{oldP,T,newP}` ⇒ luôn chạm P). Tập con do đó chỉ có thể đổi ĐÚNG MỘT LẦN — giữa lần đọc-không-khoá
          và lúc lấy được khoá — nên lần đọc lại thứ hai KHÔNG THỂ lệch nữa. ⇒ nhánh 409 là
          **không-với-tới-được theo thiết kế**: giữ nó (fail-closed đúng đắn) + comment "defensive,
          unreachable khi luật khoá còn nguyên" để reviewer sau không xoá như dead code, nhưng KHÔNG viết
          testTask cho nó (không dựng được một cách xác định). Nếu nó bắn thật ⇒ tín hiệu luật khoá đã bị phá.
        KỸ THUẬT: giữ ĐÚNG MỘT câu `SELECT ... ORDER BY id FOR UPDATE`, KHÔNG tách thành nhiều lệnh khoá lẻ —
          node `LockRows` nằm TRÊN `Sort` nên hàng được khoá theo đúng thứ tự đã sắp; tách ra là mất bảo đảm thứ tự.
        ⚠️ VÌ SAO PHẢI CÓ oldP (lỗ hổng thật, không phải lý thuyết): `DELETE oldP` khoá oldP rồi đọc con
          → thấy T. Song song `PATCH T{parent:newP}` chỉ khoá {T, newP}, KHÔNG đụng oldP ⇒ commit trước.
          Delete sau đó soft-delete từng con `where id = T` — T vẫn tồn tại, deleted_at còn NULL ⇒
          **T bị xoá lan dù đã là con của newP**. Con sống của một cha không liên quan biến mất, CÂM.
        ⚠️ VÌ SAO PHẢI LÀ id-TĂNG-DẦN TOÀN CỤC chứ không phải "cha trước": "cha trước" gây ABBA với
          `PATCH A{parent:B}` ‖ `PATCH B{parent:A}` (mỗi bên giữ gốc của mình); còn "cha trước" ở delete
          trộn với "id tăng dần" ở update cũng ABBA (delete giữ cha-id-cao xin con-id-thấp; update giữ
          con-id-thấp xin cha-id-cao). Một luật cho mọi đường mới thoát.
        KÈM 2 ĐIỀU KIỆN VẬN HÀNH: (i) mọi `UPDATE` mang vị từ cấu trúc (`parent_task_id = $parent`) phải
          ASSERT SỐ HÀNG ẢNH HƯỞNG đúng kỳ vọng, lệch ⇒ rollback (không im lặng ghi thiếu);
          (ii) map lỗi `40P01` (deadlock) / `40001` (serialization) thành 409 retry-able, KHÔNG để rơi ra 500 raw.
        GHI CHÚ CƠ CHẾ: khuôn "đọc lại sau khoá" đã có ở task-core.service.ts:493-502 — nhưng ở đó khoá
          đến từ UPDATE NGẦM (:490), KHÔNG phải `FOR UPDATE` tường minh. WO này khoá hàng CHA vốn không bị
          UPDATE ⇒ **BẮT BUỘC `SELECT ... FOR UPDATE` tường minh**; copy nguyên cơ chế của :490 là không khoá gì cả.
        IDIOM `FOR UPDATE` CỦA REPO (dùng lại, đừng phát minh): attendance-adjustment.repository.ts:105-108
          — khoá TRÊN MỘT BẢNG DUY NHẤT, KHÔNG JOIN (*"a joined FOR UPDATE would lock the employee/user
          rows too and can surprise"*). Câu khoá của WO này vì thế chỉ `FROM tasks`, không join
          projects/employee_profiles/users. Khuôn TEST đồng-thời: attendance-adjustment.int.spec.ts:520-526
          (bắn 2 request trong CÙNG một tick bằng Promise.all — chứng minh row-lock serialize thật, không
          phải chỉ nhìn trạng thái cuối sau commit).
        Khoá cha cũng chính là thứ đóng PHANTOM của D-38 (con mới được chèn sau lúc SELECT của xoá-lan).

      • D-34 ĐẾM LÁ (owner chốt 18/07, ràng buộc cứng): "lá" = task `deleted_at IS NULL` và KHÔNG có
        COUNTABLE_CHILD (D-32). Task không con ⇒ chính nó là lá.
        Áp cho ĐÚNG 3 nơi — cả ba PHẢI dùng CÙNG một vị từ, cùng một release:
          (i) MV `mv_dashboard_task_status` (mig 0503);
          (ii) báo cáo dự án: countsByStatus · overdueCount · assigneeWorkload (projects.repository.ts:804/818/830);
          (iii) widget dashboard `project-progress` (dashboard-widget-handlers.service.ts:396-419) — xem D-35.
        KHÔNG áp cho: board (quy tắc riêng D-36) · "Việc của tôi" · "Việc quá hạn" · ME summary · alerts ·
        job nhắc hạn (D-37).
        HỆ QUẢ ĐÃ BIẾT VÀ CHẤP NHẬN (owner xác nhận — ghi vào ADR + UI, KHÔNG phải bug):
          – tổng nhảy KHÔNG đều: thêm con ĐẦU TIÊN vào task chưa có con ⇒ tổng KHÔNG đổi (cha rời tập lá,
            con vào) — con THỨ HAI mới +1;
          – board (chỉ cha) ≠ báo cáo (chỉ lá) trên cùng một dự án;
          – assigneeWorkload: người CHỈ ôm task cha (mọi con giao người khác) tụt về 0 trên biểu đồ tải —
            đúng theo đếm-lá, nhưng phản trực giác ⇒ BẮT BUỘC có ghi chú UI + test pin;
          – **HUỶ VIỆC CON CUỐI CÙNG LÀM TỔNG TĂNG 1** (hệ quả trực tiếp của D-32, kiểm bằng số học:
            P có C1(Todo)+C2(Todo) ⇒ lá={C1,C2}=2 · huỷ C1 ⇒ lá={C1,C2}=2 · huỷ NỐT C2 ⇒ P hết
            COUNTABLE_CHILD nên QUAY LẠI làm lá ⇒ lá={P,C1,C2}=**3**). Huỷ một việc mà tổng số việc TĂNG.
            CHẤP NHẬN vì trạng thái cuối là ĐÚNG (mọi con đã huỷ ⇒ P lại là việc thật phải làm, phải được
            đếm) — phương án thay thế (lá tính theo ACTIVE_CHILD) cho trạng thái cuối SAI: P sống và quá
            hạn nhưng tàng hình. Ghi vào ADR + ghi chú UI + test pin chuỗi 2→2→3, kẻo người sau vá như bug.

      • D-35 WIDGET `project-progress` DÙNG CHUNG CÔNG THỨC BÁO CÁO (BLOCKING #8). Hiện
        `fetchProjectProgress` (dashboard-widget-handlers.service.ts:396-419) tự đếm trong bộ nhớ từ
        `tasks.listByProject(..., {limit: 200})` — không lọc parent VÀ âm thầm cắt ở 200 hàng. Sau 0503,
        cùng MỘT màn dashboard sẽ hiện 2 con số khác nhau cho cùng dự án (widget task-status đếm lá vs
        project-progress đếm thô).
        ⚠️ CHỐT: **CHIA SẺ VỊ TỪ, KHÔNG CHIA SẺ METHOD** — widget TUYỆT ĐỐI KHÔNG gọi `aggregateReportTx`.
        Lý do là một ranh giới quyền đã ghi thành văn, đã xác minh trên code:
          – widget PROJECT_PROGRESS gate `('read','project')` NON-sensitive (dashboard-widget-catalog.const.ts:246);
          – route report gate `('view-report','project')` **isSensitive: true** (projects.controller.ts:186);
          – projects.service.ts:641-653 ghi tường minh: *"dùng SCOPE của view-report:project (SENSITIVE) —
            KHÔNG mượn read:project"*, để người có view-report@Team chỉ báo cáo project team dù read@Company.
        Gọi thẳng `aggregateReportTx` từ widget ⇒ người chỉ có `read:project` nhận đúng con số mà route
        report cố ý khoá sau cặp SENSITIVE + scope riêng ⇒ gate sensitive thành trang trí. Thêm điểm nhọn:
        `aggregateReportTx` còn tính `assigneeWorkload` kèm `employeeName` (PII) — widget sẽ fetch rồi vứt,
        cách một lần refactor là thành rò thật.
        ⇒ Khai METHOD HẸP RIÊNG `countsByStatusLeafTx(tx, companyId, projectId)` trả ĐÚNG byStatus theo lá,
        dùng CHUNG hàm vị từ `isLeaf('tk')` với `aggregateReportTx` và với 0503. Widget gọi method hẹp này.
        KHÔNG tự nâng gate widget lên `view-report:project` — nếu owner muốn widget = báo cáo thật thì đó là
        quyết định sản phẩm, phải OWNER-CONFIRM, KHÔNG quyết ngầm trong lane.
        GHI THẲNG VÀO ADR (để về sau không ai tranh cãi): sau D-35, `byStatus` trở nên SUY RA ĐƯỢC CHÍNH XÁC
        dưới `read:project`; ranh giới SENSITIVE của route report từ nay chỉ còn bảo vệ `overdueCount` +
        `assigneeWorkload` (PII). Nếu owner thấy byStatus PHẢI sensitive thì đó là quyết định nâng gate
        widget, có OWNER-CONFIRM — không sửa ngầm.
        DOCBLOCK BẮT BUỘC trên `countsByStatusLeafTx` (bài học reused-method-must-be-actor-scoped):
        *"KHÔNG tự scope theo actor — CHỈ gọi SAU khi đã authorize project"*; `getProject` ở
        dashboard-widget-handlers.service.ts:386 là thứ DUY NHẤT giữ scope cho đường widget.
        Giữ nguyên bước authorize project TRƯỚC (:385 — listByProject chỉ tenant-guard, bỏ là mở IDOR).

      • D-36 SUBTASK ẨN KHỎI BOARD + state_id ÉP NULL VÀ GIỮ NULL.
        Đợt A đã chèn sẵn `parent_task_id IS NULL` vào truy vấn board (task-core.repository.ts:278,
        bật tại task-kanban.service.ts:84) — CẤM GỠ.
        state_id của subtask = NULL (đã ẩn khỏi board thì cột pipeline không mang nghĩa; để state_id sống
        trên subtask là mời desync D-20/D-21 quay lại qua cửa sau).
        ⚠️ ÉP LÚC TẠO LÀ CHƯA ĐỦ (BLOCKING #1 — đã xác minh trên code): `syncStateWithStatusTx`
        (task-actions.service.ts:242, thân :669-684) chạy trên MỌI lần đổi trạng thái và chỉ early-return
        khi `projectId === null`. Subtask BẮT BUỘC cùng project với cha ⇒ projectId ≠ NULL ⇒ đánh dấu con
        "Done" (chính là luồng cốt lõi của D-34) sẽ GHI LẠI state_id ⇒ con nhảy vào cột và hiện trên board.
        BẮT BUỘC: `syncStateWithStatusTx` early-return khi task có parent_task_id (thêm parentTaskId vào
        `findStateSyncRowTx`), và acceptance phải kiểm state_id SAU khi đổi trạng thái, không chỉ lúc tạo.
        Subtask BẮT BUỘC cùng project với cha (cả hai NULL cũng hợp lệ) — chặn ở BE 400.
        ⚠️ QUÉT HẾT WRITER CỦA `state_id`, KHÔNG CHỈ ĐƯỜNG STATUS: vá `syncStateWithStatusTx` mới bịt
        đường đổi-trạng-thái. Còn `applyStateChangeTx` (task-core.service.ts:462-539) — method DÙNG CHUNG
        của CẢ `POST /tasks/:id/move-state` (TASK-API-213) LẪN `PATCH /tasks/:id {stateId}` (:355-358) —
        chỉ từ chối khi `!projectId` (:471). Subtask CÓ projectId (bắt buộc cùng project với cha) ⇒ cả hai
        route vẫn set được `state_id` cho subtask. CHỐT Ở METHOD DÙNG CHUNG (đúng khuôn cả WO, KHÔNG vá ở
        route): thêm điều kiện đầu `applyStateChangeTx` — task có `parent_task_id IS NOT NULL` ⇒ 400
        (tái dùng `STATE_INVALID`). `raw: TaskRawRow` đã là tham số sẵn ⇒ chỉ cần thêm `parentTaskId` vào
        `findRawByIdTx` (task-core.repository.ts:315-332), CÙNG LƯỢT với việc thêm `parentTaskId` vào
        `findStateSyncRowTx`. Một chốt phủ cả hai route.
        Tab "Danh sách" của vỏ workspace dự án CŨNG chỉ hiện cha (parity Bảng↔Danh sách là thuộc tính đã
        ship ở đợt D1 — hai tab lọc qua cùng helper).

      • D-36a DỰ ÁN CỦA CÂY LÀ BẤT BIẾN, VÀ `PATCH {projectId}` LÀ WRITER PHÁ ĐƯỢC NÓ MÀ KHÔNG CẦN ĐỒNG THỜI.
        `updateTask` hiện gán tự do: task-core.service.ts:324 `if (dto.projectId !== undefined)
        patch.projectId = dto.projectId`. Ba đường vỡ D-36:
          – tuần tự: `PATCH P {projectId:X}` khi P có ACTIVE_CHILD ⇒ cha sang dự án X, con ở lại dự án cũ;
          – chiều ngược: `PATCH C {projectId:X}` khi C là con ⇒ con lệch dự án cha;
          – đồng thời: `PATCH C {parent:P}` (kiểm cùng-project ✓ lúc đó) ‖ `PATCH P {projectId:X}` —
            đường sau KHÔNG có trong bảng tập khoá nên không khoá gì ⇒ lọt kể cả khi luật khoá cài đúng.
        HẬU QUẢ đúng thứ WO này dựng lên để tránh: báo cáo lọc theo `project_id`
        (projects.repository.ts:804/818/830). Cha ở dự án X vẫn có COUNTABLE_CHILD (con trỏ cha qua
        `parent_task_id`, không quan tâm project) ⇒ cha KHÔNG phải lá ở X, còn con là lá ở dự án CŨ ⇒
        **cha sống, có thể quá hạn, và TÀNG HÌNH ở CẢ HAI dự án** — đúng lỗi "việc sống bị che" mà D-32
        hệ quả #4 vừa lập luận để tránh.
        CHỐT (YAGNI, không cascade): (i) T có ACTIVE_CHILD và `dto.projectId` đổi ⇒ **400**, thông điệp
        "gỡ việc con ra trước khi chuyển dự án"; (ii) T có `parent_task_id IS NOT NULL` ⇒ **cấm đổi
        projectId riêng, 400** (dự án của con do cha quyết). Không chọn cascade projectId xuống con vì nó
        kéo theo cả `state_id` của cha lẫn con và mở thêm một tập khoá nữa cho ít giá trị thật.
        TẬP KHOÁ: đã chọn 400 (không cascade) nên `{T}` là ĐỦ — giữ khoá T chặn được mọi create-child đồng
        thời (create khoá `{P}` = `{T}`). Dòng `{T} ∪ children` ở bảng D-33 là khoá THỪA (vẫn đúng thứ tự
        id toàn cục, không deadlock) — implementer được phép rút gọn về `{T}`.

      • D-37 DANH SÁCH ≠ CON SỐ: "Việc của tôi" và "Việc quá hạn" hiện CẢ cha lẫn con (owner chốt (c):
        việc quá hạn CÓ tính con) vì đó là danh sách việc phải xử lý; còn CON SỐ trên dashboard/báo cáo
        dùng đếm-lá (D-34) ⇒ người dùng CÓ THỂ thấy dashboard 12 mà danh sách 15. BẮT BUỘC ghi chú trong
        UI + SPEC. ME summary (me-aggregation.service.ts:256-269) đi qua getMyTasks ⇒ cũng là worklist
        cá nhân, GIỮ NGUYÊN. Ghi tường minh để reviewer không tưởng là sót.

      • D-38 XOÁ CHA ⇒ XOÁ LAN XUỐNG CON, TẤT-CẢ-HOẶC-KHÔNG (owner chốt (b)): soft-delete (BẤT BIẾN #2),
        CÙNG 1 tx; khoá cha FOR UPDATE (D-33) rồi nạp toàn bộ ACTIVE_CHILD (D-32 — kể cả Cancelled, nếu
        không con Cancelled thành mồ côi); kiểm quyền GHI từng con; có ≥1 con ngoài phạm vi ghi ⇒ 403 và
        KHÔNG xoá gì cả.
        ⚠️ HAI PHÉP KIỂM KHÁC NHAU, KHÔNG ĐƯỢC LẪN (BLOCKING #5): quyết định CHẶN dùng
        `checkTaskInScopeTx(mode:'write')`; danh sách trả về trong payload lỗi dùng quy tắc đọc của D-39.
        Dùng nhầm một lời gọi ⇒ hoặc `blocked[]` luôn rỗng (vô dụng, hỏng câm) hoặc chặn theo quyền ĐỌC
        (con đọc-được-nhưng-không-ghi-được bị xoá oan). Hai test riêng cho hai vế.
        Payload 403: `{ blockedCount, blocked: [{id, taskCode, title}] }`.

      • D-39 PHẠM VI ĐỌC CỦA CON: **đọc được cha ⇒ đọc được toàn bộ con** (quyết định có chủ đích, không
        phải bỏ sót — BLOCKING #4). Lý do: subtask là phần cấu trúc của cha chứ không phải đối tượng độc
        lập; nếu lọc read-scope từng con thì `subtaskDone/subtaskTotal` (D-34) sẽ không khớp danh sách
        người dùng nhìn thấy ("2/5" nhưng chỉ liệt kê 3 dòng) — % mất nghĩa và trông như bug.
        PHẠM VI LỘ RA — LIỆT KÊ ĐÚNG TẬP FIELD, KHÔNG mô tả hẹp hơn hiện thực: route trả mảng
        `taskCoreResponseSchema` ⇒ ngoài tiêu đề/người thực hiện/hạn còn có `description` (tới 20000 ký tự),
        `projectName`, `creatorName`, `reporterName`, `departmentId`, `taskCode`. HAI LỰA CHỌN, chốt 1
        trong ADR: (i) trả DTO HẸP riêng cho danh sách con (id, taskCode, title, taskStatus, assigneeName,
        dueAt, isOverdue, sortOrder) — ĐỀ XUẤT, vì panel không cần description; (ii) trả đủ và liệt kê
        nguyên tập field trong ADR. KHÔNG được để câu mô tả hẹp hơn cái route thật sự trả.
        Chấp nhận lộ ở mức đó vì người chịu trách nhiệm việc cha đương nhiên phải thấy phân rã của nó.
        THỪA HƯỞNG DỪNG Ở ĐÚNG ROUTE NÀY: `GET /tasks/:childId` vẫn kiểm scope trên chính con ⇒ có con
        hiện trong panel mà bấm vào là 404, nút sửa/xoá sẽ 403. CHỐT HÀNH VI FE: con ngoài tầm với render
        READ-ONLY, KHÔNG link, KHÔNG nút — đừng mời gọi hành vi sẽ lỗi (lane fe phải làm đúng điều này).
        HỆ QUẢ: `blocked[]` của D-38 liệt kê được mọi con bị chặn mà không rò rỉ thêm gì.
        GHI đối xứng: **quyền GHI KHÔNG thừa hưởng** — sửa/đổi trạng thái/xoá riêng một con vẫn kiểm quyền
        trên CHÍNH con đó (least-privilege). Chỉ ĐỌC là thừa hưởng.

      • D-40 RAIL AVATAR CÓ TÍNH CON (đóng câu hỏi mở backlog:7162 — BLOCKING #7; owner đề xuất "CÓ,
        nhất quán với quyết định quá hạn" ⇒ theo owner, đánh dấu OWNER-CONFIRM). Lọc board theo người X
        giữ thẻ CHA khi: assignee của chính cha là X **HOẶC** tồn tại COUNTABLE_CHILD của cha có assignee
        là X. Board vẫn chỉ hiện cha (D-36) — con không thành thẻ. Cần nhánh OR EXISTS trong
        `listTx` (task-core.repository.ts:267-278) khi có cả `assigneeEmployeeId` lẫn `parentOnly`.
        Ghi chú UI: thẻ có thể hiện dù người được lọc không phải người thực hiện của chính thẻ đó —
        badge tiến độ subtask trên thẻ là dấu hiệu nhìn thấy được.

      • D-41 KHÔNG cascade khi HUỶ cha: `Cancelled` cha KHÔNG tự huỷ con (owner chưa yêu cầu; huỷ hàng loạt
        câm là thứ khó hoàn tác). Ghi tường minh vì D-38 chỉ nói về XOÁ — người sau đừng suy diễn.
        Hệ quả đếm: cha Cancelled còn COUNTABLE_CHILD ⇒ cha không phải lá; các con vẫn được đếm.

      • checklistDone/checklistTotal (PR #207) GIỮ NGUYÊN là badge RIÊNG — KHÔNG gộp, KHÔNG thay bằng
        subtask (backlog ghi rõ). checklist = hạng mục con trong đầu MỘT người; subtask = việc có chủ +
        hạn riêng.

      SPEC-06 TASK.md:
        – THÊM §14.21 TASK-FUNC-021 "Công việc con (subtask)" (§14.20 đang cao nhất): CRUD, 1 cấp, cùng
          project, ẩn khỏi board, tiến độ cha, xoá lan (D-38), đếm-lá (D-34) + ghi chú "danh sách ≠ con số"
          (D-37) + rail avatar tính con (D-40);
        – §24 câu hỏi mở #14 (:2469 "Có cần hỗ trợ sub-task trong MVP không, hay checklist là đủ?") ⇒ ĐÓNG:
          CÓ subtask, checklist GIỮ song song. QUYẾT ĐỊNH SẢN PHẨM ⇒ nhãn OWNER-CONFIRM trong ADR + mô tả PR;
        – :401 và :1096 (board chỉ hiện cha) đổi tham chiếu "xem kế hoạch S5-TASK-SUBTASK-1" → DECISIONS-05 D-36;
          :1007 và :1911 (bảng field parent_task_id "Nếu hỗ trợ task cha") → đã hỗ trợ, trỏ D-31;
        – Bảng mã lỗi §18 — đã grep, cao nhất đang dùng là **TASK-ERR-042** ⇒ cấp 5 mã MỚI liên tiếp:
            TASK-ERR-043 SUBTASK_PARENT_NOT_FOUND (404)
            TASK-ERR-044 SUBTASK_DEPTH_EXCEEDED   (400 — cha đã là con)
            TASK-ERR-045 SUBTASK_HAS_CHILDREN     (400 — task có con không thể thành con)
            TASK-ERR-046 SUBTASK_PROJECT_MISMATCH (400)
            TASK-ERR-047 SUBTASK_DELETE_FORBIDDEN (403 — D-38)
          Nếu grep lúc code thấy 043-047 đã bị chiếm (nhánh khác merge xen) ⇒ lấy dải trống kế tiếp và
          SỬA LẠI plan, không im lặng đè.
      API-06_TASK_API_Design.md: dải 7xx còn trống (cao nhất 602) ⇒ TASK-API-701 `GET /tasks/:taskId/subtasks`,
        TASK-API-702 `PATCH /tasks/:taskId/subtasks/reorder`. Sửa :1476 ("Nếu task có sub-task active,
        backend chặn hoặc xóa mềm cascade theo cấu hình" — mơ hồ) thành quy tắc D-38 dứt khoát; :1696 và
        :2728 trỏ D-36; :1249/:1401 mẫu response bổ sung parentTaskId/subtaskTotal/subtaskDone.
      DB-06: parent_task_id nay LÀ đường sống + bất biến D-33 (kể cả luật khoá) + FK composite chống
        cross-tenant + index phục vụ vị từ lá + định nghĩa ACTIVE_CHILD/COUNTABLE_CHILD.
      DECISIONS-03 §D-30: THÊM 1 dòng nối "đếm-lá đã áp tại D-34/mig 0503" (dòng :185 đã hẹn trước WO này)
        — append, KHÔNG viết lại D-30.
      KHÔNG code khi lane này chưa xong.
    builder: doc-updater
    paths: ["docs/DECISIONS/**", "docs/SPEC/SPEC-06 TASK.md", "docs/API Design/API-06_TASK_API_Design.md", "docs/DB/DB-06 TASK Database Design.md"]

  - id: subtask-contracts
    task: >
      packages/contracts/src/task.ts + task-collab.ts — CHỈ họ taskCore* canonical, KHÔNG đụng họ PM-1
      legacy (docblock :662-665 cấm trộn).
      (1) `createTaskCoreSchema` (:603-625) += `parentTaskId: z.string().uuid().nullable().optional()`.
      (2) `updateTaskCoreSchema` (:631-656) += cùng field (null = gỡ khỏi cha).
      (3) `taskCoreResponseSchema` (:666-703) += `parentTaskId` · `subtaskTotal` · `subtaskDone`.
      (4) `taskKanbanCardSchema` (task-collab.ts, cạnh checklistDone/checklistTotal) += `subtaskTotal` · `subtaskDone`.
      (5) `listTaskCoreQuerySchema` (:585-596) += `parentOnly: taskCoreOptionalBooleanParam()` — TÁI DÙNG
          helper ĐÃ CÓ (dùng cho `overdue` tại :592), KHÔNG viết `z.preprocess` mới: helper này đã pin sẵn
          bẫy zod-query-param-double-pipe (pipe chạy 2 LẦN trên đường nestjs-zod).
      (6) MỚI `reorderSubtasksSchema = z.object({ subtaskIds: z.array(z.string().uuid()).min(1).max(200) }).strict()`.
      (7) Envelope route mới = MẢNG TRẦN (giống GET /tasks/:id/watchers vừa ship #245) ⇒ client KHÔNG được
          khai schema `{data,meta}` (bẫy apifetch-drops-pagination-bare-array — ZodError runtime dù HTTP 200,
          unit test mock vẫn xanh giả).
      (8) MỌI field mới ở response dùng `.nullable().optional()` KHÔNG `.default()` — giữ Input=Output cho
          `apiFetch<T>` + deploy lệch pha FE/BE không gãy (tiền lệ reporterName :684, stateId :698-701).
      (9) CHẠY NGAY sau lane: `pnpm --filter @mediaos/contracts build` + `pnpm --filter @mediaos/web-core build`
          (bẫy stale-contracts-dist-typecheck-false-red + web-core-stale-dist-white-page).
    builder: backend-builder
    paths: ["packages/contracts/src/task.ts", "packages/contracts/src/task-collab.ts"]

  - id: subtask-be-core
    task: >
      Đường ghi subtask — MỘT đường duy nhất, qua TaskCoreService (bài học B3/B4 đợt A: gate + auto-map ở
      method DÙNG CHUNG, KHÔNG ở route, KHÔNG service thứ hai).
      (1) drizzle `apps/api/src/db/schema/workflow.ts` bảng tasks (:387-477): typed thêm `parentTaskId` +
          `sortOrder`. THUẦN ADDITIVE. Ghi chú: task-core.repository dùng raw SQL (docblock :8-12) nên
          typed chỉ phục vụ đường HR-task + kiểu — đường CRUD chính vẫn sửa raw SQL ở (6).
      (2) HẰNG VỊ TỪ DÙNG CHUNG — khai MỘT LẦN ở nơi be-report/be-dashboard/migration đều tham chiếu được,
          dạng HÀM NHẬN ALIAS (bắt buộc: projects.repository.ts:804 và :818 dùng `from tasks` KHÔNG alias,
          còn :830 dùng alias `tk` ⇒ một hằng `sql` cứng KHÔNG tái dùng được, implementer sẽ copy 3 bản —
          đúng thứ cần tránh):
            export const activeChildExists   = (alias: string) => sql`...deleted_at is null...`
            export const countableChildExists= (alias: string) => sql`...deleted_at is null and task_status is distinct from 'Cancelled'...`
            export const isLeaf              = (alias: string) => sql`not ${countableChildExists(alias)}`
          Mọi câu PHẢI có `c.company_id = <alias>.company_id` trong subquery (BẤT BIẾN #1, defense-in-depth
          trên RLS). CHUẨN HOÁ alias `tk` cho cả 3 câu của projects.repository khi sửa.
      (3) HELPER BẤT BIẾN CÂY — 1 nơi duy nhất,
          `TaskCoreService.assertParentAssignable(tx, companyId, taskId|null, parentId)`:
          KHOÁ TRƯỚC, KIỂM SAU (D-33): `SELECT ... FOR UPDATE` T và P theo thứ tự id tăng dần (chống
          deadlock), ĐỌC LẠI sau khoá, rồi kiểm (a)(b)(c)(d) + cùng project (D-36).
          Khuôn TOCTOU dùng lại task-core.service.ts:493-502.
          Ném: 404 TASK-ERR-043 · 400 TASK-ERR-044 · 400 TASK-ERR-045 · 400 TASK-ERR-046.
          GỌI TỪ CẢ createTask LẪN updateTask — cấm nhân bản. Điều kiện (d) chỉ áp cho updateTask.
      (4) `createTask` (task-core.service.ts:163-290) nhận `dto.parentTaskId`:
          ⚠️ THREAD `effectiveProjectId` (BLOCKING #3 — mọi nhánh D-27 tại :186-217 đang key theo
          `dto.projectId`; con chỉ gửi parentTaskId sẽ đi lọt 4 cửa):
            – resolve `effectiveProjectId = parent.projectId` NGAY SAU assertParentAssignable;
            – `assertProjectUsable` (:186) chạy với effectiveProjectId — nếu không, TẠO ĐƯỢC CON TRONG DỰ
              ÁN ĐÃ ĐÓNG/LƯU TRỮ (bypass PROJECT_CLOSED);
            – nhánh :200 (CREATE_ASSIGNEE_REQUIRED) xét theo effectiveProjectId — nếu không, con không
              assignee bị 403 oan;
            – `assertProjectRoleTx` (:203-211) chạy với effectiveProjectId — nếu không, scope<Company
              không bị kiểm Owner/Manager;
            – chọn resolver assignee theo effectiveProjectId (`resolveAssigneeForProject` chứ không
              `resolveAssignee`) — nếu không, ca dùng CHÍNH của D-27 (Manager dự án giao việc cho member
              ngoài team) VỠ;
            – `dto.projectId` gửi kèm mà LỆCH parent.projectId ⇒ 400 TASK-ERR-046 (không âm thầm ghi đè).
          THÊM gate: scope < Company ⇒ actor phải GHI được CHA (assertInScopeForWrite trên cha) — tạo con
          là sửa cấu trúc việc của cha.
          ÉP `stateId = NULL` + BỎ QUA nhánh state mặc định (:225-237); client gửi kèm `stateId` tường
          minh ⇒ 400 (không nuốt im lặng). `taskStatus` khởi tạo 'Todo'.
          activity/audit: mã hiện có TASK_CREATED/TaskCreated, `newValues` thêm `parentTaskId`.
          KHÔNG thêm object_type mới vào CHECK audit.
      (4b) QUÉT WRITER CỦA HAI BẤT BIẾN (D-36 / D-36a) — chốt Ở METHOD DÙNG CHUNG, KHÔNG ở route:
          – `findRawByIdTx` (task-core.repository.ts:315-332) += `parentTaskId` (một lượt với
            `findStateSyncRowTx`) ⇒ mọi caller có sẵn thông tin cây;
          – `applyStateChangeTx` (:462-539, hiện chỉ chặn `!projectId` tại :471): thêm điều kiện
            `raw.parentTaskId !== null ⇒ 400 STATE_INVALID` — MỘT chốt phủ cả `POST /move-state` lẫn
            `PATCH {stateId}` (:355-358 gọi chung method này);
          – `updateTask`: `dto.projectId` (gán tự do tại :324) nay có 2 luật D-36a — T có ACTIVE_CHILD và
            projectId đổi ⇒ 400; T là con (`parent_task_id IS NOT NULL`) ⇒ 400. Khoá theo dòng mới của
            bảng D-33 khi cần.
      (5) `updateTask` (:294+) nhận `dto.parentTaskId` (undefined = không đổi; null = gỡ):
          – assertParentAssignable + đòi quyền ghi trên CẢ cha cũ (nếu có) LẪN cha mới;
          – gán cha ⇒ xoá state_id cùng lượt; gỡ cha ⇒ state_id VẪN NULL (task thành gốc KHÔNG cột,
            người dùng kéo vào cột sau bằng move-state — KHÔNG tự đoán cột mặc định, auto-map là cửa desync);
          – ⚠️ ĐƯỜNG GHI state_id (BLOCKING #9 — đã xác minh): `TaskCorePatchValues`
            (task-core.repository.ts:136-146) KHÔNG có `stateId`, và `setTaskStateTx` (:406-409) mang ràng
            buộc tường minh "CHỈ được gọi từ applyStateChangeTx — KHÔNG nối route mới vào writer này (R9)".
            ⇒ KHÔNG mở `TaskCorePatchValues.stateId` (đó chính là đường ghi state THỨ HAI mà R9 cấm) và
            KHÔNG lách setTaskStateTx. THÊM writer hẹp mới `clearTaskStateForSubtaskTx(tx, companyId,
            taskId, actorUserId)` chỉ `set state_id = null where ... and parent_task_id is not null`,
            kèm docblock nói rõ đây KHÔNG phải state-change nghiệp vụ mà là hệ quả cơ học của D-36.
          – ⚠️ KHÔNG ĐỂ THẺ BIẾN MẤT CÂM: thẻ rời board là thay đổi người dùng nhìn thấy ⇒ dòng activity
            TASK_UPDATED của lần đổi cha PHẢI mang cả `parentTaskId` và `stateId` ở old/new (một dòng mô
            tả cả hai, KHÔNG thêm action code mới).
          – `TASK_UPDATED` hiện CHỈ ghi `newValues` + `before:{changed:[...]}` (:368-386). Thêm `oldValues`
            CHỈ cho `parentTaskId`/`stateId` (không đổi hình dạng cho mọi field) ⇒ timeline #245 dựng được
            dòng cũ→mới; kiểm spec đang pin hình dạng bản ghi này, sửa cùng commit nếu cần.
      (6) `deleteTask` (:543-580) — CASCADE D-38, CÙNG tx:
          – giữ gate delete:task + guard workflow-driven + assertInScopeForWrite trên CHA;
          – KHOÁ theo ĐÚNG luật D-33 (một luật cho mọi đường, id tăng dần): đọc ACTIVE_CHILD TRƯỚC (không
            khoá) → khoá `{P} ∪ children` bằng MỘT câu `... id = ANY($ids) ORDER BY id FOR UPDATE` →
            ĐỌC LẠI tập con sau khoá; tập đổi ⇒ làm lại đúng một lần, còn lệch ⇒ 409. Đây là thứ chặn
            PHANTOM (con chèn thêm sau lúc SELECT); `FOR UPDATE` chỉ trên tập con KHÔNG chặn được phantom,
            và khoá "cha trước rồi con" gây ABBA với đường update — xem D-33;
          – ⚠️ CẦN VỊ TỪ KHÔNG-NÉM: `ProjectAccessService.assertTaskInScopeTx` (project-access.service.ts:133-153)
            hiện NÉM 404. THÊM `checkTaskInScopeTx(..., mode): Promise<boolean>` và viết lại assert = check
            + throw (MỘT nguồn logic, không copy — copy là chỗ hai đường quyền trôi khỏi nhau);
          – CHẶN dùng `mode:'write'`; danh sách `blocked[]` theo D-39 (đọc thừa hưởng ⇒ liệt kê được);
          – có con bị chặn ⇒ 403 TASK-ERR-047 `{blockedCount, blocked:[{id,taskCode,title}]}`, KHÔNG xoá gì;
          – con workflow-driven (không nên tồn tại, fail-closed) ⇒ 400, không xoá gì;
          – qua hết ⇒ soft-delete con TRƯỚC rồi cha, mỗi con 1 activity + 1 audit (append-only, BẤT BIẾN #2).
      (7) `TASK_CORE_SELECT` (:149-178) += `tk.parent_task_id AS "parentTaskId"`.
          `insertTaskCoreTx` (:526) + `updateTaskCoreTx` (:550) += parent_task_id, sort_order.
      (8) AGGREGATE TIẾN ĐỘ — KHÔNG N+1, khuôn mẫu chuẩn countProgressByTaskIdsTx
          (task-checklists.repository.ts:166-184): `countSubtaskProgressByParentIdsTx(tx, companyId, parentIds)`:
            select parent_task_id,
                   count(*) filter (where task_status = 'Done')::int as done,
                   count(*)::int                                     as total
              from tasks
             where company_id = $1 and parent_task_id = any($2::uuid[])
               and deleted_at is null and task_status is distinct from 'Cancelled'   -- COUNTABLE_CHILD (D-32)
             group by parent_task_id
          Trả Map, rỗng khi parentIds rỗng.
      (9) `task-kanban.service.ts:91-95`: thêm aggregate thứ 4 → map vào card ở `task-core.mapper.ts:68-84`.
          Board đã parentOnly ⇒ parentIds = id các thẻ.
          ⚠️ ĐIỂM CẦN QUYẾT (phát hiện khi khảo sát, KHÔNG được nối thêm rồi im lặng): chỗ này đang dùng
          `Promise.all` với 3 truy vấn trên CÙNG MỘT tx của `withTenant`. Repo lại có cảnh báo tường minh
          ở workflow.service.ts:478-480: *"Sequential awaits, NOT Promise.all — node-postgres cannot run
          concurrent queries on one tx connection (Promise.all triggers a pg deprecation warning and breaks
          on pg@9)"*. Trên một connection, các câu này SERIALIZE dù có Promise.all ⇒ Promise.all ở đây
          KHÔNG mang lại song song thật, chỉ mang lại rủi ro pg@9.
          CHỐT: đổi khối này sang `await` tuần tự (4 câu) kèm comment trỏ workflow.service.ts:478-480 —
          cùng hiệu năng, bỏ được mìn. Yêu cầu "KHÔNG N+1" của done_when nói về SỐ CÂU (1 aggregate cho
          N thẻ), KHÔNG phải về tính song song ⇒ tuần tự vẫn thoả. Ghi vào PR là sửa kèm có chủ đích.
      (10) Detail DTO: `getTask` trả subtaskTotal/subtaskDone dùng CÙNG aggregate cho 1 id (không viết
           truy vấn thứ hai).
      (11) `listTasks` (:114-140) nhận `parentOnly` (mặc định FALSE ⇒ hành vi cũ nguyên vẹn), truyền xuống
           filter sẵn có (repository:278). KHÔNG đổi getMyTasks/findMyTasksTx (D-37).
      (12) RAIL AVATAR D-40: trong `listTx` (:267-278), khi có `assigneeEmployeeId` VÀ `parentOnly` ⇒ điều
           kiện assignee thành `(tk.main_assignee_employee_id = $X OR exists(COUNTABLE_CHILD của tk có
           main_assignee_employee_id = $X))`. Không có parentOnly ⇒ giữ nguyên hành vi cũ.
      (13) ROUTE MỚI trong tasks.controller.ts (KHÔNG controller mới):
           – `GET /tasks/:taskId/subtasks` (TASK-API-701) — gate `read:task` + scope đọc trên CHA; con
             KHÔNG lọc thêm (D-39). Trả MẢNG TRẦN sắp `sort_order NULLS LAST, created_at`.
             ⚠️ `TaskCoreListFilter` chưa có `parentId` và `listTx` cứng `order by tk.created_at desc`
             (:286) ⇒ khai repo method mới hoặc mở rộng filter + tham số sort tường minh; đừng giả định
             listTx dùng lại được nguyên trạng.
           – `PATCH /tasks/:taskId/subtasks/reorder` (TASK-API-702) — gate `update:task` +
             assertInScopeForWrite trên CHA + khoá cha FOR UPDATE; VALIDATE tập id KHỚP CHÍNH XÁC tập
             ACTIVE_CHILD của cha (thiếu/thừa/lạ ⇒ 400); ghi `sort_order = index` bằng MỘT
             `UPDATE ... FROM (VALUES ...)`, và câu UPDATE PHẢI tự mang `company_id = $1 AND
             parent_task_id = $parent AND deleted_at IS NULL` trong WHERE (defense-in-depth trên RLS —
             không chỉ dựa vào validate trước đó). Reorder ghi `updated_at/updated_by`; KHÔNG ghi
             activity/audit (thay đổi trình bày, không phải vòng đời) — ghi tường minh vào API-06.
      (14) QUYỀN: TÁI DÙNG create/update/delete/read:task — KHÔNG cặp mới ⇒ KHÔNG đụng TASK_PERMISSION_COUNT /
           TASK_GRANT_MATRIX / TASK_EXPECTED_GRANT_COUNTS / seed (bẫy canonical-seed-pin-regression).
           Đổi trạng thái một con đi đường `POST /tasks/:id/status` sẵn có, kiểm quyền trên CHÍNH con
           (D-39: ghi KHÔNG thừa hưởng). Nếu review đòi thêm pair ⇒ DỪNG, báo owner.
      (15) Trần 800 dòng/file: task-core.service.ts đã 37KB — nếu vượt, tách helper cây sang `task-subtree.ts`
           (thuần hàm, nhận tx), KHÔNG dựng service thứ hai có gate riêng (đó là "đường ghi thứ hai" mà
           done_when cấm).
    builder: backend-builder
    paths: ["apps/api/src/tasks/**", "apps/api/src/db/schema/workflow.ts", "apps/api/test/integration/**"]

  - id: subtask-migration
    task: >
      LANE NỐI TIẾP (cấm song song với lane migration khác) — `0503_s5_subtask1_leaf_counting.sql`, đánh số
      tiếp head 0502, band S5-TASK-SUBTASK-1, journal idx/when nối tiếp ĐƠN ĐIỆU sau 0502.
      KHÔNG có DDL cột — parent_task_id đã có từ 0478:327 + CHECK 0478:368.
      (1) INDEX vị từ lá: FK KHÔNG được Postgres tự index. Tạo
          `CREATE INDEX IF NOT EXISTS tasks_parent_active_idx ON tasks (company_id, parent_task_id)
           WHERE deleted_at IS NULL` (thuần additive). Câu kiểm trước đó phải khớp CHÍNH index này
          (rev1 tự mâu thuẫn: kiểm "index dẫn đầu bằng parent_task_id" nhưng tạo `(company_id, parent_task_id)`).
          Lợi ích thật nằm ở `countSubtaskProgressByParentIdsTx (= ANY)` + vị từ lá per-project; build MV
          toàn bảng nhiều khả năng Postgres chọn hash anti-join — đừng hứa hẹn quá mức trong header.
      (2) BACKSTOP CROSS-TENANT Ở TẦNG DB (BẤT BIẾN #1 — CLAUDE.md đòi ép ở DB, không dựa kỷ luật dev):
          FK hiện tại `parent_task_id REFERENCES tasks(id)` (0478:327) KHÔNG mang company_id, và RI check
          của Postgres BỎ QUA RLS ⇒ hiện chỉ app-check giữ. Thêm `UNIQUE (id, company_id)` trên tasks +
          FK composite `(parent_task_id, company_id) → (id, company_id)`.
          ⚠️ ĐO TRƯỚC KHI LÀM: `SELECT count(*) FROM tasks`. Bảng nhỏ (đơn công ty, N=1) ⇒ build index +
          validate FK trong migration là chấp nhận được. Nếu số hàng lớn bất ngờ ⇒ DỪNG, ghi lý do vào ADR
          và để lại app-check, KHÔNG khoá bảng dài trong migrate.
      (3) ĐỊNH NGHĨA LẠI `mv_dashboard_task_status` — ⚠️ MỞ FILE `0502_s5_dashfix1_mv_task_status_canonical.sql`
          RA ĐỌC VÀ COPY, KHÔNG VIẾT LẠI TỪ TRÍ NHỚ (lệch một nhánh CASE = đếm sai lặng lẽ cả họ task
          legacy). Giữ NGUYÊN VĂN công thức canonical D-30 (COALESCE(task_status, CASE status:
          not_started→Todo · in_progress→In Progress · waiting_review→In Review · revision→In Progress ·
          approved→Done · completed→Done · ELSE status giữ RAW fail-visible)), CHỈ THÊM vị từ lá
          COUNTABLE_CHILD (D-32/D-34):
            AND NOT EXISTS (SELECT 1 FROM tasks c
                             WHERE c.parent_task_id = t.id
                               AND c.company_id     = t.company_id
                               AND c.deleted_at IS NULL
                               AND c.task_status IS DISTINCT FROM 'Cancelled')
          3 bẫy của 0502 PHẢI GIỮ (kiểm bằng cách đọc file, không nhớ):
            – `GROUP BY company_id, 2` ORDINAL BẮT BUỘC (alias `status` trùng tên cột input; ordinal cũng
              để approved+completed gộp 1 hàng — không thì unique index build fail duplicate-key);
            – `WITH DATA` populate ngay trong migrate;
            – `CREATE UNIQUE INDEX ..._uq (company_id, status)` cột TRẦN (điều kiện sống của REFRESH
              CONCURRENTLY) + `..._company_idx` + GRANT SELECT lại cho mediaos_app + mediaos_worker
              (DROP MV làm mất grant — phải về đúng trạng thái cuối của 0103/0502).
          MV KHÔNG có RLS ⇒ service vẫn `WHERE company_id = $current` (giữ nguyên mv-dashboard.service.ts:49-65).
      (4) ⚠️ KHÔNG vá refresh bằng ALTER OWNER cho worker (nợ G14, handoff #246): worker không BYPASSRLS +
          tasks FORCE RLS ⇒ MV sẽ RỖNG LẶNG LẼ. Nếu migration làm refresh đỏ ⇒ DỪNG và báo, không tự vá
          quyền (ứng viên WO riêng S5-DASH-REFRESH-ROLE-1).
      (5) HEADER migration ghi: đây là ĐỊNH NGHĨA LẠI MV (DROP+CREATE); số đếm dashboard sẽ ĐỔI ngay sau
          migrate với tenant đã có subtask — CÓ CHỦ ĐÍCH theo D-34, trỏ ADR. KÈM KHỐI ROLLBACK dạng comment
          (DROP + CREATE lại NGUYÊN VĂN công thức 0502) theo tiền lệ 0478:405-418 — đây là đổi ngữ nghĩa
          số liệu người dùng nhìn thấy, phải có đường lùi viết sẵn.
      (6) SAU migrate: REFRESH lại MV, KHÔNG CONCURRENTLY ở lần đầu sau DROP (mirror probe-then-refresh
          dashboard-refresh.service.ts:73-98).
    builder: db-migration
    paths: ["apps/api/migrations/**"]

  - id: subtask-be-report
    task: >
      Đếm-lá cho báo cáo dự án — NỐI TIẾP be-core (dùng hàm vị từ do be-core khai). CÙNG RELEASE với
      migration-0503 và be-dashboard.
      (1) `projects.repository.ts`: countsByStatus (:804-816) · overdueCount (:818-828) · assigneeWorkload
          (:830-850) — thêm `isLeaf('tk')` của be-core. CHUẨN HOÁ alias `tk` cho cả 3 câu (hai câu đầu đang
          `from tasks` không alias) để một hàm dùng được cho cả ba; ba bản copy là ba đường trôi.
      (1b) THÊM method HẸP `countsByStatusLeafTx(tx, companyId, projectId)` (D-35) trả RIÊNG byStatus theo
          lá, KHÔNG kèm overdue/assigneeWorkload (không để widget non-sensitive chạm PII employeeName).
          `aggregateReportTx` và method hẹp DÙNG CHUNG `isLeaf('tk')` — chia sẻ vị từ, không chia sẻ method.
      (1c) NEO CHÉO chống trôi giữa 2 nguồn vị từ (hàm TS `isLeaf` và SQL viết tay trong 0503 — không có
          ràng buộc cơ học nào giữ chúng khớp nhau): comment trong `isLeaf` trỏ tên file+dòng của 0503,
          và header 0503 trỏ ngược tên hàm TS. Test "ba nguồn số khớp nhau" là lưới an toàn về hành vi.
      (2) KHÔNG đụng: task-kanban (D-36) · findMyTasksTx · me-aggregation · alerts.service ·
          task-reminder.job-handler (D-37). Ghi 1 dòng comment tại MỖI nơi không đổi, trỏ D-37, để reviewer
          và người sau biết là CHỦ ĐÍCH chứ không phải sót.
      (3) `projectReportSchema` (contracts task.ts:740-746) KHÔNG đổi hình dạng — chỉ đổi cách tính.
    builder: backend-builder
    paths: ["apps/api/src/tasks/projects.repository.ts", "apps/api/test/integration/**"]

  - id: subtask-be-dashboard
    task: >
      D-35 — widget `project-progress` dùng CHUNG công thức đếm-lá. NỐI TIẾP be-core, SONG SONG được với
      be-report (khác file), CÙNG RELEASE với cả hai + migration-0503.
      (1) `dashboard-widget-handlers.service.ts` `fetchProjectProgress` (:396-419): thay vòng lặp đếm trong
          bộ nhớ trên `tasks.listByProject(..., {limit: 200})` bằng METHOD HẸP `countsByStatusLeafTx`
          (D-35 — KHÔNG gọi `aggregateReportTx`: nó nằm sau gate view-report SENSITIVE + kèm PII
          assigneeWorkload). Giữ NGUYÊN bước authorize project TRƯỚC (:385 — listByProject chỉ tenant-guard,
          KHÔNG lọc employee-scope ⇒ bỏ authorize là mở IDOR).
          Ghi vào PR: việc này đồng thời bỏ cái CẮT-200-ÂM-THẦM có sẵn (dự án >200 task đang báo % sai) —
          sửa kèm có chủ đích, không phải scope creep ngoài luồng.
      (2) ⚠️ HÌNH DẠNG `byStatus` ĐỔI THẬT — plan rev2 nói "giữ nguyên" là SAI, phải khai đúng:
          hiện `:411` dùng key `"Unknown"` cho task_status NULL và CHỈ có key của status thực xuất hiện;
          aggregate lá coalesce NULL→`'Todo'` và luôn trả ĐỦ 5 key (kể cả 0). ⇒ MẤT key `Unknown`,
          THÊM các key giá trị 0. Kéo theo: `total` phải tự dẫn xuất = tổng 5 key LÁ (không còn là
          `rows.length`), `done` = key Done, `percent` tính lại, và `status:"Empty"` đổi nghĩa thành
          "0 task LÁ". Cập nhật spec widget + FE nếu có chỗ đọc key `Unknown`; grep trước khi sửa.
      (3) CACHE INVALIDATION (nếu không làm thì widget đứng số cũ tới hết TTL — đúng vào WO mà cả mục tiêu
          là "một con số"): `dashboard-cache-invalidation.const.ts:109` hiện CHỈ map
          `TASK_STATUS_CHANGED → PROJECT_PROGRESS`. Tạo con · xoá con · đổi cha đều đổi số đếm-lá nhưng
          KHÔNG có event nào wipe cache. THÊM `TASK_CREATED` / `TASK_DELETED` / `TASK_UPDATED` (hoặc event
          đổi-cha riêng) vào map — ⚠️ `dashboard-cache-invalidation.const.ts` là HOT-FILE: **APPEND vào map,
          KHÔNG rewrite khối** (CLAUDE.md §9.3), và để ý rail chống blanket-wipe mô tả ở `:143` — đừng
          thêm entry quét sạch mọi widget. Nếu chọn KHÔNG thêm thì phải ghi tường minh lý do + TTL vào ADR,
          không im lặng.
      (4) KHÔNG đụng các widget/alert khác (D-37).
    builder: backend-builder
    paths: ["apps/api/src/dashboard/**", "apps/api/test/integration/**"]

  - id: subtask-fe
    task: >
      FE — panel công việc con + badge tiến độ + ghi chú quy tắc đếm. CHỈ chạy sau khi contracts/web-core
      dist đã build.
      (1) MỚI `apps/app/src/routes/tasks/TaskSubtaskPanel.tsx`, mount tại `TaskDetailPage.tsx:183` NGAY
          TRƯỚC `<TaskChecklistPanel />` (subtask là phân rã công việc, đứng trên checklist; comment/
          activity/file giữ cuối). Cùng chữ ký props `{ taskId }` như 4 panel còn lại.
          CLONE PATTERN từ TaskChecklistPanel.tsx: map lỗi → i18n key (:26-34), ProgressBar (:36-49),
          optimistic + rollback (onMutate cancelQueries → setQueryData; onError rollback; onSettled
          invalidate — :66-88), gate MỌI mutate bằng `useCan(update:task)` (BE cap tiếp theo project_role
          D-24 — FE chỉ ẩn/hiện).
          Nội dung: danh sách con (tiêu đề · người thực hiện · hạn · trạng thái · cờ quá hạn), thêm con
          (title + assignee + due), sửa nhanh, xoá, ĐỔI THỨ TỰ bằng nút lên/xuống gọi TASK-API-702
          (KHÔNG thêm thư viện drag-drop — YAGNI).
          Panel CHỈ hiện khi task đang xem là GỐC (`parentTaskId == null`); mở một subtask thì thay bằng
          dòng "Thuộc công việc cha: <link>" — không mời gọi hành vi BE sẽ 400 (D-33).
          ⚠️ CON NGOÀI TẦM VỚI (D-39: đọc thừa hưởng nhưng `GET /tasks/:childId` và ghi thì KHÔNG):
          con mà actor không đọc/ghi được riêng lẻ phải render READ-ONLY — KHÔNG link (bấm vào sẽ 404),
          KHÔNG nút sửa/xoá (sẽ 403). Cần cờ từ server hoặc quy tắc suy ra rõ ràng; đừng render nút rồi
          để người dùng đâm vào lỗi.
      (2) `packages/web-core/src/lib/`: query key APPEND `subtasks: (taskId) => [...rootKeys.tasks, "subtasks", taskId]`
          cạnh query-keys.ts:437. Invalidation của MỌI mutate subtask phải chạm ĐỦ BA: `taskKeys.subtasks(parentId)`,
          `taskKeys.detail(parentId)` (subtaskDone/Total đổi) và `taskKeys.kanban(projectId)` (badge thẻ) —
          thiếu cái thứ ba thì thẻ board đứng số cũ. Client method trong `task-core-api.ts` (KHÔNG file api
          mới): listSubtasks · reorderSubtasks. Envelope MẢNG TRẦN khớp BE.
      (3) Kanban card `TaskKanbanPage.tsx:70-116` (`KanbanCardBadges`): badge thứ 4 SAU :116 — chỉ render khi
          `subtaskTotal > 0`, hiện `done/total` + % (D-34). ⚠️ early-return :79 (đang chỉ xét 3 count) PHẢI
          tính thêm subtaskTotal, nếu không thẻ có subtask mà 0 comment/file/checklist sẽ không render badge
          nào. KHÔNG đụng badge checklist.
      (4) GHI CHÚ QUY TẮC ĐẾM (bắt buộc theo D-34/D-37/D-40): helper text/tooltip ở khối số liệu báo cáo dự
          án (ProjectReportPage) — "công việc có việc con thì đếm theo việc con", vì sao số ở đây có thể
          khác danh sách, và vì sao người chỉ ôm task cha có thể hiện 0 trong biểu đồ tải. i18n vi.
      (5) Tab "Danh sách" của vỏ workspace dự án truyền `parentOnly=true` (D-36 parity Bảng↔Danh sách).
          Danh sách task TOÀN CỤC + "Việc của tôi" + "Việc quá hạn" GIỮ NGUYÊN (D-37).
      (6) i18n `apps/app/src/i18n/locales/vi/tasks.ts` (file .ts): block `detail.subtasks.*` cạnh block
          checklist (:413), `kanban.badges.subtasks` cạnh :693, nhãn activity đổi cha cạnh :475.
      (7) FE test: loading/error/empty của panel; thêm/xoá/đổi thứ tự; panel ẩn khi đang xem subtask + hiện
          link cha; badge % đúng; ghi chú quy tắc đếm render; gate update:task ẩn control.
          ⚠️ Nút disable theo `isFetching` (pattern #245) ⇒ spec phải chờ list settle trước khi click.
    builder: frontend-builder
    paths: ["apps/app/src/routes/tasks/**", "packages/web-core/src/lib/**", "apps/app/src/i18n/**"]

acceptanceChecks:
  - "ADR DECISIONS-05 (D-31…D-41) + SPEC-06 (§14.21, §24 Q#14 đóng, TASK-ERR-043…047, :401/:1096/:1007/:1911) + API-06 (701/702, :1476/:1696/:2728) + DB-06 + dòng nối DECISIONS-03 §D-30 — XONG TRƯỚC khi merge code. Đóng Q#14 và D-40 (rail avatar tính con) là quyết định sản phẩm ⇒ nhãn OWNER-CONFIRM trong ADR + mô tả PR."
  - "Độ sâu 1 cấp ép ở BE: tạo con của một con ⇒ 400 TASK-ERR-044; PATCH gán cha cho task ĐANG CÓ con ⇒ 400 TASK-ERR-045; parentTaskId = chính id ⇒ 400 (không phải 23514 raw); cha project khác ⇒ 400 TASK-ERR-046; cha company khác ⇒ 404 TASK-ERR-043."
  - "KHOÁ HÀNG là một phần của bất biến (D-33): test đồng-thời 2 tx thủ công — PATCH A{parent:B} ‖ PATCH B{parent:A} ⇒ ĐÚNG MỘT tx thắng, không tạo được chu trình; tạo con dưới P ‖ gán P.parent=Q ⇒ không sinh 3 tầng; DELETE cha ‖ POST con mới dưới cha ⇒ không còn con mồ côi sống dưới cha đã soft-delete."
  - "oldP nằm trong tập khoá (D-33): DELETE oldP ‖ PATCH T{parent:newP} ⇒ T KHÔNG bị xoá lan (deleted_at của T còn NULL) và cây kết thúc nhất quán — đây là ca mà luật khoá {T,P} của rev2 để lọt."
  - "Một luật khoá duy nhất: mọi đường (create/update/delete/reorder) khoá theo id tăng dần trên toàn bộ tập hàng sẽ chạm; chạy chéo delete ‖ update lặp nhiều lần KHÔNG sinh deadlock 40P01 thoát ra ngoài dưới dạng 500 (nếu có thì phải là 409 retry-able)."
  - "Mọi UPDATE mang vị từ cấu trúc assert số hàng ảnh hưởng; lệch kỳ vọng ⇒ rollback, không ghi thiếu im lặng."
  - "Ranh giới quyền widget (D-35): actor có read:project nhưng KHÔNG có view-report:project ⇒ widget project-progress trả 200, còn GET /projects/:id/report trả 403. Widget KHÔNG gọi aggregateReportTx và KHÔNG nhận field assigneeWorkload/employeeName (PII)."
  - "byStatus của widget đổi hình dạng có kiểm soát: mất key 'Unknown', đủ 5 key kể cả 0, total = tổng key LÁ (không phải rows.length), Empty = 0 task lá; đã grep và cập nhật mọi nơi đọc key 'Unknown'."
  - "Cache widget không đứng số cũ: tạo con / xoá con / đổi cha ⇒ PROJECT_PROGRESS bị invalidate (hoặc lý do + TTL ghi tường minh trong ADR nếu chọn không thêm)."
  - "Hệ quả #4 của D-34 được pin: chuỗi huỷ con cuối làm tổng lá đi 2 → 2 → 3, có comment trỏ ADR và có câu ghi chú tương ứng trên UI báo cáo."
  - "state_id của subtask NULL và GIỮ NULL SAU KHI ĐỔI TRẠNG THÁI: tạo con → POST /tasks/:id/status Done → assert state_id VẪN NULL + board KHÔNG đổi số đếm. (Kiểm chỉ-lúc-tạo là xanh giả — syncStateWithStatusTx sẽ ghi lại.)"
  - "effectiveProjectId thread đủ 4 cửa: tạo con trong dự án ĐÃ ĐÓNG ⇒ 400 PROJECT_CLOSED (không lọt); con không assignee ⇒ KHÔNG bị 403 CREATE_ASSIGNEE_REQUIRED oan; scope<Company không phải Owner/Manager dự án ⇒ 403; assignee là member dự án nhưng NGOÀI team của Manager ⇒ 200 (ca dùng chính D-27 còn sống)."
  - "Board CHỈ hiện cha: tạo subtask QUA API ⇒ số đếm từng cột KHÔNG đổi; GET board không chứa id con; filter parent_task_id IS NULL tại repository:278 còn nguyên. RIÊNG đường PATCH biến một thẻ đang nằm trong cột thành con ⇒ board PHẢI −1 và MV/báo cáo/% của cha mới đổi (acceptance riêng, không lẫn với đường tạo mới); gỡ cha ⇒ task thành gốc KHÔNG cột."
  - "Tiến độ (D-34): cha 3 con (1 Done, 1 Todo, 1 Cancelled) ⇒ subtaskTotal=2 subtaskDone=1; cha 0 con ⇒ không hiện %; checklist badge còn nguyên và độc lập."
  - "Hai vị từ D-32 đúng chỗ (pin bằng test): cha Todo QUÁ HẠN có ĐÚNG 1 con Cancelled ⇒ cha VẪN là lá ⇒ countsByStatus.Todo=1 và overdueCount=1 (KHÔNG rơi về 0); nhưng cha đó có 1 con Todo ⇒ cha KHÔNG phải lá. Xoá cha ⇒ con Cancelled CŨNG bị soft-delete (không mồ côi); task có con Cancelled KHÔNG được gán làm con của task khác (luật (d) dùng ACTIVE_CHILD)."
  - "Aggregate KHÔNG N+1: board N thẻ ⇒ countSubtaskProgressByParentIdsTx được gọi ĐÚNG 1 lần với đủ parentIds (assert bằng spy call-count, KHÔNG assert thời gian — assertion thời gian là flaky, cấm)."
  - "Xoá lan (D-38): xoá cha ⇒ cha + mọi ACTIVE_CHILD soft-delete trong CÙNG 1 tx, mỗi con có activity + audit; có ≥1 con ngoài phạm vi GHI ⇒ 403 TASK-ERR-047, blockedCount đúng, và deleted_at của CẢ cha lẫn MỌI con VẪN NULL. Hai phép kiểm tách bạch: chặn theo mode 'write', danh sách blocked[] theo D-39 — test riêng cho từng vế (blocked[] KHÔNG được luôn rỗng)."
  - "Đếm-lá (D-34) áp ĐÚNG 3 nơi và ba nơi KHỚP NHAU: dự án có 1 task lẻ Todo + 1 cha Todo với 2 con (1 Done, 1 Todo) ⇒ báo cáo Todo=2 Done=1 (KHÔNG 3/1); MV dashboard cùng số; widget project-progress cùng số. Test riêng: hai widget task-status và project-progress trên CÙNG dự án trả cùng byStatus."
  - "Hệ quả 'tổng nhảy không đều' pin bằng test riêng có comment trỏ ADR: task X không con, tổng lá = N; thêm con thứ nhất ⇒ tổng VẪN N; thêm con thứ hai ⇒ N+1."
  - "assigneeWorkload sau đếm-lá: người CHỈ ôm task cha (mọi con giao người khác) hiện activeCount=0 — test pin ca này tường minh (không chỉ test 'không cộng cả cha lẫn con'), kèm ghi chú UI."
  - "KHÔNG đếm-lá ở: my-tasks · overdue list · ME summary · alerts · reminder job · board — mỗi nơi có comment trỏ D-37; test regression chứng minh số ở các nơi này KHÔNG đổi khi thêm subtask."
  - "Rail avatar D-40: lọc board theo người X ⇒ thẻ cha hiện khi assignee cha là X HOẶC có COUNTABLE_CHILD giao X; con KHÔNG thành thẻ riêng; không có parentOnly ⇒ hành vi lọc cũ nguyên vẹn."
  - "Migration 0503: công thức canonical D-30 giữ NGUYÊN VĂN (chỉ thêm vị từ lá) + ordinal GROUP BY + WITH DATA + unique index cột trần + GRANT lại 2 role; REFRESH CONCURRENTLY vẫn chạy sau migrate (mirror C5 của 0502); tasks_parent_active_idx tồn tại; FK composite (parent_task_id, company_id) tồn tại và CHẶN được cha cross-tenant ở tầng DB (test insert thô); header có khối rollback."
  - "Spec dashboard cũ mv-taskstatus-canonical.int.spec.ts (C1-C6) GIỮ XANH (không có subtask ⇒ đếm-lá không đổi kết quả); test nào đỏ phải giải thích bằng D-34 chứ KHÔNG sửa test cho qua."
  - "KHÔNG cặp quyền mới: TASK_PERMISSION_COUNT · TASK_GRANT_MATRIX · TASK_EXPECTED_GRANT_COUNTS · seed KHÔNG đổi; task-permissions-seed.int.spec giữ xanh."
  - "Đường ghi state_id: KHÔNG mở TaskCorePatchValues.stateId, KHÔNG nối route mới vào setTaskStateTx (R9); chỉ có clearTaskStateForSubtaskTx và nó chỉ ghi được khi parent_task_id IS NOT NULL. Thẻ rời board có DÒNG TIMELINE (TASK_UPDATED mang old/new của parentTaskId + stateId) — không biến mất câm."
  - "MỌI writer của state_id đều bị chốt, không chỉ đường status: POST /tasks/:subtaskId/move-state ⇒ 400 và state_id vẫn NULL; PATCH /tasks/:subtaskId {stateId} ⇒ 400. Chốt nằm trong applyStateChangeTx (method dùng chung), KHÔNG vá rải ở route."
  - "Dự án của cây là bất biến (D-36a): PATCH task-CÓ-con {projectId} ⇒ 400 và không hàng nào đổi; PATCH task-LÀ-con {projectId} ⇒ 400. Không tồn tại trạng thái cha một dự án / con dự án khác."
  - "Cross-tenant: mọi route/field mới (parentTaskId trong create/update, GET subtasks, reorder) với id company B ⇒ 404, không rò tồn tại; reorder với id con của cha khác hoặc company khác ⇒ 400/404 và sort_order KHÔNG đổi hàng nào (assert giá trị trước/sau)."
  - "FE: panel đúng ngữ cảnh (ẩn khi xem subtask, thay bằng link cha); thêm/sửa/xoá/đổi thứ tự chạy; invalidate chạm đủ detail + subtasks + kanban (badge thẻ board đổi ngay); ghi chú quy tắc đếm hiện ở báo cáo dự án; i18n vi đủ key; loading/error/empty đủ."
  - "FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) + bash harness/check.sh --lane-db XANH + NGƯỜI CHỐT trước merge (crown)."

testTasks:
  - "RED cây 1 cấp (int, LANE_DB): POST /tasks parentTaskId=<con> ⇒ 400 TASK-ERR-044; PATCH task-có-con gán cha ⇒ 400 TASK-ERR-045; parentTaskId = chính id ⇒ 400 (không 500/23514); cha project khác ⇒ 400 TASK-ERR-046; cha company B ⇒ 404 TASK-ERR-043."
  - "RED đồng thời (int, 2 tx thủ công cùng lane DB): (i) PATCH A{parent:B} ‖ PATCH B{parent:A} ⇒ đúng 1 thắng, đọc lại không có chu trình; (ii) POST con dưới P ‖ PATCH P{parent:Q} ⇒ không có task nào ở tầng 3; (iii) DELETE P ‖ POST con mới dưới P ⇒ không có con sống dưới P đã soft-delete; (iv) DELETE oldP ‖ PATCH T{parent:newP} ⇒ T KHÔNG bị xoá lan (ca rev2 để lọt vì thiếu oldP trong tập khoá); (v) chạy chéo delete ‖ update ~20 vòng ⇒ không có 500 do 40P01 lọt ra ngoài."
  - "RED ranh giới quyền widget (int, D-35): actor có read:project KHÔNG có view-report:project ⇒ GET widget project-progress 200 nhưng GET /projects/:id/report 403; assert payload widget KHÔNG chứa assigneeWorkload/employeeName. Đây là test chống hồi quy cho cả tương lai (ai đó 'DRY hoá' bằng cách gọi aggregateReportTx sẽ làm test này đỏ)."
  - "RED hệ quả #4 D-34 (TÀI LIỆU SỐNG, comment trỏ ADR): P có C1(Todo)+C2(Todo) ⇒ tổng lá 2; huỷ C1 ⇒ VẪN 2; huỷ nốt C2 ⇒ 3 (P quay lại làm lá). Pin đúng chuỗi này."
  - "Int hình dạng byStatus widget: không còn key 'Unknown'; đủ 5 key kể cả 0; total = tổng key lá; dự án 0 task lá ⇒ status Empty."
  - "Int cache invalidation: tạo con → đọc widget ⇒ số MỚI (không phải số cache trước đó); tương tự khi xoá con và khi đổi cha."
  - "RED state_id sau đổi trạng thái (int): tạo con → POST /tasks/:id/status Done → state_id VẪN NULL, board không đổi. Test này ĐỎ nếu quên early-return trong syncStateWithStatusTx."
  - "RED writer còn lại của state_id (int): POST /tasks/:subtaskId/move-state ⇒ 400, state_id vẫn NULL, board không đổi; PATCH /tasks/:subtaskId {stateId} ⇒ 400. Hai route, MỘT chốt ở applyStateChangeTx — nếu ai đó vá ở route thì test kia đỏ."
  - "RED D-36a projectId (int): (a) PATCH P{projectId:X} khi P có ACTIVE_CHILD ⇒ 400 và project_id của CẢ P lẫn con KHÔNG đổi; (b) PATCH C{projectId:X} khi C là con ⇒ 400; (c) đồng thời PATCH C{parent:P} ‖ PATCH P{projectId:X} ⇒ kết thúc không có ca cha-một-dự-án/con-dự-án-khác; (d) báo cáo của cả hai dự án không có việc nào tàng hình sau các thao tác trên."
  - "RED effectiveProjectId (int, 4 nhánh): dự án đã đóng ⇒ tạo con 400 PROJECT_CLOSED; con không assignee ⇒ không 403 oan; Member (không Owner/Manager) tạo con ⇒ 403; Manager tạo con giao member dự án ngoài team mình ⇒ 200."
  - "RED board bất biến (int): đếm cột trước/sau khi tạo 3 subtask ⇒ KHÔNG ĐỔI; và test RIÊNG cho đường chuyển-đổi: PATCH một thẻ đang trong cột thành con ⇒ cột đó −1, % của cha mới xuất hiện, MV/báo cáo đổi tương ứng."
  - "RED tiến độ + hai vị từ (int): cha 3 con (Done/Todo/Cancelled) ⇒ total=2 done=1; cha Todo QUÁ HẠN + đúng 1 con Cancelled ⇒ countsByStatus.Todo=1 VÀ overdueCount=1 (chứng minh không rơi về 0); cha đó thêm 1 con Todo ⇒ cha rời tập lá."
  - "RED N+1 (int): board 10 thẻ cha mỗi thẻ 2 con ⇒ spy `countSubtaskProgressByParentIdsTx` toHaveBeenCalledTimes(1) với đủ 10 parentIds. KHÔNG assert thời gian."
  - "RED xoá lan tất-cả-hoặc-không (int, LANE_DB): cha P có C1 (actor ghi được) + C2 (ngoài phạm vi ghi) ⇒ DELETE P trả 403 TASK-ERR-047, blockedCount=1, deleted_at của P·C1·C2 VẪN NULL. Đủ quyền cả 3 ⇒ 200, cả 3 có deleted_at + activity + audit; con Cancelled cũng bị xoá; audit/activity KHÔNG bị UPDATE (append-only)."
  - "RED hai phép kiểm của D-38 tách bạch (int): dựng ca con ĐỌC được nhưng KHÔNG GHI được ⇒ nó PHẢI xuất hiện trong blocked[] (nếu dùng nhầm read-check để chặn thì test này vẫn xanh nhưng test kế đỏ); và ca con vừa không đọc vừa không ghi ⇒ vào blockedCount."
  - "RED đếm-lá báo cáo (int, LANE_DB): dự án 1 task lẻ Todo + 1 cha Todo có 2 con (Done, Todo) ⇒ countsByStatus Todo=2 Done=1; overdueCount theo lá; assigneeWorkload — người chỉ ôm cha ⇒ activeCount=0 (pin tường minh). RED trước khi sửa repository."
  - "RED ba nguồn số khớp nhau (int): trên CÙNG dự án — báo cáo dự án · MV dashboard task-status · widget project-progress trả cùng byStatus/tổng. Đây là test chống-lệch-pha giữa 0503, be-report và be-dashboard."
  - "RED 'tổng nhảy không đều' (int, TÀI LIỆU SỐNG của D-34, comment trỏ ADR): tổng lá = N; thêm con thứ nhất ⇒ VẪN N; con thứ hai ⇒ N+1."
  - "RED rail avatar D-40 (int): board lọc theo X ⇒ thẻ cha có con giao X xuất hiện dù assignee cha là Y; con không thành thẻ; bỏ parentOnly ⇒ hành vi cũ."
  - "Int reorder (TASK-API-702): thứ tự đúng theo mảng gửi lên; thiếu 1 id ⇒ 400; thừa id lạ / id con của cha khác / company B ⇒ 400-404 và sort_order KHÔNG đổi hàng nào (assert trước/sau); actor không ghi được cha ⇒ 403/404; câu UPDATE tự mang company_id + parent_task_id trong WHERE."
  - "Int GET /tasks/:id/subtasks (TASK-API-701): mảng TRẦN sắp sort_order NULLS LAST rồi created_at; đọc được cha ⇒ thấy đủ con kể cả con giao người khác (D-39, có chủ đích); task company B ⇒ 404; task không con ⇒ mảng rỗng (không 404)."
  - "Int FK composite cross-tenant (LANE_DB, insert thô bỏ qua app-layer): gán parent_task_id trỏ task company khác ⇒ DB TỪ CHỐI (chứng minh backstop tầng DB thật sự sống, không chỉ app-check)."
  - "Int regression KHÔNG-đổi (D-37): số của my-tasks · overdue list · ME summary · widget alerts · reminder job GIỮ NGUYÊN khi thêm subtask."
  - "Int cross-tenant/RLS: subtask của company A không hiện với B ở mọi route mới; rls-tenant regression xanh."
  - "Int seed pin cô lập (chống flake super-admin-bootstrap): TASK_PERMISSION_COUNT + grant count 4 role KHÔNG đổi sau WO."
  - "FE spec: panel loading/error/empty; thêm/xoá/đổi thứ tự (chờ isFetching settle trước click); panel ẩn khi xem subtask + hiện link cha; badge % trên thẻ kanban (kể cả thẻ 0 comment/file/checklist — kiểm early-return); ghi chú quy tắc đếm; gate update:task ẩn control."
  - "BƯỚC RED THỦ CÔNG CÓ BẰNG CHỨNG TRONG PR (không phải test tự động — migration áp trọn trước suite, khuôn đã dùng ở mv-taskstatus-canonical.int.spec.ts:5-7): chạy spec đếm-lá ở head 0502 ⇒ ĐỎ đúng lý do (đếm 3 Todo); áp 0503 ⇒ XANH. Dán output cả hai lần vào PR."
  - "Chạy như CI: bash harness/check.sh --lane-db (deny-path/IDOR thật sự thực thi; KHÔNG chấp nhận 'XANH KHÔNG ĐỦ BẰNG CHỨNG')."

risks:
  - "PHẠM VI LỚN NHẤT NẰM Ở ĐẾM-LÁ, KHÔNG Ở CRUD: CRUD subtask là cơ học; đổi ngữ nghĩa con số trên dashboard + báo cáo là thứ người dùng nhìn thấy và dễ báo 'bug'. Mọi thay đổi số phải có test pin + ghi chú UI."
  - "MV vừa định nghĩa lại ở 0502 (D-30) hôm qua. 0503 phải MỞ FILE 0502 RA COPY — lệch một nhánh CASE là đếm sai lặng lẽ cho cả họ task legacy."
  - "Ba nơi đếm-lá (0503 · projects.repository · widget project-progress) PHẢI cùng release. Lệch pha ⇒ hai con số vênh trên cùng một màn hình — đúng loại lỗi WO này sinh ra để tránh."
  - "Nợ G14: REFRESH MV qua workerDb hỏng từ trước (worker không phải owner). CẤM vá bằng ALTER OWNER (worker thiếu BYPASSRLS + tasks FORCE RLS ⇒ MV rỗng lặng lẽ). Chạm phải ⇒ DỪNG và báo."
  - "syncStateWithStatusTx là bẫy ẩn: nó chạy trên MỌI đổi trạng thái và chỉ né task ngoài dự án. Quên early-return cho subtask ⇒ con nhảy lên board ở đúng luồng cốt lõi (đánh dấu Done), mà test chỉ-kiểm-lúc-tạo sẽ vẫn xanh."
  - "assertTaskInScopeTx đang NÉM 404 nhưng D-38 cần vị từ boolean. Refactor phải giữ MỘT nguồn logic (check + throw), không copy — copy là chỗ hai đường quyền trôi khỏi nhau."
  - "KHOÁ là chỗ dễ sai nhất của WO: rev1 không có khoá (chu trình), rev2 có khoá nhưng hai lane mô tả hai thứ tự khác nhau ⇒ vừa thiếu oldP vừa ABBA. Nếu implementer thấy luật khoá 'rườm rà' và tự rút gọn theo đường mình đang code thì lỗ hổng quay lại NGUYÊN VẸN. Một luật, id tăng dần, toàn bộ tập hàng — không ngoại lệ."
  - "Cám dỗ DRY nguy hiểm: 'widget và report cùng đếm lá thì gọi chung một method' — SAI, hai bên nằm sau hai gate quyền khác nhau (read:project non-sensitive vs view-report:project SENSITIVE). Chia sẻ vị từ, không chia sẻ method. Test D-35 tồn tại để bắt đúng lần refactor đó."
  - "task-core.service.ts đã 37KB, gần trần 800 dòng (CLAUDE.md §5) — tách helper cây sang file thuần hàm, KHÔNG dựng service thứ hai có gate riêng (đó chính là 'đường ghi thứ hai' mà done_when cấm)."
  - "FK composite + UNIQUE(id, company_id) khoá bảng khi build. Đo count(*) trước; bảng lớn bất ngờ ⇒ DỪNG, ghi lý do vào ADR, giữ app-check."
  - "vitest full-suite api hay crash IPC trên máy này ⇒ chạy CHUNK theo module (memory vitest-worker-crash-chunked-runs); lane DB phải SẠCH trước khi kết luận đỏ."
  - "Worktree cần .env + .secrets/local-kek.bin, nếu không sẽ đỏ oan (memory worktree-missing-kek-false-red)."
```
