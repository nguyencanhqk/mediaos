/**
 * S5-BE-CONTRACT-1 (WS-D) — HỢP ĐỒNG "query invalidation bắt buộc sau mutation" (IMPLEMENTATION-08 §13.3).
 *
 * Bảng §13.3 được mã hoá THẲNG vào test: mỗi dòng = một mutation + tập cache BẮT BUỘC làm mới. Bỏ một
 * vế ra khỏi helper ⇒ ĐỎ ở đây, thay vì lặng lẽ trở thành bug "màn khác vẫn hiện số cũ" mà QA phải bắt bằng mắt.
 *
 * PHẠM VI CÓ CHỦ Ý — chỉ cache của CHÍNH người vừa thao tác. Một số vế trong bảng §13.3 thuộc cache của
 * NGƯỜI KHÁC và client KHÔNG thể (và không nên) làm mới hộ:
 *   - "balances" khi DUYỆT đơn → số dư thuộc người GỬI đơn, không nằm trong cache người duyệt.
 *   - "notification" khi duyệt/tạo → thông báo bắn cho người NHẬN; người thao tác không tự nhận.
 *   - "attendance records" khi duyệt nghỉ → bản ghi công thuộc người GỬI đơn (BE tự đồng bộ).
 * Những vế đó được ghi nhận là NGOÀI phạm vi client và giải thích tại chỗ, KHÔNG âm thầm bỏ qua.
 */
import { describe, expect, it } from "vitest";
import {
  attendanceInvalidation,
  attendanceKeys,
  dashboardKeys,
  leaveInvalidation,
  leaveKeys,
  notificationInvalidation,
  notificationKeys,
  taskCoreInvalidation,
  taskKeys,
} from "./query-keys";

type QueryKey = readonly unknown[];

/** `actual` có chứa một key khớp TIỀN TỐ `expected` không (TanStack match theo prefix). */
function coversPrefix(actual: readonly QueryKey[], expected: QueryKey): boolean {
  return actual.some((key) => expected.every((segment, i) => Object.is(key[i], segment)));
}

/** Khẳng định tập invalidate phủ MỌI nhóm cache bắt buộc của một dòng §13.3. */
function expectCovers(
  mutation: string,
  actual: readonly QueryKey[],
  required: { label: string; key: QueryKey }[],
): void {
  const missing = required.filter((r) => !coversPrefix(actual, r.key)).map((r) => r.label);
  expect(missing, `${mutation}: thiếu invalidate cho ${missing.join(", ")}`).toEqual([]);
  expect(actual.length, `${mutation}: tập invalidate rỗng (test sẽ vô nghĩa)`).toBeGreaterThan(0);
}

