# DECISIONS-03: CỘT KANBAN = PIPELINE TUỲ BIẾN & NỚI FSM TASK

> **📚 Bộ tài liệu DECISIONS — Hệ thống Quản lý Doanh nghiệp**
> **DECISIONS-03 Cột Kanban & FSM Task** · (tiếp nối DECISIONS-01 Chốt câu hỏi mở · DECISIONS-02 Khoá stack & bất biến)
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Đặc tả: SPEC-06 TASK](<../SPEC/SPEC-06 TASK.md>) · [DB: DB-06](<../DB/DB-06 TASK Database Design.md>) · [API: API-06](<../API Design/API-06_TASK_API_Design.md>) · [Kế hoạch thi công: S5-TASK-PIPELINE-1](<../plans/S5-TASK-PIPELINE-1.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                                        |
| ------------- | --------------------------------------------------------------- |
| Mã tài liệu   | DECISIONS-03                                                     |
| Tên tài liệu  | Cột Kanban = pipeline tuỳ biến & nới FSM task văn phòng          |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ                             |
| Tên sản phẩm  | Enterprise Management System                                     |
| Phiên bản     | v1.0                                                             |
| Trạng thái    | 6 quyết định **Đã chốt** (18/07/2026) — Block code module TASK   |
| Giai đoạn     | Sprint 5 — redesign TASK theo chuẩn tham chiếu                   |
| Ngày tạo      | 18/07/2026                                                       |
| Ngày cập nhật | 18/07/2026                                                       |
| Người duyệt   | Cian (Product Owner)                                             |

---

## 2. Bối cảnh

Product Owner cung cấp **chuẩn tham chiếu UX** (ảnh công cụ quản lý công việc thương mại, 13/07 và 18/07/2026): board dự án có **7 cột theo quy trình sản xuất** — *Ý Tưởng–kịch bản → Thiết Kế → Quay → Hậu Kỳ → Thumbnail → Duyệt Video → SEO*.

Đó **không phải** trạng thái công việc. Đó là quy trình riêng của từng dự án. Board hiện tại của MediaOS dựng cột từ 5 trạng thái FSM cố định (`Todo · In Progress · In Review · Done · Cancelled`), nên **về cấu trúc không thể** hiển thị thứ chuẩn tham chiếu yêu cầu.

Tài liệu này chốt các quyết định làm thay đổi ngữ nghĩa đã đặc tả trong SPEC-06, và vì vậy **phải được duyệt trước khi viết code** (CLAUDE.md §1: `docs/spec/` là nguồn sự thật; code lệch spec thì spec thắng).

### 2.1 Hiện trạng đã kiểm chứng

| Hạ tầng | Trạng thái | Vị trí |
| --- | --- | --- |
| Bảng `project_states` (state tuỳ biến theo dự án) | ✅ có, RLS + FORCE đầy đủ | mig `0420_pm_foundation.sql:52-58` |
| Cột `tasks.state_id` + FK + index | ✅ có | `0420:153,164-166` |
| CRUD state (4 route + cặp quyền) | ✅ có, chạy được | `tasks/project-states.controller.ts` |
| `state_group` (`backlog·unstarted·started·completed·cancelled`) | ✅ có — **thêm `review` ở đợt này** (D-17) | `contracts/task.ts` |
| FE gọi `project_states` | ❌ **0 dòng** | — |
| Kanban dựng cột từ state | ❌ vẫn dùng 5 trạng thái cố định | `task-kanban.service.ts` |

⇒ Phần lớn công việc là **nối dây**, không phải xây mới. Không cần migration cho cột `state_id`.

---

## 3. Chi tiết các quyết định

### D-16 — Cột Kanban mang ngữ nghĩa gì?

- **Câu hỏi:** Cột trên board là **trạng thái công việc** (như SPEC-06 hiện hành) hay **pipeline tuỳ biến theo dự án**?
- **Bối cảnh & ảnh hưởng:** SPEC-06 §13.8 đặc tả *"Kanban Board là giao diện hiển thị task theo cột **trạng thái**"*; tiêu chí nghiệm thu 15-16 ghi *"Kéo thả Kanban cập nhật trạng thái nếu có quyền"*. Đổi ngữ nghĩa cột là **đổi đặc tả**, kéo theo DTO board, truy vấn nhóm, route kéo-thả, và ý nghĩa của mọi báo cáo theo cột.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Giữ cột = trạng thái (5 cột cố định) | Không đổi gì; spec nguyên vẹn | **Không thể** hiển thị pipeline sản xuất — tức không đáp ứng được yêu cầu gốc |
  | B. **Cột = `project_state` tuỳ biến, TÁCH khỏi `task_status`** | Mỗi dự án tự định nghĩa quy trình; trạng thái FSM vẫn phục vụ phê duyệt/báo cáo; hạ tầng đã có sẵn | Task mang hai chiều thông tin — phải giữ đồng bộ (xem D-17) |
  | C. Cột tuỳ biến **thay thế** trạng thái | Khái niệm đơn giản nhất | Phá workflow phê duyệt, phá báo cáo tiến độ, task sinh từ HR không map được, mất so sánh giữa các dự án |
- **Khuyến nghị:** **Phương án B.** Lớp nối là `project_states.state_group` — cột tuỳ biến vẫn quy được về nhóm chuẩn, nên báo cáo tổng hợp và so sánh giữa dự án vẫn hoạt động. Dự án chưa có state nào vẫn chạy nhánh cũ 5 cột trạng thái ⇒ không vỡ. **Lưu ý:** sau khi migration đồng bộ seed cột cho mọi dự án đang trống VÀ luồng tạo dự án seed sẵn cột, nhánh này gần như **không với tới được** — nó là lưới phòng vệ, KHÔNG phải tình huống vận hành thường gặp; đừng viết test dựa vào nó như đường chính.
- **Ảnh hưởng nếu đổi sau:** Đổi từ B về A phải backfill ngược `state_id` và viết lại board — đắt. Đổi từ A sang B sau khi người dùng đã quen 5 cột cố định còn đắt hơn vì phải đào tạo lại.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

### D-17 — Kéo thẻ giữa các cột có đổi trạng thái không?

- **Câu hỏi:** Khi kéo thẻ sang cột khác, `task_status` có tự đổi theo không?
- **Bối cảnh & ảnh hưởng:** Nếu **không** tự đổi, người dùng sống trong board sẽ không bao giờ bấm nút đổi trạng thái riêng ⇒ `task_status` đóng băng ở `Todo` toàn hệ thống. Kéo theo: `countsByStatus` sai · `isOverdue` **luôn true** (tính theo `task_status NOT IN ('Done','Cancelled')`) · `completed_at` luôn NULL · sự kiện `TASK_STATUS_CHANGED` không bao giờ phát.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Tách hoàn toàn, người dùng tự đổi trạng thái | Không đụng FSM | Trạng thái mục ruỗng theo thời gian; mọi báo cáo sai một cách âm thầm |
  | B. **Auto-map `state_group` → `task_status` qua chính `changeStatus`** | Báo cáo luôn đúng; đi qua FSM nên giữ audit + thông báo | Phải nới FSM (xem D-18); phải tách lõi nhận transaction (xem §4.1) |
  | C. Cột đi trước, trạng thái theo sau khi hợp lệ | Không cần đổi FSM nhiều | Cột và trạng thái lệch nhau âm thầm — tái lập đúng vấn đề của phương án A |
- **Khuyến nghị:** **Phương án B**, với ánh xạ: `backlog|unstarted → Todo` · `started → In Progress` · `review → In Review` · `completed → Done` · `cancelled → Cancelled`. Kéo giữa hai cột **cùng nhóm** ⇒ không đổi trạng thái, không phát sự kiện rác.

  **Bộ cột mặc định gồm 6 cột** (Backlog · Cần làm · Đang làm · **Chờ duyệt** · Hoàn thành · Đã huỷ) — phủ đủ 6 nhóm. Suy ra từ chính quyết định thêm nhóm `review`: nếu bộ mặc định không có cột nhóm `review` thì dự án dùng mặc định vẫn không sinh được `In Review` từ board, tức quyết định trên không có hiệu lực thực tế.

  **Bổ sung nhóm `review` (chốt 18/07/2026).** Tập nhóm gốc chỉ có 5 giá trị và **không nhóm nào sinh ra `In Review`** ⇒ sau thay đổi này sẽ không thao tác board nào tạo được trạng thái "chờ kiểm tra", và cột duyệt (ví dụ *Duyệt Video*) mang trạng thái `In Progress` ⇒ báo cáo "chờ duyệt" chết hẳn. Vì vậy thêm giá trị thứ sáu `review` vào `state_group` — cần migration đổi CHECK trên `project_states`.
- **Ảnh hưởng nếu đổi sau:** Nếu ship A rồi sửa: dữ liệu trạng thái tích luỹ đã sai, phải backfill từ vị trí cột — suy đoán, không chính xác.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

### D-18 — Có nới bảng chuyển trạng thái (FSM) không?

- **Câu hỏi:** FSM hiện cấm nhảy cấp (`Todo` chỉ đi được tới `In Progress`/`Cancelled`) và cấm mở lại (`Done` là ngõ cụt). Có nới không?
- **Bối cảnh & ảnh hưởng:** Trên board 7 cột, kéo *Ý Tưởng* thẳng sang *SEO* là thao tác **hằng ngày**. Với FSM hiện hành, thao tác đó trả `409 TASK-ERR-WORKFLOW-INVALID` và thẻ bật về chỗ cũ — tức đánh nhau với chính mục tiêu của thay đổi. Trong sản xuất video, **trả về sửa** cũng là việc bình thường, nhưng `Done → {}` cấm tuyệt đối.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Giữ FSM chặt | Kỷ luật quy trình ép ở tầng dữ liệu | Kéo vượt cấp và kéo ngược đều lỗi ⇒ board không dùng được |
  | B. Tự đi qua các bước trung gian | Giữ kỷ luật, audit ghi đường đi | Đường lùi vẫn tắc (`In Progress` không có đích `Todo`) ⇒ vẫn phải nới; phức tạp hơn mà không triệt để |
  | C. **Nới cho nhảy cấp mọi hướng giữa 4 trạng thái hoạt động** | Board dùng được tự nhiên; kỷ luật chuyển sang thứ tự cột — nơi người dùng **nhìn thấy được** | Mất luật "phải qua In Review trước Done" ở tầng dữ liệu |
- **Khuyến nghị:** **Phương án C.** Bảng chuyển mới: `Todo`/`In Progress`/`In Review`/`Done` đi được tới nhau và tới `Cancelled`; `Cancelled → {Todo, In Progress}` để khôi phục.
  **Vai trò còn lại của FSM** (không phải bỏ FSM):
  1. Chặn sửa task đã huỷ ở các đường **khác** đổi trạng thái — giao việc / đổi ưu tiên / đổi hạn vẫn trả 422.
  2. Sinh audit + sự kiện `TASK_STATUS_CHANGED` chuẩn cho **mọi** lần đổi.
  3. Giữ nguyên luật cho task do workflow điều khiển (`WORKFLOW_TASK_TYPES`) — board pipeline không áp cho nhóm đó.
  **Phạm vi:** chỉ đổi FSM của task văn phòng (`task_status`). Task duyệt đơn HR dùng cột `status` legacy riêng nên luồng nghỉ phép / điều chỉnh công **không đổi** — lưu ý `'hr'` không nằm trong `WORKFLOW_TASK_TYPES` nên vẫn gọi được đổi trạng thái, chỉ là không lên board vì `project_id` NULL; **không** khẳng định tuyệt đối là "hoàn toàn không ảnh hưởng".
- **Ảnh hưởng nếu đổi sau:** Siết lại FSM sau khi người dùng đã quen kéo tự do sẽ làm hỏng thói quen và tạo dữ liệu không hợp lệ theo luật mới. Nếu sau này cần ép duyệt cứng cho một loại việc, làm bằng **khoá cột theo quyền**, không quay lại dựa vào FSM.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

### D-19 — Mốc thời gian hoàn thành khi mở lại task

- **Câu hỏi:** Kéo thẻ ra khỏi cột nhóm `completed` thì `completed_at` giữ hay xoá?
- **Bối cảnh & ảnh hưởng:** Repository **đã hỗ trợ** nhánh `'clear'` nhưng chưa nơi nào dùng — `changeStatus` chỉ truyền `'now' | 'keep'`. Nếu giữ, task đang `In Progress` vẫn mang `completed_at` + `completed_by` cũ ⇒ chỉ số lead-time và báo cáo sai.
- **Khuyến nghị:** Rời `Done` ⇒ `completedAt: 'clear'` + `completedBy` null. Rời `Cancelled` ⇒ `cancelledAt: 'clear'`. Một chiều, không có ngoại lệ.
- **Ảnh hưởng nếu đổi sau:** Dữ liệu lịch sử đã bẩn thì không khôi phục được mốc đúng.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

### D-20 — Đồng bộ lại `state_id` cho dữ liệu đang có

- **Câu hỏi:** Dữ liệu `state_id` hiện tại lệch pha với `task_status`. Sửa bằng migration hay suy ra lúc đọc?
- **Bối cảnh & ảnh hưởng:** Mig 0420 backfill `state_id` từ cột **`status` legacy** (0420 chạy **trước** 0478 sinh ra `task_status`), trong khi Kanban đọc `task_status`. Task tạo sau 0420 có `state_id = NULL` vì đường ghi core không set. ⇒ **Chuyển board sang nhóm theo `state_id` mà không đồng bộ sẽ dồn phần lớn thẻ về một cột.**
- **Khuyến nghị:** Migration riêng (tách khỏi migration seed quyền để rollback độc lập), hai bước: (a) seed đủ state cho mọi dự án đang có 0 state; (b) map `state_id` từ `task_status` theo `state_group`, **không** map theo tên (tên cột đổi được qua API nên không ổn định).
  **Ràng buộc bắt buộc:** task có `task_status IS NULL` (dữ liệu trước 0478) mà `state_id` đã đúng thì **giữ nguyên** — quy tắc "NULL thì gán mặc định" sẽ đẩy task đã hoàn thành hợp lệ về cột đầu, đúng loại lỗi mất-dữ-liệu-thị-giác mà thay đổi này sinh ra để tránh.
- **Bảng ánh xạ NGƯỢC `task_status → state_group`** — dùng chung cho migration đồng bộ và cho D-21:

  | `task_status` | Nhóm cột đích |
  | --- | --- |
  | `Todo` | `unstarted` — chỉ rơi xuống `backlog` khi dự án **không có** cột nhóm `unstarted` nào |
  | `In Progress` | `started` |
  | `In Review` | `review` |
  | `Done` | `completed` |
  | `Cancelled` | `cancelled` |

  Bảng này bắt buộc phải có vì ánh xạ xuôi **không song ánh**: `backlog` và `unstarted` cùng cho ra `Todo`, nên chiều ngược có hai ứng viên. Không ghim thì bậc thang bên dưới rơi vào cột `sort_order` nhỏ nhất — tức **cột `Backlog`**, đúng cột mà §4.5 hứa *"luôn rỗng"*. Hai chỗ sẽ tự đá nhau ở đường chạy thật.

- **Quy tắc phải XÁC ĐỊNH (không được để implementer tự đoán):**
  1. **Bậc thang tìm cột đích** khi dự án có cột tự tạo mà thiếu nhóm cần: nhóm đích → cột `is_default` → cột `sort_order` nhỏ nhất.
  2. **Thứ tự phân định** `ORDER BY sort_order, created_at, id`. Bắt buộc vì `sort_order` mặc định là 0 nên nhiều cột cùng nhóm có thể trùng giá trị, và **`is_default` KHÔNG unique ở tầng cơ sở dữ liệu** — tính duy nhất chỉ được ép ở tầng ứng dụng. Không ghim thứ tự thì migration vùng đỏ không tái lập được kết quả, tức không kiểm chứng được.
  3. **Đổi tên 4 cột mặc định sang tiếng Việt** (Backlog giữ nguyên) (Backlog · Cần làm · Đang làm · Hoàn thành · Đã huỷ) cho dữ liệu đã seed bằng tiếng Anh, để toàn hệ thống có một bộ tên duy nhất. Lưu ý chỉ mục duy nhất là `(company_id, project_id, name)` nên seed thêm bộ tên mới vào dự án đã có bộ cũ sẽ **không** bị chặn ⇒ phải ĐỔI TÊN, không được seed đè.
- **Ảnh hưởng nếu đổi sau:** Nếu ship board mới trước khi đồng bộ, người dùng thấy toàn bộ công việc dồn một cột — mất niềm tin vào số liệu, rất khó lấy lại.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

### D-21 — Đổi trạng thái ngoài board thì thẻ có tự chuyển cột không?

- **Câu hỏi:** D-17 chỉ ràng buộc chiều **cột → trạng thái**. Chiều ngược thì sao — người dùng bấm "Hoàn thành" ở màn chi tiết, thẻ trên board có tự sang cột *Hoàn thành* không?
- **Bối cảnh & ảnh hưởng:** Đây là lỗ hổng phát hiện ở vòng soát thứ hai của lane này. Hiện có **ba** đường đổi trạng thái đang sống, **không đường nào ghi `state_id`**:

  | Route | Cổng quyền |
  | --- | --- |
  | `PATCH /tasks/:id/status` (cũ) | `update:task` |
  | `POST /tasks/:id/change-status` | `update-status:task` |
  | `POST /tasks/:id/move` (kéo thả **cũ**) | `update-status:task` |

  Hai hậu quả:
  1. **Lệch pha ngược, gặp hằng ngày.** Trước đây board đọc trạng thái nên luôn khớp. Sau đợt này board đọc cột ⇒ mọi thao tác đổi trạng thái ngoài board trở nên **vô hình trên board** — thẻ đứng nguyên cột cũ dù đã Hoàn thành. Đúng hàng rủi ro "Cột và trạng thái lệch nhau" mà chính SPEC-06 §23 liệt kê.
  2. **Cổng quyền bị vòng qua.** `POST /tasks/:id/move` là route kéo-thả cũ, gate **chỉ** `update-status`. Ai có quyền đó mà không có `update-state` vẫn kéo được thẻ qua route cũ ⇒ tuyên bố "`update-state` là cổng của kéo thả" ở tiêu chí nghiệm thu 16 **sai chừng nào route đó còn sống**.
- **Khuyến nghị (đã chốt):** **Đồng bộ hai chiều + khai tử route cũ.**
  1. `changeStatusTx` sau khi đổi trạng thái thành công thì **cũng chuyển `state_id`** sang cột thuộc nhóm tương ứng, **trong cùng giao dịch**.
  2. **Không chuyển nếu thẻ ĐÃ ở cột đúng nhóm.** Bắt buộc — nếu không, đặt trạng thái `In Progress` cho thẻ đang ở cột *Hậu Kỳ* sẽ **giật thẻ về cột *Quay*** (cột đầu cùng nhóm `started`), tức thao tác vô hại lại làm mất vị trí công việc.
  3. Chọn cột đích trong nhóm theo đúng bậc thang của D-20: cột `is_default` → `sort_order` nhỏ nhất, tie-break `ORDER BY sort_order, created_at, id`. Ánh xạ ngược **không đơn trị** (`Todo` ứng cả `backlog` lẫn `unstarted`) nên phải ghim quy tắc, không để suy đoán.
  3b. **Guard ở điểm 2 là BẤT BIẾN BẢO ĐẢM DỪNG, không chỉ là trải nghiệm.** Hệ hai chiều này dừng nhờ hai phanh độc lập: phanh phía trạng thái (máy trạng thái coi là không-thay-đổi khi trạng thái đích trùng hiện tại) và **phanh phía cột chính là guard này**. Bỏ guard 2 — ví dụ một lần dọn dẹp đổi nó thành *luôn chuẩn hoá về cột đại diện của nhóm* — sẽ **không** treo máy, mà **âm thầm hoàn tác thao tác của người dùng**: kéo thẻ vào *Hậu Kỳ*, thẻ nhảy về *Quay*. Kiểm thử TASK-TC-026h (*không giật cột*) chính là thứ bảo vệ tính dừng — đừng xoá nó khi tái cấu trúc.

  3c. **Thứ tự đọc bắt buộc:** guard 2 phải đọc `state_id` **sau khi ghi**, trong cùng giao dịch. Nếu nó đọc bản chụp lấy **trước** lúc ghi — rất dễ xảy ra sau khi tách lõi nhận giao dịch ở §4.1 — thì guard thấy cột **cũ**, kết luận *sai nhóm*, và dời thẻ thêm một lần nữa. Đúng ca mà điểm 2 sinh ra để chặn, nhưng thua vì thứ tự đọc.

  4. **Khai tử** `POST /tasks/:id/move` và `PATCH /tasks/:id/status` theo mô hình mở-rộng-rồi-thu-hẹp (2 đợt phát hành): đợt này đánh dấu ngừng dùng và chuyển FE sang route mới; đợt sau mới gỡ. Gỡ ngay khi mã nguồn/FE còn gọi sẽ tạo cửa sổ lỗi cho người dùng thật.
- **Ảnh hưởng nếu đổi sau:** Để lệch pha tồn tại một thời gian rồi mới sửa thì phải quét toàn bộ task đoán lại cột đúng từ trạng thái — mà ánh xạ ngược không đơn trị, nên chỉ đoán được gần đúng.
- **Người quyết định / Trạng thái:** **Đã chốt** — Cian (PO), 18/07/2026

---

## 4. Ràng buộc kỹ thuật bắt buộc (không phải quyết định — là hệ quả)

### 4.1 Phải tách lõi nhận transaction trước khi auto-map

`changeStatus` hiện **tự mở transaction**. Gọi nó từ bên trong một transaction khác sẽ là **hai kết nối**, và transaction con chờ khoá dòng mà transaction cha đang giữ ⇒ **tự khoá chết** cho tới khi hết thời gian chờ. Bắt buộc tách `changeStatusTx(tx, …)` làm lõi và biến `changeStatus` thành lớp bọc mỏng.

Cùng lý do: `checklistBlocksDone` gọi hàm đọc cấu hình vốn **tự mở transaction** riêng — đọc cấu hình **trước** khi mở transaction, hoặc bổ sung biến thể nhận `tx`. Lỗi này không làm khoá chết (khác bảng) nhưng **cạn pool dưới tải**, và một test chạy đơn lẻ trên pool rảnh **sẽ không bắt được** ⇒ phải sửa theo cấu trúc.

### 4.2 Cổng quyền không được biến mất khi tách lõi

Cổng 403 duy nhất của đường đổi trạng thái nằm **ngoài** transaction. Tách lõi ra là mất cổng. Do đó đường kéo thẻ phải:

- Xin quyền **riêng biệt** cho hai việc: đổi cột (`update-state:task`) và đổi trạng thái (`update-status:task`).
- Chỉ đòi quyền đổi trạng thái **khi auto-map thực sự phải đổi** — kéo trong cùng nhóm thì không.
- **Không** truyền phạm vi của quyền đổi cột vào lõi đổi trạng thái (sẽ thành thao tác rộng hơn quyền thật).

### 4.3 Gate phải đặt ở phương thức dùng chung, không ở route

`stateId` vào được hệ thống qua **ba** đường: kéo thẻ, sửa task, và **tạo task** (nút "Thêm công việc" ở đáy mỗi cột). Nếu chỉ gắn kiểm tra ở route kéo thẻ thì hai đường kia tạo ra dữ liệu lệch pha ngay từ đầu. Riêng đường **tạo**: phải suy `task_status` khởi tạo từ nhóm của state được chỉ định, không hardcode `Todo`.

### 4.4 Bộ lọc board

Board **chỉ hiện task cha** (`parent_task_id IS NULL`) — quyết định về công việc con nằm ở kế hoạch `S5-TASK-SUBTASK-1`. Bộ lọc này phải có **ngay** ở đợt đổi board, dù công việc con chưa được xây.

### 4.5 Hệ quả cần ghi nhận

- Nhánh `409 TASK-ERR-WORKFLOW-INVALID` sau khi nới trở nên **gần như không với tới** (ca từ chối thật còn lại: task đang `Cancelled` kéo tới đích ngoài `{Todo, In Progress}`). Các test cũ khẳng định 409 phải **viết lại theo ca đó**, KHÔNG xoá.
- Cột `Backlog` do mig 0420 tạo sẽ **luôn rỗng** sau khi đồng bộ, vì `task_status` không có giá trị tương ứng. Không phải lỗi — cần nói rõ trong ghi chú phát hành.
- **Nhật ký đổi cột không nhất thiết cần đổi ràng buộc.** Ràng buộc `chk_task_activity_target_type` chỉ kiểm cột `target_type`; cột `action` **không có ràng buộc nào**. Nếu bản ghi đổi cột dùng `target_type='Task'` thì **không cần** thao tác đổi ràng buộc. Chỉ cần đổi nếu chọn một `target_type` mới. Ghim cặp `(action, target_type)` trong DB-06 trước khi code, đừng để lane migration tự đoán.
- Còn **hai đường ghi `state_id` không qua cổng** trong cây mã (đều là mã chết, không route nào tới). **Không được nối route vào chúng** nếu chưa áp quy tắc §4.2–4.3.

---

## 4b. Phương án rollback

Phải nói thẳng: **thay đổi này không rollback sạch được.** Ba phần có mức độ hoàn tác rất khác nhau.

| Phần | Hoàn tác được? | Cách |
| --- | --- | --- |
| Seed quyền đổi cột | ✅ có | Thu hồi grant. **Bắt buộc tách 2 lần phát hành** (expand-contract): thu hồi quyền khi mã nguồn còn kiểm tra quyền đó sẽ tạo cửa sổ 403 cho người dùng thật. |
| Đồng bộ `state_id` | ⚠️ **một chiều** | Không khôi phục được giá trị cũ (giá trị cũ vốn đã sai — map từ cột trạng thái legacy). Chỉ **chạy lại được** vì viết idempotent. Muốn quay lại thực sự phải sao lưu bảng trước khi chạy. |
| Nới bảng chuyển trạng thái | ❌ **một chiều** | Sau khi nới, hệ thống sẽ sinh ra dữ liệu **hợp lệ theo luật mới nhưng không hợp lệ theo luật cũ** (task đi thẳng `Todo → Done`, task khôi phục từ `Cancelled`). Siết lại không chỉ là đổi bảng — phải quét toàn bộ dữ liệu đã sinh và quyết định xử lý từng ca. Đó là một Work Order riêng, không phải một lần revert. |

**Thứ tự triển khai bắt buộc.** Migration đồng bộ `state_id` phải chạy **trước** khi giao diện board mới bật. Chạy trước mà board cũ còn hoạt động thì vô hại (board cũ đọc trạng thái, không đọc cột). Chạy sau thì người dùng thấy công việc dồn về một cột — đúng thứ D-20 sinh ra để tránh.

**Cách lùi an toàn nhất nếu board mới có vấn đề:** tắt ở tầng giao diện (quay về hiển thị theo trạng thái), **không** cố lùi dữ liệu. Dữ liệu sau đồng bộ vẫn đúng cho cả hai cách hiển thị.

---

## 4c. Hành vi biên đã biết

- **Dự án chỉ còn đúng một cột.** Board vẫn hiển thị bình thường (một cột), không lỗi, không mất thẻ — nhưng không kéo đi đâu được. Chấp nhận; không đặt luật số cột tối thiểu.
- **Cột bị xoá mềm còn tham chiếu mồ côi.** Chức năng xoá cột chặn khi còn công việc đang sống, nhưng phép đếm chỉ tính công việc chưa xoá mềm ⇒ công việc đã xoá mềm vẫn giữ `state_id` trỏ tới cột đã xoá. Không sửa ở đợt này; khi khôi phục công việc phải kiểm cột còn sống, nếu không thì đưa về cột mặc định.
- **Quyền quản lý cột đã có sẵn nhưng cấp theo kiểu cũ.** 4 cặp quyền quản lý cột được cấp bằng câu lệnh gộp theo loại tài nguyên, nên **vai trò tạo sau lần seed đó không có quyền** (bẫy đã biết: grant gộp gây lệch theo vai trò). Nói "CRUD cột chạy được" là đúng với 4 vai trò chuẩn, không đúng tuyệt đối.

---

## 5. Tài liệu phải cập nhật theo

| Tài liệu | Mục | Nội dung đổi |
| --- | --- | --- |
| SPEC-06 | §6.8 · §6.10.1 · §8.2 · §9 · §11.7 · §13.8 · §14.11 · §14.13 · §16.3 · §18.2 · nghiệm thu 15-16 · §22 (TC-025→026h) · §23 | Cột = pipeline; bảng chuyển FSM mới; quyền hai tầng; ma trận role×scope; mã API mới; đồng bộ hai chiều |
| API-06 | §15 | Route đổi cột + cặp quyền `update-state:task` |
| DB-06 | §3.3, §4.9b (mới), §5 ERD, §6 danh sách bảng, §7.x (mới) | Thiết kế bảng `project_states` + ngữ nghĩa `state_id` và quan hệ với `task_status` |
| DB-06 | §4.10, §8.9 | Bổ sung action nhật ký cho việc đổi cột |
| DB-06 | §12.1, §12.2, §18.2, §18.3 | Ma trận role×scope cho quyền đổi cột — **đây là nguồn migration mirror theo**, không phải file kế hoạch |
| API-06 | §6.4, §10.5, §25, §26 | Quyền mới · mã `TASK-API-213` · mã lỗi cho cột không hợp lệ |
| `permission-matrix-spec.md` | nhóm mã TASK | Quyền đổi cột (phân quyền hợp nhất) |
