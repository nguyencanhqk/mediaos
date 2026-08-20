import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import {
  basisOf,
  byMembership,
  fromScope,
  identityColumns,
  selfBound,
  unconditional,
  type IdentityGrant,
} from "./identity-projection";

/**
 * S6-SEC-IDENTITY-PROJ-1 — L1 (tầng type). Không cần DB: mọi thứ ở đây là dựng biểu thức SQL.
 *
 * Bốn nhóm khẳng định, và nhóm đầu là nhóm quan trọng nhất:
 *   1. FAIL-CLOSED: `fromScope(null)` phải ra `false`. Đây là nhánh dễ viết ngược nhất của cả cơ chế
 *      — một `cond ?? sql`true`` trông vô hại và mở toang mọi hàng, im lặng.
 *   2. Mỗi constructor gắn ĐÚNG basis của nó (nhãn sai = sổ phán quyết đọc sai).
 *   3. `identityColumns` khử ở SQL, và cờ đặt tên được (hai nhóm trong một truy vấn thì cờ trùng tên
 *      sẽ ĐÈ nhau — bẫy đã cắn thật ở `security-event.repository`).
 *   4. Ranh giới của brand, phát biểu ĐÚNG: nó chặn object literal, KHÔNG chặn ép kiểu.
 */

/**
 * Chuỗi hoá một biểu thức drizzle để ĐỌC bằng mắt trong assert.
 *
 * `JSON.stringify` KHÔNG dùng được: cột drizzle giữ tham chiếu vòng về bảng ⇒ ném "Converting
 * circular structure". `util.inspect` xử lý vòng và vẫn in ra được `value` của các mẩu chuỗi.
 */
function rendered(x: unknown): string {
  return inspect(x, { depth: 6 });
}

describe("identity-projection — fail-closed", () => {
  it("fromScope(null) ⇒ vị từ FALSE, không phải TRUE", () => {
    const g = fromScope(null, "identity-gated", "actor không có grant danh bạ nào");
    // Không so sánh với `sql`false`` bằng deep-equal (drizzle không hứa cấu trúc); khẳng định bằng
    // thứ đọc được: chuỗi hoá phải chứa "false" và KHÔNG chứa "true".
    const s = rendered(g.cond);
    expect(s).toContain("false");
    expect(s).not.toContain("true");
  });

  it("fromScope(cond) giữ NGUYÊN vị từ được truyền vào", () => {
    const cond = sql`1 = 1`;
    const g = fromScope(cond, "scoped-predicate", "vị từ thật");
    expect(g.cond).toBe(cond);
  });
});

describe("identity-projection — basis của từng constructor", () => {
  it("fromScope nhận basis từ tham số, không tự đoán", () => {
    expect(basisOf(fromScope(sql`true`, "scoped-predicate", "x".repeat(5)))).toBe(
      "scoped-predicate",
    );
    expect(basisOf(fromScope(sql`true`, "identity-gated", "x".repeat(5)))).toBe("identity-gated");
  });

  it("selfBound ⇒ self-bound-row, và vị từ ghim vào đúng actor", () => {
    const g = selfBound("11111111-1111-1111-1111-111111111111", users.id, "route của chính chủ");
    expect(basisOf(g)).toBe("self-bound-row");
    expect(rendered(g.cond)).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("byMembership ⇒ membership, giữ nguyên vị từ của caller", () => {
    const cond = sql`exists (select 1)`;
    expect(basisOf(byMembership(cond, "thành viên phòng"))).toBe("membership");
    expect(byMembership(cond, "thành viên phòng").cond).toBe(cond);
  });

  it("unconditional ⇒ vị từ TRUE cho cả ba căn cứ không đo được bằng máy", () => {
    for (const b of ["no-actor", "waiver", "self-bound-route"] as const) {
      const g = unconditional(b, "lý do");
      expect(basisOf(g)).toBe(b);
      // Ba căn cứ này KHÔNG mang vị từ — đó chính là lý do chúng bị TRẦN ĐẾM ở sổ phán quyết.
      expect(rendered(g.cond)).toContain("true");
    }
  });
});

describe("identity-projection — identityColumns", () => {
  const g = fromScope(sql`1 = 1`, "identity-gated", "vị từ thật");

  it("bọc MỌI cột trong spec bằng case-when, không bỏ sót cột nào", () => {
    const cols = identityColumns(g, { email: users.email, fullName: users.fullName });
    expect(Object.keys(cols).sort()).toEqual(["email", "fullName", "identityInScope"]);
    expect(rendered(cols.email)).toContain("case when");
    expect(rendered(cols.fullName)).toContain("case when");
  });

  it("cờ đặt tên được — hai nhóm trong một truy vấn KHÔNG đè cờ của nhau", () => {
    // Bẫy đã cắn thật: `security-event.repository` chiếu hai nhóm (chủ thể / người gây ra) và spread
    // cả hai vào cùng object `select`. Cờ trùng tên ⇒ nhóm sau đè nhóm trước trong im lặng, tức nhóm
    // chủ thể bị quyết định bởi vị từ của nhóm actor.
    const subject = identityColumns(g, { userEmail: users.email });
    const actor = identityColumns(g, { actorEmail: users.email }, "actorIdentityInScope");
    const merged = { ...subject, ...actor };
    expect(Object.keys(merged).sort()).toEqual([
      "actorEmail",
      "actorIdentityInScope",
      "identityInScope",
      "userEmail",
    ]);
  });

  it("vị từ FALSE vẫn dựng ra đủ cột — khử ở SQL, không phải bỏ cột ở JS", () => {
    // Quan trọng: hàng ngoài scope trả `null` ở tầng SQL. Nếu repo bỏ cột thì service không còn cách
    // nào phân biệt "ngoài scope" với "cột không tồn tại", và một lần quên xoá khoá ở service sẽ rò
    // email im lặng thay vì trả null (chế độ hỏng ỒN ÀO là có chủ đích).
    const cols = identityColumns(fromScope(null, "identity-gated", "không grant"), {
      email: users.email,
    });
    expect(Object.keys(cols).sort()).toEqual(["email", "identityInScope"]);
    expect(rendered(cols.email)).toContain("false");
  });
});

describe("identity-projection — ranh giới của brand", () => {
  it("KHÔNG dựng được bằng object literal (chặn ở tầng type)", () => {
    // @ts-expect-error — thiếu brand `unique symbol`; đây là thứ tầng type THẬT SỰ chặn.
    const forged: IdentityGrant = { basis: "waiver", cond: sql`true`, why: "giả" };
    expect(forged).toBeDefined();
  });

  it("NHƯNG ép kiểu thì lọt — và đó là lý do ratchet phải đếm ép-kiểu = 0", () => {
    // Ca này tồn tại để CHỐNG một docblock nói quá. Brand chặn object literal, không chặn `as`.
    // Đường đó bị bịt ở L2 (`blindSpots().asIdentityGrant` phải bằng 0 trong apps/api/src), KHÔNG ở
    // L1. Ai xoá chiều ratchet đó rồi tin vào tầng type là đang tin một thứ không đúng.
    const forged = { basis: "waiver", cond: sql`true`, why: "giả" } as unknown as IdentityGrant;
    expect(basisOf(forged)).toBe("waiver");
  });
});