describe("§13.3 — Check-in / check-out", () => {
  it.each([
    ["check-in", attendanceInvalidation.checkIn()],
    ["check-out", attendanceInvalidation.checkOut()],
  ])("%s làm mới: attendance today + records + widget dashboard", (name, actual) => {
    expectCovers(name, actual as readonly QueryKey[], [
      { label: "attendance today", key: attendanceKeys.myToday() },
      { label: "attendance records (của tôi)", key: [...attendanceKeys.all, "my", "records"] },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });
});

describe("§13.3 — Đơn điều chỉnh công", () => {
  it("gửi đơn điều chỉnh làm mới: danh sách đơn + widget chờ duyệt", () => {
    expectCovers(
      "createAdjustment",
      attendanceInvalidation.createAdjustment() as readonly QueryKey[],
      [
        { label: "danh sách đơn điều chỉnh", key: attendanceKeys.adjustments.all },
        { label: "widget dashboard", key: dashboardKeys.widgets.all },
      ],
    );
  });

  it("duyệt đơn điều chỉnh làm mới: bảng công + danh sách/chi tiết đơn + widget", () => {
    expectCovers(
      "approveAdjustment",
      attendanceInvalidation.approveAdjustment("adj-1") as readonly QueryKey[],
      [
        { label: "danh sách đơn", key: attendanceKeys.adjustments.all },
        { label: "chi tiết đơn", key: attendanceKeys.adjustments.detail("adj-1") },
        { label: "bảng công", key: attendanceKeys.records.all },
        { label: "widget dashboard", key: dashboardKeys.widgets.all },
      ],
    );
  });
});

describe("§13.3 — Nghỉ phép", () => {
  it("tạo đơn nghỉ làm mới: đơn của tôi + số dư + lịch nghỉ + widget", () => {
    expectCovers("createRequest", leaveInvalidation.createRequest() as readonly QueryKey[], [
      { label: "đơn nghỉ của tôi", key: leaveKeys.requests.my() },
      { label: "số dư phép của tôi", key: leaveKeys.balances.my() },
      { label: "lịch nghỉ", key: leaveKeys.calendar.all },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });

  it("duyệt đơn làm mới: danh sách duyệt + chi tiết + lịch nghỉ + widget", () => {
    expectCovers("approve", leaveInvalidation.approve("req-1") as readonly QueryKey[], [
      { label: "danh sách đơn (quản lý)", key: [...leaveKeys.all, "requests", "list"] },
      { label: "chi tiết đơn", key: leaveKeys.requests.detail("req-1") },
      { label: "lịch nghỉ", key: leaveKeys.calendar.all },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });

  it("từ chối đơn làm mới: danh sách duyệt + chi tiết + widget", () => {
    expectCovers("reject", leaveInvalidation.reject("req-1") as readonly QueryKey[], [
      { label: "danh sách đơn (quản lý)", key: [...leaveKeys.all, "requests", "list"] },
      { label: "chi tiết đơn", key: leaveKeys.requests.detail("req-1") },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });

  it("NGOÀI phạm vi client: duyệt/từ chối KHÔNG đụng số dư phép của người GỬI đơn", () => {
    // Ghi nhận tường minh một quyết định thiết kế (không phải thiếu sót): người duyệt không giữ cache
    // số dư của người gửi. Đổi ý sau này thì test này phải được sửa CÓ Ý THỨC.
    const keys = leaveInvalidation.approve("req-1") as readonly QueryKey[];
    expect(coversPrefix(keys, leaveKeys.balances.my())).toBe(false);
  });
});

describe("§13.3 — Công việc", () => {
  it("tạo/cập nhật task làm mới: danh sách + widget dashboard", () => {
    expectCovers("taskCore.list", taskCoreInvalidation.list() as readonly QueryKey[], [
      { label: "danh sách task", key: [...taskKeys.all, "list"] },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });

  it("task của tôi làm mới kèm widget dashboard", () => {
    expectCovers("taskCore.my", taskCoreInvalidation.my() as readonly QueryKey[], [
      { label: "task của tôi", key: taskKeys.my() },
      { label: "widget dashboard", key: dashboardKeys.widgets.all },
    ]);
  });
});

describe("§13.3 — Thông báo", () => {
  it("đánh dấu đã đọc làm mới: đếm chưa đọc + dropdown + danh sách + chi tiết", () => {
    expectCovers("markRead", notificationInvalidation.markRead("n-1") as readonly QueryKey[], [
      { label: "đếm chưa đọc", key: notificationKeys.unreadCount() },
      { label: "dropdown", key: [...notificationKeys.all, "dropdown"] },
      { label: "danh sách", key: [...notificationKeys.all, "list"] },
      { label: "chi tiết", key: notificationKeys.detail("n-1") },
    ]);
  });

  it("đánh dấu đọc TẤT CẢ làm mới: đếm chưa đọc + dropdown + danh sách", () => {
    expectCovers("markAllRead", notificationInvalidation.markAllRead() as readonly QueryKey[], [
      { label: "đếm chưa đọc", key: notificationKeys.unreadCount() },
      { label: "dropdown", key: [...notificationKeys.all, "dropdown"] },
      { label: "danh sách", key: [...notificationKeys.all, "list"] },
    ]);
  });
});

describe("coversPrefix — chính helper của test (chống xanh giả)", () => {
  it("khớp theo TIỀN TỐ, không đòi bằng nhau tuyệt đối", () => {
    expect(coversPrefix([["a", "b", "c"]], ["a", "b"])).toBe(true);
  });

  it("KHÔNG khớp khi tiền tố lệch", () => {
    expect(coversPrefix([["a", "x"]], ["a", "b"])).toBe(false);
  });

  it("KHÔNG khớp khi key ngắn hơn tiền tố yêu cầu", () => {
    expect(coversPrefix([["a"]], ["a", "b"])).toBe(false);
  });
});
