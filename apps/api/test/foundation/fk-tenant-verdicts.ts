/**
 * S6-SEC-XTENANTFK-1 (KI-046) — SỔ PHÁN QUYẾT cho khoá ngoại một-cột nối hai bảng tenant.
 *
 * LUẬT: sau mig `0535`, **mọi** cặp FK một-cột giữa hai bảng tenant phải hoặc (a) đã có composite FK
 * `(company_id, col)` phủ lên, hoặc (b) có MỘT DÒNG Ở ĐÂY với lý do. Cặp mới xuất hiện mà không thuộc
 * hai nhóm đó ⇒ `xtenant-fk-ratchet.int-spec.ts` ĐỎ.
 *
 * ⟲ S10-SEC-FKCATALOG-1 (KI-055) — luật nay có **BA** ô hợp lệ, không phải hai: thêm (c) **guard
 * trigger `enforce_company_id_catalog_fk` đang ACTIVE** khớp cặp (mig `0547`, dành cho lớp G nơi
 * composite FK phá tham chiếu toàn cục). Vẫn **KHÔNG có ô thứ TƯ**, và (b)+(c) cùng lúc cũng ĐỎ
 * (đã vá rồi mà vẫn để waiver "cho chắc" là cách sổ này mục ruỗng).
 *
 * Vì sao cần sổ này thay vì chỉ đếm số: lớp lỗi KI-036/KI-028 cho thấy con số baseline một mình chỉ
 * chặn được "nhiều hơn", không chặn được "đổi cặp này lấy cặp kia". Khoá theo TÊN CẶP thì không.
 *
 * ⚠️ THÊM DÒNG VÀO ĐÂY = TUYÊN BỐ CÓ CHỦ ĐÍCH, phải qua FULL gate. Mặc định của một bảng tenant mới
 * là VÁ (thêm composite FK ở migration), không phải xin waiver.
 */

export interface FkWaiver {
  /** Khoá `src.col -> tgt` — khớp `pairKey()` của census. */
  pair: string;
  /**
   * Vì sao KHÔNG vá được cặp này. Câu này là thứ người sau đọc, viết cho người đọc.
   *
   * ⚠️ S10-SEC-FKCATALOG-1: lý do CŨ ("composite FK sẽ phá tham chiếu toàn cục") **không còn đủ** —
   * WO đó chứng minh có cách vá KHÁC composite FK (trigger `enforce_company_id_catalog_fk`, mig
   * `0547`). Waiver lớp G mới vì thế BẮT BUỘC có dạng "…, due date YYYY-MM-DD, theo dõi ở WO <mã>";
   * ratchet (l) **parse ngày đó** và ĐỎ khi quá hạn (khớp regex thôi thì `due date 2020-01-01` sẽ
   * xanh vĩnh viễn và van an toàn thành cửa mở).
   */
  reason: string;
  /** Ai/việc nào ký. */
  signedBy: string;
}

