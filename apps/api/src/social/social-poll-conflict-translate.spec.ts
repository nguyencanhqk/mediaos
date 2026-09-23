/**
 * S16-SOCIAL-BE-2B-1 · nợ test **N4** (FULL gate 23/09/2026, plan §13.5).
 *
 * ┌─ VÌ SAO PHẢI LÀ UNIT-SPEC, KHÔNG PHẢI CA HTTP ────────────────────────────────────────────────┐
 * │ Điểm hội tụ **H-1** của lượt gate (4 nguồn độc lập): hai nhánh dịch `POLL_VOTE_PK` /          │
 * │ `POLL_VOTE_SINGLE_UQ` trong `vote()` **KHÔNG tới được qua HTTP**. `lockPollRowTx`            │
 * │ (`FOR UPDATE`) tuần tự hoá hai lượt đua, rồi DELETE chạy TRƯỚC INSERT nên lượt sau xoá phiếu  │
 * │ lượt trước rồi mới ghi ⇒ **không bao giờ đâm 23505**. Hệ quả: ca `P-5a` đúng một cách RỖNG,   │
 * │ và cả hai nhánh `catch` là mã phòng thủ **chưa từng được đo**.                                 │
 * │                                                                                                │
 * │ Mã phòng thủ chưa đo là mã có thể SAI mà không ai biết — cụ thể: gõ sai TÊN constraint. Sai   │
 * │ tên thì `isUniqueViolationOf` trả `false`, lỗi rơi xuống nhánh chung và người dùng nhận        │
 * │ **500 chưa dịch** đúng vào ngày một thay đổi schema làm nhánh đó sống lại.                     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Spec này đo **hàm dịch**. Vế «tên constraint có TỒN TẠI trong DB không» phải đo trên Postgres
 * thật — nằm ở `social-be2b1-polls-isolation.int-spec.ts` (ca `N4-db`). Hai vế tách nhau vì chúng
 * hỏng vì hai lý do khác nhau: vế này hỏng khi đổi hằng, vế kia hỏng khi đổi migration.
 */

import { describe, expect, it } from "vitest";
import { SOCIAL_CONSTRAINT, isUniqueViolationOf } from "./social.errors";

/** Lỗi drizzle THẬT bọc lỗi pg trong `cause` — xem `socialPgErrorOf`. */
function drizzleWrapped(code: string, constraint: string): Error {
  const pg = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code,
    constraint,
  });
  return Object.assign(new Error("Failed query"), { cause: pg });
}

describe("N4 — dịch 23505 của BÌNH CHỌN sang mã nghiệp vụ (nhánh HTTP không tới được)", () => {
  const branches = [
    ["POLL_VOTE_PK (cùng option, cùng người)", SOCIAL_CONSTRAINT.POLL_VOTE_PK],
    ["POLL_VOTE_SINGLE_UQ (khác option, poll một-lựa-chọn)", SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ],
  ] as const;

  it.each(branches)("nhận ra %s khi lỗi pg nằm trong `cause` của drizzle", (_label, name) => {
    expect(isUniqueViolationOf(drizzleWrapped("23505", name), name)).toBe(true);
  });

  it.each(branches)("nhận ra %s cả khi lỗi pg là lỗi TRẦN (không qua drizzle)", (_label, name) => {
    const bare = Object.assign(new Error("dup"), { code: "23505", constraint: name });
    expect(isUniqueViolationOf(bare, name)).toBe(true);
  });

  // ── Vế PHỦ ĐỊNH: ba cách một lỗi KHÁC có thể bị dịch nhầm thành "đã bỏ phiếu" ──

  it("KHÔNG nuốt 23505 của constraint KHÁC — hai nhánh không được nhận nhầm của nhau", () => {
    const pkErr = drizzleWrapped("23505", SOCIAL_CONSTRAINT.POLL_VOTE_PK);
    expect(isUniqueViolationOf(pkErr, SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ)).toBe(false);

    const uqErr = drizzleWrapped("23505", SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ);
    expect(isUniqueViolationOf(uqErr, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
  });

  it("KHÔNG nuốt 23505 của bảng khác trong CÙNG module (ống nước FK composite cũng ném 23505)", () => {
    const other = drizzleWrapped("23505", "feed_poll_options_position_uq");
    expect(isUniqueViolationOf(other, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
    expect(isUniqueViolationOf(other, SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ)).toBe(false);
  });

  it("KHÔNG nuốt lỗi ĐÚNG TÊN nhưng SAI MÃ (23503 FK · 23514 CHECK) — dịch theo cặp (mã, tên)", () => {
    for (const code of ["23503", "23514", "23502"]) {
      expect(
        isUniqueViolationOf(
          drizzleWrapped(code, SOCIAL_CONSTRAINT.POLL_VOTE_PK),
          SOCIAL_CONSTRAINT.POLL_VOTE_PK,
        ),
        `mã ${code} không phải vi phạm UNIQUE`,
      ).toBe(false);
    }
  });

  it("lỗi KHÔNG phải lỗi pg (không có `code`) ⇒ false, không ném", () => {
    expect(isUniqueViolationOf(new Error("boom"), SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
    expect(isUniqueViolationOf(null, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
    expect(isUniqueViolationOf(undefined, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
    expect(isUniqueViolationOf({ code: 23505 }, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);
  });

  it("chuỗi `cause` SÂU hơn 5 tầng ⇒ false (trần quét là CÓ CHỦ Ý, không phải bỏ sót)", () => {
    const pg = Object.assign(new Error("dup"), {
      code: "23505",
      constraint: SOCIAL_CONSTRAINT.POLL_VOTE_PK,
    });
    let deep: unknown = pg;
    for (let i = 0; i < 6; i += 1) deep = Object.assign(new Error(`wrap${i}`), { cause: deep });

    expect(isUniqueViolationOf(deep, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(false);

    // Neo dương: ĐÚNG ở trần thì vẫn nhận ra — chứng minh ca trên đỏ vì ĐỘ SÂU, không vì cú pháp.
    let atLimit: unknown = pg;
    for (let i = 0; i < 4; i += 1) atLimit = Object.assign(new Error(`w${i}`), { cause: atLimit });
    expect(isUniqueViolationOf(atLimit, SOCIAL_CONSTRAINT.POLL_VOTE_PK)).toBe(true);
  });

  it("hai hằng KHÔNG được trùng nhau (chép-dán một dòng là mất một nhánh dịch)", () => {
    expect(SOCIAL_CONSTRAINT.POLL_VOTE_PK).not.toBe(SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ);
  });
});
