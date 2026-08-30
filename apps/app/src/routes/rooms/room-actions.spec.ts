/**
 * S11-ROOM-FE-1 — neo việc suy nút của ROOM.
 *
 * Ca ĐỐI CHỨNG quan trọng nhất: `canCancel = true` **cùng với** `status = "Cancelled"` không xảy ra
 * trên dây, nhưng nếu server đổi ý thì FE phải theo SERVER, không theo suy luận riêng. Nói cách khác:
 * mọi ca ở đây kiểm rằng FE **không** dựng lại công thức `organizer === me` hay `endsAt ≤ now`.
 */
import { describe, it, expect } from "vitest";
import {
  bookingDisplayStatus,
  canShowCancelButton,
  canDeactivateRoom,
  exceedsCapacity,
  headcountOf,
  isRoomBookable,
} from "./room-actions";

const booking = (over: Partial<Parameters<typeof bookingDisplayStatus>[0]> = {}) => ({
  status: "Confirmed" as const,
  isCompleted: false,
  canCancel: true,
  ...over,
});

describe("room-actions — trạng thái hiển thị", () => {
  it("Confirmed chưa qua giờ ⇒ Confirmed", () => {
    expect(bookingDisplayStatus(booking())).toBe("Confirmed");
  });

  it("isCompleted của SERVER ⇒ Completed (FE không tự so đồng hồ máy)", () => {
    expect(bookingDisplayStatus(booking({ isCompleted: true }))).toBe("Completed");
  });

  it("Cancelled THẮNG isCompleted — lượt đã huỷ trôi qua giờ vẫn là 'Đã huỷ'", () => {
    expect(bookingDisplayStatus(booking({ status: "Cancelled", isCompleted: true }))).toBe(
      "Cancelled",
    );
  });
});

describe("room-actions — nút Huỷ = canCancel(server) ∩ quyền", () => {
  it("đủ quyền + server cho phép ⇒ hiện", () => {
    expect(canShowCancelButton(booking(), true)).toBe(true);
  });

  it("server nói KHÔNG ⇒ ẩn dù có quyền (nút đó chắc chắn ăn 409/403)", () => {
    expect(canShowCancelButton(booking({ canCancel: false }), true)).toBe(false);
  });

  it("thiếu cặp quyền ⇒ ẩn dù server nói được", () => {
    expect(canShowCancelButton(booking(), false)).toBe(false);
  });

  it("lượt đã huỷ: server đặt canCancel=false ⇒ ẩn (không cần FE kiểm status)", () => {
    expect(canShowCancelButton(booking({ status: "Cancelled", canCancel: false }), true)).toBe(
      false,
    );
  });

  it("ĐỐI CHỨNG: FE KHÔNG suy từ status — server nói được thì hiện, kể cả isCompleted=true", () => {
    // Ca này không xảy ra trên dây hôm nay (server tính isCompleted ⇒ canCancel=false), nhưng nếu quy
    // tắc BE đổi (ví dụ cho huỷ lượt vừa kết thúc trong 5′), FE phải đi theo mà không cần sửa.
    expect(canShowCancelButton(booking({ isCompleted: true, canCancel: true }), true)).toBe(true);
  });
});

describe("room-actions — phòng nhận đặt", () => {
  it("active và không cần duyệt ⇒ đặt được", () => {
    expect(isRoomBookable({ isActive: true, requiresApproval: false })).toBe(true);
  });

  it("vô hiệu ⇒ không (ROOM-ERR-004 room-inactive)", () => {
    expect(isRoomBookable({ isActive: false, requiresApproval: false })).toBe(false);
  });

  it("requiresApproval ⇒ không, dù đang active (ROOM-DEC-002 — v1 chưa có luồng duyệt)", () => {
    expect(isRoomBookable({ isActive: true, requiresApproval: true })).toBe(false);
  });
});

describe("room-actions — vô hiệu/xoá phòng", () => {
  it("upcomingCount = 0 ⇒ cho phép", () => {
    expect(canDeactivateRoom({ upcomingCount: 0 })).toBe(true);
  });

  it("còn lịch ⇒ ẩn (ROOM-ERR-008)", () => {
    expect(canDeactivateRoom({ upcomingCount: 3 })).toBe(false);
  });

  it("VẮNG KHOÁ (màn danh sách không có upcomingCount) ⇒ VẪN hiện, để server chốt", () => {
    // Đoán ngược lại (ẩn khi không biết) sẽ khoá cứng thao tác hợp lệ ở màn danh sách, nơi khoá này
    // LUÔN vắng — contracts khai `.optional()`, chỉ chi tiết mới có.
    expect(canDeactivateRoom({})).toBe(true);
  });
});

describe("room-actions — sức chứa", () => {
  it("organizer tính vào đầu người (SPEC-14 §12)", () => {
    expect(headcountOf(0)).toBe(1);
    expect(headcountOf(5)).toBe(6);
  });

  it("vượt sức chứa khi 1 + attendees > capacity", () => {
    expect(exceedsCapacity(6, 5)).toBe(false); // 6 người, phòng 6
    expect(exceedsCapacity(6, 6)).toBe(true); // 7 người
  });

  it("chưa chọn phòng ⇒ không cảnh báo (chưa đủ dữ kiện, không đoán bừa)", () => {
    expect(exceedsCapacity(null, 99)).toBe(false);
  });
});
