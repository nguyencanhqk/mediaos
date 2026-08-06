import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chatReactionEmojiSchema } from "@mediaos/contracts";
import { CHAT_REACTION_EMOJIS } from "../db/schema/communication";

/**
 * S8-CHAT-UX-BE-3 — bộ emoji ĐÓNG (CHAT-DEC-018) sống ở **BA** chỗ. File này buộc cả ba khớp nhau.
 *
 * ┌─ VÌ SAO BA BẢN SAO, VÀ VÌ SAO KHÔNG HỢP NHẤT ────────────────────────────────────────────────┐
 * │ 1. `chat_message_reactions_emoji_chk` — CHECK cấp DB (mig `0543`). Đai cuối, chặn cả đường ghi │
 * │    không đi qua API (SQL tay, job tương lai).                                                  │
 * │ 2. `CHAT_REACTION_EMOJIS` — hằng drizzle, cho `$type<>()` của cột.                             │
 * │ 3. `chatReactionEmojiSchema` — Zod ở contracts, gác biên HTTP và là kiểu dùng chung với FE.    │
 * │                                                                                                │
 * │ Hợp nhất (2) vào (3) đòi `apps/api/src/db/schema/**` import `@mediaos/contracts`, mà cây schema │
 * │ **chưa từng** làm thế (đo 06/08: 0 kết quả) — đổi quy ước cho một hằng 6 phần tử là cái giá lớn │
 * │ hơn thứ nó mua. (1) thì không hợp nhất được: nó sống trong SQL đã áp lên DB thật.               │
 * │                                                                                                │
 * │ ⇒ Giữ ba bản sao, nhưng KHÔNG để chúng trôi: hai vế TS đối chiếu ở đây, vế DB đối chiếu bằng    │
 * │   chính văn bản migration (ca 3) — thêm emoji thứ 7 mà quên một chỗ là ĐỎ ngay, không phải sáu  │
 * │   tháng sau khi có người bấm.                                                                   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("S8-CHAT-UX-BE-3 — bộ emoji đóng: ba bản sao phải khớp", () => {
  const fromZod = [...chatReactionEmojiSchema.options].sort();
  const fromDrizzle = [...CHAT_REACTION_EMOJIS].sort();

  it("ca 1 — hằng drizzle === enum Zod (cùng phần tử, cùng số lượng)", () => {
    expect(fromDrizzle).toEqual(fromZod);
  });

  it("ca 2 — đúng 6 mã (CHAT-DEC-018); đổi số này là đổi quyết định, phải sửa cả SPEC-15 §5.1b", () => {
    expect(fromZod).toHaveLength(6);
  });

  it("ca 3 — CHECK trong mig 0543 liệt kê ĐÚNG bộ đó", () => {
    // Đọc chính văn bản migration thay vì truy vấn DB: spec này chạy cả khi KHÔNG có Postgres, và
    // migration là thứ sẽ được áp lên PROD — nó mới là nguồn của vế (1), không phải một DB lane nào đó.
    const sqlText = readFileSync(
      join(__dirname, "..", "..", "migrations", "0543_s8chatuxdb1_pin_avatar_reactions.sql"),
      "utf8",
    );
    const match = sqlText.match(/CHECK \(emoji IN \(([^)]+)\)\)/);
    expect(match, "không tìm thấy CHECK bộ emoji trong mig 0543").not.toBeNull();

    const fromSql = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(fromSql).toEqual(fromZod);
  });
});
