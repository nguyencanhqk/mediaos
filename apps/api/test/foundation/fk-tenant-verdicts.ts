/**
 * S6-SEC-XTENANTFK-1 (KI-046) — SỔ PHÁN QUYẾT cho khoá ngoại một-cột nối hai bảng tenant.
 *
 * LUẬT: sau mig `0535`, **mọi** cặp FK một-cột giữa hai bảng tenant phải hoặc (a) đã có composite FK
 * `(company_id, col)` phủ lên, hoặc (b) có MỘT DÒNG Ở ĐÂY với lý do. Không có ô thứ ba. Cặp mới xuất
 * hiện mà không thuộc hai nhóm đó ⇒ `xtenant-fk-ratchet.int-spec.ts` ĐỎ.
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
  /** Vì sao KHÔNG vá được cặp này. Câu này là thứ người sau đọc, viết cho người đọc. */
  reason: string;
  /** Ai/việc nào ký. */
  signedBy: string;
}

/**
 * LỚP G — bảng ĐÍCH là catalog TOÀN CỤC (`company_id` NULLABLE, hàng `company_id IS NULL` dùng chung
 * cho mọi tenant). Composite FK `(company_id, col) → parent(company_id, id)` ở đây sẽ **PHÁ tham
 * chiếu hợp lệ**: hàng con mang `company_id = A` trỏ tới hàng cha `company_id = NULL` sẽ bị từ chối
 * ⇒ không gán được role hệ thống, không cấu hình được widget/notification template dùng chung.
 *
 * Tác hại còn lại của việc để hở: đúng lớp lỗ KI-046 nhưng **chỉ trong phạm vi hàng catalog THUỘC
 * TENANT KHÁC** (vd `roles` của tenant B). Đường phòng thủ hiện tại là RLS ở tầng đọc + kiểm tra ở
 * service. Vá đúng cần một cơ chế khác (CHECK/trigger "cha phải cùng tenant HOẶC là hàng toàn cục")
 * — việc riêng, không thuộc WO này.
 */
export const FK_TENANT_WAIVERS: readonly FkWaiver[] = [
  {
    pair: "user_roles.role_id -> roles",
    reason:
      "`roles` là catalog toàn cục: 13/17 hàng có company_id IS NULL (role hệ thống). Composite FK sẽ chặn gán role hệ thống cho user — phá luồng phân quyền chính.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "positions.default_role_id -> roles",
    reason: "Cùng lý do `roles` toàn cục: position mặc định trỏ được tới role hệ thống.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "dashboard_widget_cache.role_id -> roles",
    reason: "Cùng lý do `roles` toàn cục: cache widget khoá theo role hệ thống.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "dashboard_widget_configs.role_id -> roles",
    reason: "Cùng lý do `roles` toàn cục: cấu hình widget theo role hệ thống.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "dashboard_widget_cache.widget_id -> dashboard_widgets",
    reason:
      "`dashboard_widgets` là catalog toàn cục thuần: 17/17 hàng company_id IS NULL. Composite FK sẽ chặn MỌI cache widget.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "dashboard_widget_configs.widget_id -> dashboard_widgets",
    reason:
      "Cùng lý do `dashboard_widgets` toàn cục: cấu hình widget của tenant trỏ tới widget dùng chung.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "notification_templates.event_id -> notification_events",
    reason:
      "`notification_events` là catalog toàn cục thuần: 59/59 hàng company_id IS NULL (NOTI-EVENT-XXX seed hệ thống).",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "notifications.event_id -> notification_events",
    reason: "Cùng lý do `notification_events` toàn cục.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "notifications.template_id -> notification_templates",
    reason:
      "`notification_templates` là catalog toàn cục: 45/45 hàng company_id IS NULL (template mặc định dùng chung).",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "leave_request_days.public_holiday_id -> public_holidays",
    reason:
      "`public_holidays` cho phép company_id IS NULL = lịch nghỉ lễ quốc gia dùng chung (thiết kế DB-05).",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
  {
    pair: "seed_items.seed_batch_id -> seed_batches",
    reason:
      "`seed_batches` cho phép company_id IS NULL = mẻ seed hệ thống chạy trước khi có công ty nào.",
    signedBy: "S6-SEC-XTENANTFK-1",
  },
];

/**
 * MỐC SÀN đo được sau mig `0535` trên lane sạch + PROD (2026-07-31):
 * 460 FK một-cột giữa hai bảng tenant · 449 đã có composite phủ · **11 còn hở = đúng danh sách trên**.
 * Pin để lưới không âm thầm co về rỗng (bộ lọc sai ⇒ 0 cặp ⇒ mọi assert xanh vô nghĩa).
 */
export const FK_SINGLE_COL_PAIRS_FLOOR = 440;

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
