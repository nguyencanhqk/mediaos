import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import { getPreferencesForUsers } from "./social-preferences";

/**
 * S16-SOCIAL-BE-1 (D20) — đường đọc `user_preferences` CROSS-USER.
 *
 * ⚠️ Hàm này chưa có caller ở BE-1 (route sinh nhật `026` thuộc BE-1B) — và đó chính là lý do nó
 * CẦN test: một hàm hạ tầng chưa ai gọi là một hàm chưa ai đo, và cái nó gác (vế `company_id` trên
 * đường mà vế `user_id = chính mình` ĐÃ được gỡ) là thứ hỏng im lặng.
 */

function fakeTx(rows: Array<{ userId: string; locale: string | null; timezone: string | null }>) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { tx: { select } as unknown as TenantTx, select, from, where };
}

const COMPANY = "22222222-2222-4222-8222-222222222222";

describe("getPreferencesForUsers", () => {
  it("danh sách RỖNG ⇒ trả Map rỗng và KHÔNG chạm DB", async () => {
    const { tx, select } = fakeTx([]);
    const out = await getPreferencesForUsers(tx, COMPANY, []);
    expect(out.size).toBe(0);
    expect(select, "không được mở truy vấn cho một lô rỗng").not.toHaveBeenCalled();
  });

  it("ĐÚNG MỘT truy vấn cho cả lô — không một truy vấn mỗi người", async () => {
    const { tx, select } = fakeTx([
      { userId: "u1", locale: "vi-VN", timezone: null },
      { userId: "u2", locale: null, timezone: "Asia/Ho_Chi_Minh" },
    ]);
    await getPreferencesForUsers(tx, COMPANY, ["u1", "u2", "u3"]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("TẬP CỘT TƯỜNG MINH — chỉ 4 cột đã ký, KHÔNG `select()` trần", async () => {
    // Bảng này có `theme`/`meLayoutConfig`/… — không lý do gì một truy vấn của SOCIAL kéo về bố cục
    // màn hình ME của NGƯỜI KHÁC (DB-17 §11 R6).
    //
    // ⟲ **S16-SOCIAL-BE-1B (22/09/2026) thêm `showBirthday`** — nới CÓ CHỦ ĐÍCH, KHÔNG phải nới để
    // lấy màu xanh: cột `user_preferences.show_birthday` (migration `0584`) là chỗ chứa cờ mà
    // SOC-DEC-007 hứa và BE-1 đo thấy CHƯA TỒN TẠI. Route `026` đọc nó qua ĐÚNG hàm này — hàm DUY
    // NHẤT của module đọc preference của NGƯỜI KHÁC — nên thêm một đường đọc thứ hai ở repository
    // sinh nhật mới là thứ phải chặn, không phải dòng này.
    const { tx, select } = fakeTx([]);
    await getPreferencesForUsers(tx, COMPANY, ["u1"]);
    const projection = select.mock.calls[0][0];
    expect(Object.keys(projection).sort()).toEqual([
      "locale",
      "showBirthday",
      "timezone",
      "userId",
    ]);
  });

  it("người CHƯA có hàng preference VẮNG MẶT trong Map (không tự điền hàng giả)", async () => {
    // "Không có cấu hình" và "cấu hình mặc định" là hai việc khác nhau; gộp ở đây sẽ giấu việc thứ
    // nhất khỏi mọi caller.
    const { tx } = fakeTx([{ userId: "u1", locale: "vi-VN", timezone: null }]);
    const out = await getPreferencesForUsers(tx, COMPANY, ["u1", "u2"]);
    expect(out.has("u1")).toBe(true);
    expect(out.has("u2")).toBe(false);
  });

  it("trả đúng giá trị theo `userId`", async () => {
    const { tx } = fakeTx([
      { userId: "u1", locale: "vi-VN", timezone: "Asia/Ho_Chi_Minh" },
      { userId: "u2", locale: null, timezone: null },
    ]);
    const out = await getPreferencesForUsers(tx, COMPANY, ["u1", "u2"]);
    expect(out.get("u1")).toEqual({
      userId: "u1",
      locale: "vi-VN",
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(out.get("u2")?.locale).toBeNull();
  });

  it("vẫn ÉP `company_id` dù RLS đã cô lập tenant (đây là hàng rào còn lại duy nhất)", async () => {
    const { tx, where } = fakeTx([]);
    await getPreferencesForUsers(tx, COMPANY, ["u1"]);
    // `where` nhận một biểu thức drizzle; ta không bóc AST của nó, chỉ chắc rằng vế điều kiện có
    // được truyền — vế hành vi (tenant khác ⇒ 0 hàng) do RLS + int-spec của BE-1B phủ.
    expect(where).toHaveBeenCalledTimes(1);
    expect(where.mock.calls[0][0]).toBeDefined();
  });
});
