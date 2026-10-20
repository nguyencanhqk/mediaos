import { describe, expect, it } from "vitest";

// NHÁNH NHÁP — KHÔNG MERGE. S16-SOCIAL-STORAGETESTGATE-1 · B1: đo bằng vi phạm thật rằng bước «Test» của
// api.yml (giờ `pnpm … test | tee`) ĐỎ khi có một ca vitest đỏ — tức pipefail thật sự có hiệu lực.
describe("B1 pipefail probe (nhánh nháp, sẽ xoá)", () => {
  it("cố ý đỏ để bước Test của CI phải đỏ", () => {
    expect(1 + 1).toBe(3);
  });
});
