# ADR-0016 — Approval = một nguồn sự thật duy nhất (`approval_requests`)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0009](0009-audit-outbox-event-bus.md), [0010](0010-permission-engine-4-tier.md); ERD: [`../erd-v2.md` §8](../erd-v2.md)

## Bối cảnh

ERD gốc có **3 cơ chế mang trạng thái duyệt chồng nhau**, quan hệ chưa rõ:

1. `workflow_step_instances` tự mang `reviewer_user_id` + `approved_at` + `status` (`approved`/`revision`).
2. `approval_requests` + `approval_steps` (duyệt đa cấp, có `current_level`/`max_level`).
3. `defects` (trả sửa, có `responsible_user_id`, `locked_scope_json`).

Câu hỏi không trả lời được: duyệt **1 cấp** thì ghi ở đâu — trực tiếp vào `workflow_step_instances.status` hay đi qua `approval_requests`? Nếu mỗi nơi tự ghi → **hai chỗ lưu trạng thái duyệt** → bug đồng bộ kinh điển (step đã `approved` nhưng `approval_request` còn `pending`, hoặc ngược lại).

## Quyết định

**`approval_requests` + `approval_steps` là nguồn sự thật DUY NHẤT cho MỌI hành vi duyệt**, kể cả duyệt 1 cấp.

1. **Mọi bước cần duyệt → tạo 1 `approval_request`** (1 cấp ⇒ `max_level = 1` + đúng 1 `approval_steps`). Không có "đường tắt" ghi thẳng `workflow_step_instances.status = approved` từ controller.
2. **`workflow_step_instances.status` / `approved_at` là PROJECTION (bản phản chiếu)** — chỉ được cập nhật bởi **event consumer** khi `approval_request` hoàn tất, KHÔNG ghi trực tiếp. Luồng: `approval_steps.decision` được ghi → cập nhật `approval_requests.status` → emit `approval.completed` qua **outbox** (ADR 0009) → consumer cập nhật `workflow_step_instances`.
3. **`workflow_step_instances.reviewer_user_id`** giữ nghĩa "người **nên** duyệt mặc định" (gợi ý/định tuyến). Người **thực sự** quyết + thời điểm quyết nằm ở `approval_steps.approver_user_id` + `decided_at`. `approved_at` trên step chỉ là gương soi.
4. **`defects` KHÔNG phải một thẩm quyền duyệt** — nó là **bản ghi chi tiết của một quyết định `revision_requested`**. Khi người duyệt chọn "trả sửa" (chọn bước lỗi + người chịu trách nhiệm), hệ thống tạo `defects` (gắn `workflow_step_instance_id` + `responsible_user_id`) **như hệ quả** của `approval_steps.decision = revision_requested`, không phải một kênh duyệt song song.

## Lý do

- Một nguồn sự thật ⇒ không bao giờ có trạng thái mâu thuẫn giữa step và approval.
- Đồng nhất 1 cấp và đa cấp ⇒ khi G5b mở 3 cấp, **không phải viết lại** luồng (chỉ tăng `max_level`).
- Projection-qua-event ăn khớp luật phụ thuộc trong CLAUDE.md: audit + outbox có **trước** mọi module.

## Hệ quả

- MVP-0 (G4-5) tuy là duyệt 1 cấp vẫn **bắt buộc** đi qua `approval_requests` (`max_level=1`).
- Consumer cập nhật step phải **idempotent** (qua `processed_events`, ADR 0009 / erd-v2 §1.2).
- Cấm pattern `UPDATE workflow_step_instances SET status='approved'` trong service nghiệp vụ — chỉ consumer được làm. Thêm vào review FULL gate khi diff chạm approval/workflow.
- `approval_requests` nhắm tới mục tiêu bằng **FK thật** (`workflow_step_instance_id` / `task_id`), không polymorphic — xem ADR-quan-hệ trong erd-v2 §9 (#5).

## Phương án đã loại

- **Mỗi step tự duyệt, `approval_requests` chỉ cho đa cấp:** sinh 2 nguồn sự thật, đúng cái bug cần tránh.
- **Bỏ `approval_requests`, nhồi mọi thứ vào `workflow_step_instances`:** không biểu diễn được đa cấp/đa người duyệt; vỡ khi lên 3 cấp (G5b).
- **Ghi đồng thời cả hai trong cùng transaction (không qua event):** vẫn 2 bản chép trạng thái, dễ lệch khi 1 trong 2 lỗi; mất tính idempotent/replay của outbox.
