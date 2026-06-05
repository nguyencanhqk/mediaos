import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service";

describe("PasswordService (argon2id)", () => {
  const svc = new PasswordService();

  it("hash trả chuỗi argon2id KHÁC plaintext", async () => {
    const h = await svc.hash("s3cret-pw");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).not.toContain("s3cret-pw");
  });

  it("verify đúng mật khẩu → true; sai → false", async () => {
    const h = await svc.hash("correct-horse");
    expect(await svc.verify(h, "correct-horse")).toBe(true);
    expect(await svc.verify(h, "wrong-pw")).toBe(false);
  });

  it("verify với hash rác → false (không throw)", async () => {
    expect(await svc.verify("not-a-hash", "x")).toBe(false);
  });

  it("hai lần hash cùng mật khẩu cho kết quả khác nhau (salt ngẫu nhiên)", async () => {
    const a = await svc.hash("same");
    const b = await svc.hash("same");
    expect(a).not.toBe(b);
  });
});
