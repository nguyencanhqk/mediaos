import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session";

/**
 * Trong tam la CAC DUONG TU CHOI. "Ky roi doc lai ra dung" gan nhu khong the sai; cai co the
 * sai — va la cai nguy hiem — la mot phien het han / bi sua / khong co chu ky ma van duoc nhan.
 */

const USER = { sub: "user-1", email: "a@example.com", name: "Nguoi Dung" };

// Chuoi DON LAP co chu "example" — KHONG phai literal entropy cao.
// Ghep chuoi thoi CHUA DU: rule gitleaks `generic-api-key` bat theo doan entropy cao dung gan tu
// "secret", nen mot manh hex nam trong mang `.join()` van do (da can PR #354 that). `padEnd` cho
// chuoi du 32+ ky tu ma entropy gan 0, va tu "example" thoa hook .claude/hooks/guard-secrets.mjs.
const SECRET = "example-session-secret-".padEnd(40, "x");

beforeEach(() => {
  process.env.SOCIAL_SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SOCIAL_SESSION_SECRET;
});

describe("signSession / verifySession", () => {
  it("doc lai duoc phien vua ky", async () => {
    const token = await signSession(USER);
    const session = await verifySession(token);
    expect(session?.sub).toBe(USER.sub);
    expect(session?.email).toBe(USER.email);
  });

  it("phien HET HAN bi tu choi", async () => {
    const now = 1_000_000;
    const token = await signSession(USER, now);
    // Ngay sau thoi diem het han (TTL 8 tieng).
    expect(await verifySession(token, now + 8 * 60 * 60 + 1)).toBeNull();
    // Ngay truoc do thi con hop le — chung minh moc so sanh dung cho, khong phai luon null.
    expect(await verifySession(token, now + 8 * 60 * 60 - 1)).not.toBeNull();
  });

  it("sua payload ma giu chu ky cu thi bi tu choi", async () => {
    const token = await signSession(USER);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...USER, sub: "user-KHAC", exp: 9_999_999_999 }),
      "utf8",
    ).toString("base64url");
    expect(await verifySession(`${forged}.${signature}`)).toBeNull();
  });

  it("khong co chu ky thi bi tu choi", async () => {
    const [body] = (await signSession(USER)).split(".");
    expect(await verifySession(body)).toBeNull();
  });

  it("ky bang bi mat KHAC thi bi tu choi", async () => {
    const token = await signSession(USER);
    process.env.SOCIAL_SESSION_SECRET = "example-secret-KHAC-".padEnd(40, "y");
    expect(await verifySession(token)).toBeNull();
  });

  it("cookie rong / rac thi tra ve null chu khong nem loi", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("khong-phai-token")).toBeNull();
    expect(await verifySession("a.b.c")).toBeNull();
  });

  it("thieu SOCIAL_SESSION_SECRET thi KHONG the ky — khong co gia tri du phong am tham", async () => {
    delete process.env.SOCIAL_SESSION_SECRET;
    await expect(signSession(USER)).rejects.toThrow(/SOCIAL_SESSION_SECRET/);
  });

  it("bi mat ngan hon 32 ky tu bi tu choi", async () => {
    process.env.SOCIAL_SESSION_SECRET = "qua-ngan";
    await expect(signSession(USER)).rejects.toThrow(/32 ky tu/);
  });

  it("thieu bi mat thi verify tra ve null (dong), khong phai cho qua (mo)", async () => {
    const token = await signSession(USER);
    delete process.env.SOCIAL_SESSION_SECRET;
    expect(await verifySession(token)).toBeNull();
  });
});
