import type { DataScope } from "./auth";

/**
 * SÀN data-scope của widget DASH mà cặp gate MỘT MÌNH quá rộng — nguồn DUY NHẤT cho cả api lẫn web.
 *
 * Widget DASH gác bằng cặp quyền của module nguồn (`DASH_WIDGET_GATE_PAIR` phía api). Với một số cặp, nhiều
 * vai cùng giữ cặp nhưng ở scope khác nhau, nên «có cặp» chưa đủ: người xem còn phải giữ cặp đó ở scope
 * ≥ sàn ghi ở đây. Widget VẮNG MẶT trong map ⇒ không có sàn (chỉ gate bằng cặp).
 *
 * Phía api ép sàn ở HAI tầng đọc CÙNG đối tượng này: danh sách widget (metadata) và đường số liệu
 * `GET /dashboard/widgets/:slug` (403 «… ở phạm vi đủ rộng»). Phía web dùng nó làm TÍN HIỆU để quyết định
 * có mount ô widget hay không, so với `scopes` của `/auth/me` — KHÔNG chép literal scope sang web (trôi).
 *
 * `as const satisfies` giữ khoá + giá trị literal (mất khoá là lỗi compile ở consumer), `Object.freeze` chặn
 * consumer sửa hằng lúc chạy (đổi giá trị ở một nơi = đổi cổng của mọi nơi khác).
 *
 * Thứ tự scope (hẹp → rộng) = `DATA_SCOPES` của `./auth`.
 */
export const DASH_WIDGET_MIN_DATA_SCOPE = Object.freeze({
  // S11-OFFICE-DASH-1: CẢ 4 vai chuẩn đều giữ `view:asset`, nhân viên thường ở scope `Own`; SPEC-13 chốt
  // nhân viên thường KHÔNG thấy widget, Asset Manager (@Company) phải thấy — điều kiện phân biệt là scope.
  ASSET_SUMMARY: "Department",
  // S12-RECRUIT-DASH-1: nguồn đếm phễu ứng viên TOÀN công ty (không co theo scope người xem) ⇒ sàn phải
  // bằng đúng bề rộng phép đếm. Hôm nay mọi grant cặp này đều @Company — sàn gác grant hẹp hơn về sau.
  RECRUIT_FUNNEL: "Company",
  // S13-PAYROLL-DASH-1: nguồn cộng tổng quỹ lương TOÀN công ty (payload là TIỀN) — cùng lý do RECRUIT_FUNNEL,
  // hệ quả nặng hơn. Độc lập với sàn công ty mà service PAYROLL ép ở route nguồn (metadata không đi qua đó).
  PAYROLL_COST: "Company",
  // S15-PAYROLL-DASH-1: hai widget v2 cộng/đếm ở nguồn rộng bằng CẢ công ty — ngân sách lương năm (chở
  // tiền) và số tạm ứng chờ duyệt (không chở tiền, vẫn là thông tin toàn công ty).
  PAYROLL_BUDGET: "Company",
  PAYROLL_ADVANCE_PENDING: "Company",
  // S16-SOCIAL-DASH-1: hai sàn KHÁC giá trị và KHÁC lý do — đừng gộp.
  //   • SOCIAL_ENGAGEMENT_WEEK = 'Department' (SPEC-16 §17.3: tập hợp lệ {Department, Company, System}).
  //     Nguồn trả SỐ 0 (không 403) cho grant @Own/@Team ⇒ thiếu sàn thì ô «0 tương tác» trông như số thật.
  //   • SOCIAL_NEWS_UNACKED = 'Company' — khớp sàn công ty của route nguồn tin tức.
  SOCIAL_ENGAGEMENT_WEEK: "Department",
  SOCIAL_NEWS_UNACKED: "Company",
  // S4-DASH-HROVERVIEW-FLOOR-1: CẢ 4 vai chuẩn đều giữ `read:employee` (employee @Own · manager @Team ·
  // hr / company-admin @Company) ⇒ cặp một mình không phân biệt HR với nhân viên. SPEC-07 §14.8 + quyết định
  // owner 16/10/2026: HR / Admin (@Company) thấy cả công ty, người giữ @Department thấy phòng mình
  // (đơn vị của mình ∪ đơn vị mình làm trưởng); quản lý @Team và nhân viên @Own KHÔNG nhận số liệu.
  HR_OVERVIEW: "Department",
} as const satisfies Record<string, DataScope>);

/** Mã widget có khai sàn scope. */
export type DashWidgetFloorCode = keyof typeof DASH_WIDGET_MIN_DATA_SCOPE;
