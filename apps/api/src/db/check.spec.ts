import { describe, expect, it } from "vitest";
import {
  JournalIntegrityError,
  type JournalEntry,
  assertJournalInvariants,
  parseJournal,
  summarizeJournal,
} from "./check";

/**
 * Unit-test thuần cho logic kiểm journal — KHÔNG cần Postgres.
 * Chứng minh gate KHÔNG xanh-giả: fixture HỢP LỆ → pass + head idx ĐỌC ĐỘNG;
 * fixture gap / trùng tag / không-bắt-đầu-0 / rỗng / non-array → JournalIntegrityError.
 */

/** Sinh journal hợp lệ idx 0..n-1, tag duy nhất, breakpoints true. */
function validEntries(n: number): JournalEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    idx: i,
    version: "7",
    when: 1_717_500_000_000 + i * 1000,
    tag: `${String(i).padStart(4, "0")}_mig_${i}`,
    breakpoints: true,
  }));
}

function journalJson(entries: JournalEntry[]): string {
  return JSON.stringify({ version: "7", dialect: "postgresql", entries });
}

describe("parseJournal — đọc journal động", () => {
  it("trích entries từ JSON journal hợp lệ", () => {
    const entries = validEntries(122);
    const parsed = parseJournal(journalJson(entries));
    expect(parsed).toHaveLength(122);
    expect(parsed[121].idx).toBe(121);
  });

  it("ném khi JSON sai cú pháp", () => {
    expect(() => parseJournal("{ not json")).toThrow(JournalIntegrityError);
  });

  it("ném khi entries không phải mảng", () => {
    expect(() => parseJournal(JSON.stringify({ version: "7", entries: {} }))).toThrow(
      JournalIntegrityError,
    );
  });
});

describe("assertJournalInvariants — BẤT BIẾN forward-only", () => {
  it("chấp nhận journal hợp lệ (idx 0..n-1 liên tục, tag duy nhất)", () => {
    expect(() => assertJournalInvariants(validEntries(122))).not.toThrow();
  });

  it("NEGATIVE: gap ở giữa (bỏ idx) → ném JournalIntegrityError", () => {
    const entries = validEntries(5);
    // bỏ idx 2 → còn [0,1,3,4]: idx KHÔNG liên tục
    const withGap = entries.filter((e) => e.idx !== 2);
    expect(() => assertJournalInvariants(withGap)).toThrow(JournalIntegrityError);
    expect(() => assertJournalInvariants(withGap)).toThrow(/gap|liên tục|expected/i);
  });

  it("NEGATIVE: trùng tag → ném JournalIntegrityError", () => {
    const entries = validEntries(4);
    entries[3] = { ...entries[3], tag: entries[1].tag };
    expect(() => assertJournalInvariants(entries)).toThrow(JournalIntegrityError);
    expect(() => assertJournalInvariants(entries)).toThrow(/duplicate|trùng/i);
  });

  it("NEGATIVE: không bắt đầu từ 0 → ném JournalIntegrityError", () => {
    const entries = validEntries(3).map((e) => ({ ...e, idx: e.idx + 1 }));
    expect(() => assertJournalInvariants(entries)).toThrow(JournalIntegrityError);
  });

  it("NEGATIVE: entries rỗng → ném JournalIntegrityError", () => {
    expect(() => assertJournalInvariants([])).toThrow(JournalIntegrityError);
  });

  it("NEGATIVE: idx không tăng đơn điệu (ra khỏi thứ tự) → ném", () => {
    const entries = validEntries(4);
    // hoán đổi idx 1 và 2 nhưng giữ thứ tự mảng → idx mảng = [0,2,1,3]
    const swapped = [entries[0], entries[2], entries[1], entries[3]];
    expect(() => assertJournalInvariants(swapped)).toThrow(JournalIntegrityError);
  });
});

describe("summarizeJournal — head idx ĐỌC ĐỘNG, không hard-code", () => {
  it("trả head = entries[last].idx + tag + count khớp số entries", () => {
    const entries = validEntries(122);
    const summary = summarizeJournal(entries);
    expect(summary.headIdx).toBe(121);
    expect(summary.tag).toBe(entries[121].tag);
    expect(summary.count).toBe(122);
  });

  it("head idx co giãn theo độ dài journal (đọc động, không hằng số)", () => {
    expect(summarizeJournal(validEntries(50)).headIdx).toBe(49);
    expect(summarizeJournal(validEntries(7)).headIdx).toBe(6);
  });

  it("NEGATIVE: số .sql áp != entries.length → mismatch bị bắt qua count", () => {
    const entries = validEntries(122);
    const summary = summarizeJournal(entries);
    // Bộ gọi (main) so summary.count với số file .sql; ở đây chứng minh count = nguồn động
    expect(summary.count).toBe(entries.length);
  });
});
