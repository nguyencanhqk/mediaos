import { describe, expect, it } from "vitest";
import { redactString, redactValue } from "./log-redaction";

// Fixture giống-secret PHẢI ghép chuỗi (KHÔNG literal high-entropy) — gitleaks `generic-api-key`
// quét full-history, đỏ oan dù không phải secret thật (xem CLAUDE.md §5).
const FAKE_TOKEN = ["test", "log-redaction", "token", "x".repeat(24)].join("-");
const FAKE_PASSWORD = ["test", "log-redaction", "password", "y".repeat(16)].join("-");
const FAKE_INTERNAL_KEY = ["test", "internal-key", "z".repeat(20)].join("-");
const FAKE_DB_PASSWORD = ["s3cr3t", "db", "pass"].join("-");
const FAKE_JWT = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE1MTZ9",
  ["sig", "x".repeat(20)].join(""),
].join(".");

describe("redactString — mẫu trong giá trị chuỗi tự do", () => {
  it("che credential trong connection string Postgres, giữ scheme + host", () => {
    const line = `connect ECONNREFUSED postgres://mediaos_app:${FAKE_DB_PASSWORD}@10.0.0.5:5432/mediaos`;
    const out = redactString(line);
    expect(out).not.toContain(FAKE_DB_PASSWORD);
    expect(out).toContain("postgres://[REDACTED]@10.0.0.5:5432/mediaos");
  });

  it("che connection string Redis/AMQP theo cùng mẫu scheme://user:pass@host", () => {
    expect(redactString(`redis://default:${FAKE_DB_PASSWORD}@valkey:6379`)).not.toContain(
      FAKE_DB_PASSWORD,
    );
    expect(redactString(`amqp://svc:${FAKE_DB_PASSWORD}@mq:5672/vhost`)).not.toContain(
      FAKE_DB_PASSWORD,
    );
  });

  it("che header Authorization: Bearer <token> lọt vào message tự do", () => {
    const out = redactString(`upstream 403 — Authorization: Bearer ${FAKE_TOKEN}`);
    expect(out).not.toContain(FAKE_TOKEN);
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("che chuỗi trông giống JWT (3 phần base64url cách nhau dấu chấm)", () => {
    const out = redactString(`decode failed for ${FAKE_JWT}`);
    expect(out).not.toContain(FAKE_JWT);
    expect(out).toContain("[REDACTED]");
  });

  it("chuỗi không mang mẫu nhạy cảm đi qua nguyên vẹn", () => {
    expect(redactString("GET /api/v1/health -> 200 [OK] req=abc-123")).toBe(
      "GET /api/v1/health -> 200 [OK] req=abc-123",
    );
  });
});

describe("redactValue — object lồng nhau, chặn theo TÊN KHOÁ", () => {
  it("che field password/token/secret bất kể giá trị là gì", () => {
    const out = redactValue({
      username: "an.nguyen",
      password: FAKE_PASSWORD,
      accessToken: FAKE_TOKEN,
      apiSecret: "irrelevant-value",
    }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.accessToken).toBe("[REDACTED]");
    expect(out.apiSecret).toBe("[REDACTED]");
    expect(out.username).toBe("an.nguyen");
  });

  it("che header 'x-internal-key' — không phân biệt hoa/thường tên khoá", () => {
    const out = redactValue({
      headers: { "x-internal-key": FAKE_INTERNAL_KEY, "content-type": "application/json" },
    }) as { headers: Record<string, unknown> };
    expect(out.headers["x-internal-key"]).toBe("[REDACTED]");
    expect(out.headers["content-type"]).toBe("application/json");
  });

  it("che connection string nằm SÂU trong object lồng nhau (không chỉ top-level)", () => {
    const out = redactValue({
      config: { db: { url: `postgres://app:${FAKE_DB_PASSWORD}@host:5432/db` } },
    }) as { config: { db: { url: unknown } } };
    // Khớp CẢ hai lớp chắn: tên khoá "url" không nhạy cảm nên đi qua redactString, và redactString
    // che credential trong connection string.
    expect(out.config.db.url).not.toContain(FAKE_DB_PASSWORD);
  });

  it("che field tên 'database_url'/'dsn' toàn bộ, bất kể nội dung", () => {
    const out = redactValue({ DATABASE_URL: "anything", dsn: "anything-else" }) as Record<
      string,
      unknown
    >;
    expect(out.DATABASE_URL).toBe("[REDACTED]");
    expect(out.dsn).toBe("[REDACTED]");
  });

  it("Error → giữ name, redact message + stack", () => {
    const err = new Error(`upstream failed: Bearer ${FAKE_TOKEN}`);
    const out = redactValue(err) as { name: string; message: string };
    expect(out.name).toBe("Error");
    expect(out.message).not.toContain(FAKE_TOKEN);
  });

  it("object vòng (circular) KHÔNG làm hàm treo — trả về đánh dấu thay vì đệ quy vô hạn", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = redactValue(obj) as Record<string, unknown>;
    expect(out.self).toBe("[REDACTED:circular]");
  });

  it("giá trị không nhạy cảm (số/bool/null) đi qua nguyên vẹn", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
  });

  it("mảng — redact từng phần tử", () => {
    const out = redactValue([{ token: FAKE_TOKEN }, "plain"]) as [Record<string, unknown>, string];
    expect(out[0].token).toBe("[REDACTED]");
    expect(out[1]).toBe("plain");
  });
});
