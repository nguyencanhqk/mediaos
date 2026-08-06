import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bo test cho dau NHAN cua cau SSO.
 *
 * Trong tam la CHONG PHAT LAI: mot token SSO la credential dung-mot-lan. Neu dung lai duoc thi
 * ai chup duoc URL (lich su trinh duyet, log proxy, tin nhan chuyen tiep) deu vao duoc ung dung
 * co toan bo token Facebook cua cong ty.
 */

// Chuoi don lap co chu "example" — xem ghi chu day du o session.spec.ts.
const SECRET = "example-sso-secret-".padEnd(40, "x");

let dataDir: string;

function makeToken(
  overrides: Partial<{ sub: string; email: string; name: string; exp: number; jti: string }> = {},
  secret = SECRET,
): string {
  const payload = {
    sub: "user-1",
    email: "a@example.com",
    name: "Nguoi Dung",
    iat: Date.now(),
    exp: Date.now() + 60_000,
    jti: randomUUID(),
    ...overrides,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fbpost-sso-"));
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  process.env.MEDIAOS_SSO_SECRET = SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.MEDIAOS_SSO_SECRET;
  vi.resetModules();
});

describe("consumeSsoToken", () => {
  it("token hop le duoc chap nhan mot lan", async () => {
    const { consumeSsoToken } = await import("./sso");
    const result = consumeSsoToken(makeToken());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe("user-1");
      expect(result.payload.email).toBe("a@example.com");
    }
  });

  it("DUNG LAI cung token bi tu choi — day la ca quan trong nhat", async () => {
    const { consumeSsoToken } = await import("./sso");
    const token = makeToken();

    expect(consumeSsoToken(token).ok).toBe(true);

    const second = consumeSsoToken(token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("replay");
  });

  it("hai token KHAC nhau cua cung nguoi dung deu dung duoc", async () => {
    const { consumeSsoToken } = await import("./sso");
    expect(consumeSsoToken(makeToken()).ok).toBe(true);
    expect(consumeSsoToken(makeToken()).ok).toBe(true);
  });

  it("token HET HAN bi tu choi", async () => {
    const { consumeSsoToken } = await import("./sso");
    const result = consumeSsoToken(makeToken({ exp: Date.now() - 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("token het han KHONG chiem cho trong bang — jti do van dung duoc neu con han", async () => {
    // Chung minh thu tu kiem la dung: het-han duoc chan TRUOC buoc tieu thu.
    const { consumeSsoToken } = await import("./sso");
    const jti = randomUUID();
    expect(consumeSsoToken(makeToken({ jti, exp: Date.now() - 1 })).ok).toBe(false);
    expect(consumeSsoToken(makeToken({ jti })).ok).toBe(true);
  });

  it("token ky bang bi mat KHAC bi tu choi", async () => {
    const { consumeSsoToken } = await import("./sso");
    const other = "example-sso-KHAC-".padEnd(40, "y");
    const result = consumeSsoToken(makeToken({}, other));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  it("sua payload ma giu chu ky cu bi tu choi", async () => {
    const { consumeSsoToken } = await import("./sso");
    const [, sig] = makeToken().split(".");
    const forged = Buffer.from(
      JSON.stringify({
        sub: "ke-gia-mao",
        email: "x@y.z",
        exp: Date.now() + 60_000,
        jti: randomUUID(),
      }),
      "utf8",
    ).toString("base64url");
    const result = consumeSsoToken(`${forged}.${sig}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  it("token sai chu ky KHONG de lai dau vet trong bang (khong the lam day bang)", async () => {
    const { consumeSsoToken } = await import("./sso");
    const { getDb } = await import("../db");
    const other = "example-sso-KHAC-".padEnd(40, "y");

    for (let i = 0; i < 5; i += 1) consumeSsoToken(makeToken({}, other));

    const row = getDb().prepare("SELECT COUNT(*) AS n FROM sso_consumed_tokens").get() as {
      n: number;
    };
    expect(Number(row.n)).toBe(0);
  });

  it("thieu MEDIAOS_SSO_SECRET → tu choi (dong), khong phai cho qua (mo)", async () => {
    delete process.env.MEDIAOS_SSO_SECRET;
    vi.resetModules();
    const { consumeSsoToken } = await import("./sso");
    const result = consumeSsoToken(makeToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("config");
  });

  it("bi mat ngan hon 32 ky tu bi coi nhu chua cau hinh", async () => {
    process.env.MEDIAOS_SSO_SECRET = "qua-ngan";
    vi.resetModules();
    const { consumeSsoToken } = await import("./sso");
    const result = consumeSsoToken(makeToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("config");
  });

  it("chuoi rac / sai dinh dang bi tu choi, khong nem loi", async () => {
    const { consumeSsoToken } = await import("./sso");
    for (const bad of ["", "khong-cham", "a.b.c", "!!!.???"]) {
      expect(consumeSsoToken(bad).ok).toBe(false);
    }
  });

  it("thieu truong bat buoc trong payload bi tu choi du chu ky DUNG", async () => {
    const { consumeSsoToken } = await import("./sso");
    const b64 = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 }), "utf8").toString(
      "base64url",
    );
    const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");
    const result = consumeSsoToken(`${b64}.${sig}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("format");
  });
});

describe("pruneConsumedTokens", () => {
  it("chi don jti CU, giu lai jti moi (khong mo lai cua so phat lai)", async () => {
    const { consumeSsoToken, pruneConsumedTokens } = await import("./sso");
    const { getDb } = await import("../db");

    const token = makeToken();
    consumeSsoToken(token);

    // Don voi nguong 1 ngay: jti vua tieu thu PHAI con lai.
    expect(pruneConsumedTokens()).toBe(0);
    expect(consumeSsoToken(token).ok).toBe(false);

    // Gia lam cu di roi don — luc do moi duoc xoa.
    getDb().prepare("UPDATE sso_consumed_tokens SET consumed_at = 0").run();
    expect(pruneConsumedTokens()).toBe(1);
  });
});