/**
 * LỚP G — bảng ĐÍCH là catalog TOÀN CỤC (`company_id` NULLABLE, hàng `company_id IS NULL` dùng chung
 * cho mọi tenant). Composite FK `(company_id, col) → parent(company_id, id)` ở đây **PHÁ tham chiếu
 * hợp lệ**: hàng con mang `company_id = A` trỏ tới hàng cha `company_id = NULL` bị từ chối ⇒ không gán
 * được role hệ thống, không cấu hình được widget/notification template dùng chung.
 *
 * ⟲ S10-SEC-FKCATALOG-1 (KI-055) — **SỔ NÀY NAY RỖNG: 11 → 0.** 11 cặp lớp G từng ký waiver ở
 * `S6-SEC-XTENANTFK-1` đã được vá bằng cơ chế KHÁC composite FK: trigger
 * `enforce_company_id_catalog_fk` (mig `0547`) — "cha phải CÙNG TENANT **HOẶC** là hàng toàn cục
 * (`company_id IS NULL`)". Đo trước khi vá: **11/11 cặp GHI THÀNH CÔNG** hàng lệch tenant dưới
 * `mediaos_app` + GUC; sau khi vá: 11/11 bị chặn `23503 catalog_fk_tenant_mismatch`, và tham chiếu
 * tới hàng toàn cục vẫn ghi được (ca ALLOW). Cơ chế + 2 hướng bị loại: `DECISIONS-10`.
 *
 * ⚠️ GIỮ mảng (rỗng) + kiểu `FkWaiver` làm VAN AN TOÀN cho cặp lớp G MỚI trong tương lai — nhưng lý do
 * ký nay phải KHÁC lý do cũ (xem doc-comment của `FkWaiver.reason`): mặc định của một cặp lớp G mới là
 * **thêm trigger guard** (chi phí biên = 1 dòng `CREATE TRIGGER`, hàm đã có sẵn), không phải xin miễn.
 *
 * Ratchet ép ba trạng thái hợp lệ cho một cặp còn hở, KHÔNG có ô thứ tư: `covered` (composite FK)
 * **HOẶC** guard `*_catalog_fk` đang ACTIVE khớp cả bảng cha lẫn cột FK **HOẶC** waiver CÒN HẠN.
 */
export const FK_TENANT_WAIVERS: readonly FkWaiver[] = [];

/**
 * S10-SEC-FKCATALOG-1 — SÀN GUARD LỚP G, đo trên lane `mediaos_fkcatalog` sau mig `0547` (2026-08-25):
 * **11 cặp lớp G, 11 trigger guard ACTIVE, 0 waiver**.
 *
 * Pin để lưới không âm thầm co về rỗng: nếu ai DROP trigger (hoặc `ALTER TABLE … DISABLE TRIGGER`) thì
 * số cặp "đã có guard" tụt xuống và ratchet (l) ĐỎ, thay vì cả bộ assert xanh vì không còn gì để kiểm.
 */
export const FK_LAYER_G_GUARD_FLOOR = 11;

/**
 * MỐC SÀN. Đo lại 2026-08-28 trên lane `mediaos_wfcluster2` (head **0548**): **423** FK một-cột giữa
 * hai bảng tenant. Sàn đặt ĐÚNG BẰNG số đo — pin để lưới không âm thầm co về rỗng (bộ lọc sai ⇒ 0 cặp
 * ⇒ mọi assert xanh vô nghĩa).
 *
 * ⚠️ **440 → 423 LÀ HẠ SÀN, VÀ ĐÂY LÀ LÝ DO BẰNG VĂN BẢN.** `S10-CLEAN-WORKFLOWCLUSTER-2` DROP 14 bảng
 * của cụm workflow/approval + 4 cột FK (`tasks.workflow_step_id` · `tasks.workflow_instance_id` ·
 * `evaluation_results.workflow_step_id` · `bonus_penalties.defect_id`) ⇒ **36 cặp FK biến mất**.
 * ĐỐI CHỨNG đo cùng ngày trên lane `mediaos_wfbase547` (mới tinh, head 0547, KHÔNG có `0548`): **459**
 * — đúng con số cũ. ⇒ 459 − 423 = 36 khớp trọn vẹn với phần bị DROP, không có cặp nào "rơi" ngoài dự
 * kiến. Đó là cách kiểm mà bất kỳ lần hạ sàn nào sau này cũng phải làm: đo HAI lane, chênh lệch phải
 * giải thích được từng cặp.
 *
 * ⛔ Sàn này CHỈ được hạ khi BẢNG/CỘT thật sự biến mất khỏi schema. Census tụt vì bộ lọc hỏng, vì
 * composite FK bị gỡ, hay vì lane DB migrate thiếu ⇒ là NỢ, cấm hạ sàn.
 *
 * ⟲ S11-ROOM-DB-1 (ROOM-DEC-001) — HẠ **423 → 415**, có chủ đích. Đo 2026-08-29 trên HAI lane cùng ngày:
 * đối chứng `mediaos_roombase551` (mới tinh, head `0551`, KHÔNG có `0552+`) = **423**; `mediaos_roomdb1` (head
 * `0555`) = **415**. 423 − 415 = **8 = ĐÚNG số FK một-cột rơi theo `DROP TABLE` ở mig `0553`**: `meetings.meeting_room_id`
 * · `meetings.organizer_id` · `meeting_attendees.meeting_id` · `meeting_attendees.user_id` · `meeting_notes.meeting_id`
 * · `meeting_notes.author_user_id` · `meeting_tasks.meeting_id` · `meeting_tasks.task_id` (cả 8 vốn được `0535` phủ
 * composite — MẤT ĐỐI TƯỢNG ĐO, không phải mất hàng rào). 2 bảng mới `room_bookings`/`room_booking_attendees` +
 * 2 cột `*_by` mới trên `meeting_rooms` đều là composite FK THUẦN (0 FK một-cột) nên không cộng vào census này;
 * `meeting_rooms.created_by` (0052) giữ nguyên. Khớp 1–1, không cặp nào rơi ngoài dự kiến.
 *
 * (Lịch sử: 440 đặt 2026-08-25 trên lane `mediaos_fkcatalog` head 0546 khi đo được 459/448 phủ/11 hở;
 * trước đó 460/449 ở head 0534.)
 */
