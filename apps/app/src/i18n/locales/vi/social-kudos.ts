/**
 * S16-SOCIAL-FE-2C — chuỗi Vinh danh (SOC-SCREEN-009: khối trên thẻ bài · màn `/feed/kudos` · widget
 * rail), gắn vào namespace `social` dưới khoá `kudos` (xem `social.ts`). Tách file như `social-groups.ts`
 * để `social.ts` không phình quá trần (CLAUDE.md §5).
 *
 * Chữ của COMPOSER (nút · ô chọn người nhận · huy hiệu) nằm ở `composer.kudos.*` của `social.ts` cùng
 * các loại bài khác; lý do lỗi ở `actionError.reason.kudos*`.
 *
 * ⚠️ `unknownRecipient` là «Đồng nghiệp», KHÔNG «đã rời công ty»: `fullName` null cả với người KHÔNG có
 * tài khoản mà vẫn đang làm (`isFormerEmployee:false`). Nhãn «Đã nghỉ việc» đi theo `isFormerEmployee`
 * — không đoán từ tên rỗng.
 */
export default {
  label: "Vinh danh",
  official: "Chính thức",
  officialTitle: "Lời vinh danh mang dấu công ty",
  formerEmployee: "Đã nghỉ việc",
  unknownRecipient: "Đồng nghiệp",
  recipientsAria: "Người được vinh danh",
  moreRecipients: "+{{count}}",
  viewPost: "Xem bài",
  page: {
    title: "Vinh danh",
    monthLabel: "Tháng {{month}}/{{year}}",
    prevMonth: "Tháng trước",
    nextMonth: "Tháng sau",
    empty: "Chưa có lời vinh danh nào trong tháng này.",
    pastLastPage: "Trang này không còn lời vinh danh nào.",
    backToFirstPage: "Về trang đầu",
  },
  widget: {
    title: "Vinh danh tháng này",
    empty: "Tháng này chưa có lời vinh danh nào.",
    viewAll: "Xem tất cả",
  },
} as const;
