import { describe, expect, it } from "vitest";
import {
  calendarDaysSince,
  floatNeedingCheckin,
  formatCompanyDateTime,
  needsCheckin,
  sortGoalRows,
} from "./goal-checkin-freshness";

const TZ = "Asia/Ho_Chi_Minh";
const NOW = new Date("2026-11-09T05:00:00Z"); // 12:00 ngày 09/11 giờ công ty

const base = {
  progressMode: "manual" as const,
  status: "Active" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  lastCheckinAt: null as string | null,
};

describe("goal-checkin-freshness", () => {
  it("tính ngày lịch theo giờ công ty, không theo UTC", () => {
    // 20:00Z ngày 08 = 03:00 ngày 09 giờ VN ⇒ cách hôm nay 0 ngày (UTC sẽ ra 1).
    expect(calendarDaysSince("2026-11-08T20:00:00Z", NOW, TZ)).toBe(0);
    expect(calendarDaysSince("2026-11-02T05:00:00Z", NOW, TZ)).toBe(7);
    expect(calendarDaysSince("không-phải-ngày", NOW, TZ)).toBeNull();
  });

  it("biên 7 ngày: đúng 7 chưa cần, 8 cần check-in", () => {
    expect(needsCheckin({ ...base, lastCheckinAt: "2026-11-02T05:00:00Z" }, NOW, TZ)).toBe(false);
    expect(needsCheckin({ ...base, lastCheckinAt: "2026-11-01T05:00:00Z" }, NOW, TZ)).toBe(true);
  });

  it("chưa từng check-in ⇒ tính từ lúc tạo; mới tạo hôm nay chưa quá hạn", () => {
    expect(needsCheckin(base, NOW, TZ)).toBe(true);
    expect(needsCheckin({ ...base, createdAt: "2026-11-09T01:00:00Z" }, NOW, TZ)).toBe(false);
  });

  it("chế độ đo tự động hoặc không Active ⇒ KHÔNG có nhãn", () => {
    for (const progressMode of ["project", "tasks", "children"] as const) {
      expect(needsCheckin({ ...base, progressMode }, NOW, TZ)).toBe(false);
    }
    expect(needsCheckin({ ...base, status: "Draft" }, NOW, TZ)).toBe(false);
    expect(needsCheckin({ ...base, status: "Completed" }, NOW, TZ)).toBe(false);
  });

  it("đẩy «Cần check-in» lên đầu, giữ thứ tự tương đối", () => {
    const fresh = { ...base, id: "f1", lastCheckinAt: "2026-11-08T05:00:00Z" };
    const staleA = { ...base, id: "s1", lastCheckinAt: "2026-10-01T05:00:00Z" };
    const staleB = { ...base, id: "s2", lastCheckinAt: "2026-10-02T05:00:00Z" };
    const out = floatNeedingCheckin([fresh, staleA, { ...fresh, id: "f2" }, staleB], NOW, TZ);
    expect(out.map((g) => g.id)).toEqual(["s1", "s2", "f1", "f2"]);
  });

  it("định dạng tooltip theo giờ công ty", () => {
    expect(formatCompanyDateTime("2026-11-08T20:30:00Z", TZ)).toBe("09/11/2026 03:30");
  });

  it("khoá lastCheckinAt VẮNG (undefined) = không biết ⇒ KHÔNG cần check-in; null ⇒ rơi về createdAt", () => {
    const { lastCheckinAt: _omit, ...absent } = base;
    expect(needsCheckin(absent, NOW, TZ)).toBe(false);
    expect(needsCheckin({ ...base, lastCheckinAt: null }, NOW, TZ)).toBe(true);
  });
});

describe("sortGoalRows — cột «Phụ trách» + «Check-in cuối» sắp tại chỗ (smoke 09/11)", () => {
  const rows = [
    { id: "b", ownerName: "Bùi Văn Bình", lastCheckinAt: "2026-11-01T02:00:00.000Z" },
    { id: "n", ownerName: null, lastCheckinAt: null },
    { id: "a", ownerName: "An Thị Ánh", lastCheckinAt: "2026-11-08T02:00:00.000Z" },
    { id: "u", ownerName: "Đặng Văn Đức", lastCheckinAt: undefined },
  ];
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

  it("không có cột sắp ⇒ giữ nguyên thứ tự server (cùng tham chiếu)", () => {
    expect(sortGoalRows(rows, [])).toBe(rows);
  });
  it("cột khác owner/lastCheckin ⇒ giữ nguyên", () => {
    expect(ids(sortGoalRows(rows, [{ id: "name", desc: false }]))).toEqual(["b", "n", "a", "u"]);
  });
  it("Phụ trách tăng dần theo tiếng Việt, không tên xuống cuối; giảm dần vẫn để không tên ở cuối", () => {
    expect(ids(sortGoalRows(rows, [{ id: "owner", desc: false }]))).toEqual(["a", "b", "u", "n"]);
    expect(ids(sortGoalRows(rows, [{ id: "owner", desc: true }]))).toEqual(["u", "b", "a", "n"]);
  });
  it("Check-in cuối: tăng dần = cũ nhất trước; chưa check-in / không biết luôn ở cuối; không đổi mảng gốc", () => {
    const before = ids(rows);
    expect(ids(sortGoalRows(rows, [{ id: "lastCheckin", desc: false }]))).toEqual([
      "b",
      "a",
      "n",
      "u",
    ]);
    expect(ids(sortGoalRows(rows, [{ id: "lastCheckin", desc: true }]))).toEqual([
      "a",
      "b",
      "n",
      "u",
    ]);
    expect(ids(rows)).toEqual(before);
  });
});