export const FK_SINGLE_COL_PAIRS_FLOOR = 415;

/**
 * LỚP P — "BỊT MỘT NỬA". Số cặp có `child.company_id` NULLABLE, đo 2026-07-31 sau mig `0535`.
 *
 * Với những cặp này composite FK **có tồn tại** (census báo `covered = true`, và đó là sự thật) nhưng
 * Postgres dùng MATCH SIMPLE: hàng nào có NULL trong tập cột FK thì constraint **KHÔNG kiểm**. Nên
 * hàng `company_id IS NULL` của các bảng dưới đây vẫn trỏ tự do sang bản ghi tenant khác.
 *
 * Bảng nguồn thuộc nhóm này (10 bảng): `login_logs` · `system_job_runs` · `notification_events` ·
 * `notification_templates` · `dashboard_widgets` · `seed_batches` · `seed_items` ·
 * `sequence_counters` · `public_holidays` · `data_retention_policies`. Với chúng, hàng
 * `company_id IS NULL` là hàng HỆ THỐNG theo thiết kế; `login_logs` còn có bất biến riêng đang được
 * ghim (`company_id IS NULL ⟹ user_id IS NULL`, `auth-me-bootstrap.int-spec`).
 *
 * Ghi số ra đây để "lớp T hở = 0" KHÔNG bị đọc thành "kín 100%".
 */
export const PARTIAL_ENFORCEMENT_PAIRS = 24;

/**
 * BẢNG RLS KHÔNG CÓ CỘT `company_id` — nằm NGOÀI tầm nhìn của census, nên phải ký nhận từng cái.
 * (security-reviewer FULL gate 2026-07-31, MEDIUM: "bảng con kiểu-này thêm ngày mai sẽ KHÔNG bị
 * ratchet bắt".)
 *
 * • `companies` — chính là bảng gốc định nghĩa tenant; không thể có `company_id` của riêng nó.
 * • `role_permissions` — cô lập bằng policy TƯƠNG QUAN qua `roles.company_id`; đã verify vế `WITH CHECK`
 *   ép `roles.company_id = current_setting(...)` nên không gắn được sang role của tenant khác, cũng
 *   không gắn được vào role toàn cục.
 *
 * Bảng thứ ba xuất hiện ⇒ ratchet ĐỎ. Đó là chủ đích: nó phải được xem xét chứ không được lặng lẽ
 * nằm ngoài mọi lưới FK chéo tenant.
 */
export const RLS_TABLES_WITHOUT_COMPANY_ID: readonly string[] = ["companies", "role_permissions"];
