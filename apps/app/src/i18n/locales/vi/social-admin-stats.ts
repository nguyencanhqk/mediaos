/**
 * S16-SOCIAL-FE-3B (L5) — chuỗi của màn Thống kê tương tác `SOC-SCREEN-011`, gắn vào `social:admin.stats`
 * (xem `social-admin.ts`). Tách file theo plan D18 để `social-admin.ts` không vượt trần 400 dòng.
 *
 * Câu LỖI của màn này (`statsUnitOutOfScope` · `statsRangeInvalid`) KHÔNG ở đây: mọi câu lỗi của cụm quản trị
 * nằm ở `social-admin.ts` → `error.*`, nơi spec của `AdminErrorNotice` lặp toàn bộ tập reason.
 */
export default {
  /**
   * Thanh bộ lọc — `StatsFilters`.
   *
   * `back` / `forward` là TÊN TRỢ NĂNG của hai nút ‹ ›: mang số tuần sẽ dịch, vì nút chỉ vẽ một mũi tên.
   * `reset` đưa về mặc định của server (8 tuần tới hết tuần hiện tại).
   */
  filters: {
    aria: "Bộ lọc thống kê",
    rangeLabel: "Khoảng thời gian",
    range: "{{from}} – {{to}}",
    weeksLabel: "Số tuần",
    weeksOption: "{{weeks}} tuần",
    back: "Lùi {{weeks}} tuần",
    forward: "Tiến {{weeks}} tuần",
    reset: "Về hiện tại",
    unitLabel: "Đơn vị",
    allUnits: "Tất cả đơn vị",
  },
  /**
   * Tên đơn vị trên bảng và ô chọn.
   *
   * ⚠️ `unassigned` (người chưa gán đơn vị) và `unknown` (số liệu mang một đơn vị không có trong danh sách
   * server trả) là hai sự thật KHÁC nhau — không gộp thành một nhãn.
   */
  unit: {
    deleted: "{{name}} (đã xoá)",
    unassigned: "Chưa gán đơn vị",
    unknown: "Đơn vị không xác định",
  },
  /** Tên bốn số đếm của 052 + «tổng tương tác» (bài + bình luận + cảm xúc) của biểu đồ. */
  metric: {
    posts: "Bài viết",
    comments: "Bình luận",
    reactions: "Cảm xúc",
    activeMembers: "Thành viên hoạt động",
    interactions: "Tổng tương tác",
  },
  /** Nhãn một tuần: thứ Hai – Chủ nhật. Dùng ở bảng «Theo tuần» và bảng thay thế của biểu đồ. */
  week: {
    column: "Tuần",
    range: "{{from}} – {{to}}",
  },
  /** Bảng «Theo tuần» (`weekTotals`) — `WeekTotalsTable`. */
  weekTable: {
    caption: "Tương tác theo tuần",
  },
  /** Bảng «Theo đơn vị» (`rows` gộp qua các tuần) — `UnitTotalsTable`. KHÔNG có cột thành viên. */
  unitTable: {
    caption: "Tương tác theo đơn vị",
    unit: "Đơn vị",
  },
  /** Biểu đồ xu hướng — `EngagementTrendChart`. */
  chart: {
    title: "Xu hướng tương tác theo tuần",
    description: "Tổng số bài viết, bình luận và cảm xúc của mỗi tuần.",
    empty: "Chưa có dữ liệu tuần nào để vẽ biểu đồ.",
  },
  /** Nút xuất XLSX (053) — `ExportEngagementButton`. */
  export: {
    button: "Xuất Excel",
    exporting: "Đang xuất…",
  },
};
