import { describe, expect, it } from "vitest";
import { PasswordService, PasswordVerificationError } from "./password.service";

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

  it("verify với hash rác → NÉM PasswordVerificationError (lỗi hạ tầng, KHÔNG nuốt thành 'sai mật khẩu')", async () => {
    // G2 follow-up #4: hash hỏng/encoding sai = toàn vẹn dữ liệu/hạ tầng → caller PHẢI phân biệt với
    // mismatch (false). Nuốt thành false = login khoá nhầm user thật khi DB lỗi (silent failure).
    await expect(svc.verify("not-a-hash", "x")).rejects.toBeInstanceOf(PasswordVerificationError);
  });

  it("mismatch mật khẩu KHÔNG ném (chỉ false) — chỉ lỗi hạ tầng mới ném", async () => {
    const h = await svc.hash("right");
    await expect(svc.verify(h, "nope")).resolves.toBe(false);
  });

  it("hai lần hash cùng mật khẩu cho kết quả khác nhau (salt ngẫu nhiên)", async () => {
    const a = await svc.hash("same");
    const b = await svc.hash("same");
    expect(a).not.toBe(b);
  });
});
