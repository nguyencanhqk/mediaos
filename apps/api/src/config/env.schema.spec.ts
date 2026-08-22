import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.schema";

describe("loadEnv", () => {
  it("applies defaults when optional vars are absent", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3100);
    expect(env.API_PREFIX).toBe("api");
    expect(env.API_VERSION).toBe("v1");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("coerces API_PORT from string", () => {
    const env = loadEnv({ API_PORT: "4000" } as NodeJS.ProcessEnv);
    expect(env.API_PORT).toBe(4000);
  });

  it("throws on invalid NODE_ENV", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("throws on malformed DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv)).toThrow();
  });

  // S6-SEC-DBFENCE-1 (KI-028): hàng rào test đặt DATABASE_URL="" CỐ Ý để nói "không có DB đích" (và để
  // chặn load-env nạp đè URL PROD từ .env). Rỗng PHẢI đọc là CHƯA SET, không phải URL sai — nếu không,
  // loadEnv() ném ngay lúc import src/db/index.ts và mọi spec chạm chuỗi import đó đỏ ở bước collect.
  it.each([
    "DATABASE_URL",
    "DATABASE_DIRECT_URL",
    "DATABASE_WORKER_URL",
    "PGBOUNCER_URL",
    "VALKEY_URL",
    "S3_ENDPOINT",
  ])("coi %s='' là CHƯA SET (không phải URL sai)", (key) => {
    const env = loadEnv({ [key]: "" } as NodeJS.ProcessEnv);
    expect(env[key as keyof typeof env]).toBeUndefined();
  });

  it("chuỗi chỉ có khoảng trắng cũng là CHƯA SET", () => {
    expect(loadEnv({ DATABASE_URL: "   " } as NodeJS.ProcessEnv).DATABASE_URL).toBeUndefined();
  });

  it("defaults KMS_PROVIDER to local with a KEK path", () => {
    const env = loadEnv({});
    expect(env.KMS_PROVIDER).toBe("local");
    expect(env.KMS_LOCAL_KEK_PATH).toBe(".secrets/local-kek.bin");
  });

  it("throws when KMS_PROVIDER=vault without addr/token", () => {
    expect(() => loadEnv({ KMS_PROVIDER: "vault" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("accepts KMS_PROVIDER=vault with addr+token", () => {
    const env = loadEnv({
      KMS_PROVIDER: "vault",
      KMS_VAULT_ADDR: "http://vault:8200",
      KMS_VAULT_TOKEN: "dev-token",
    } as NodeJS.ProcessEnv);
    expect(env.KMS_PROVIDER).toBe("vault");
  });

  it("leaves PLATFORM_OPERATOR_EMAIL undefined by default with sane defaults", () => {
    const env = loadEnv({});
    expect(env.PLATFORM_OPERATOR_EMAIL).toBeUndefined();
    expect(env.PLATFORM_OPERATOR_NAME).toBe("Platform Operator");
    expect(env.PLATFORM_OPERATOR_COMPANY_SLUG).toBe("demo");
  });

  it("throws when PLATFORM_OPERATOR_EMAIL is set without a password", () => {
    expect(() =>
      loadEnv({ PLATFORM_OPERATOR_EMAIL: "operator@demo.local" } as NodeJS.ProcessEnv),
    ).toThrow(/PLATFORM_OPERATOR_PASSWORD/);
  });

  it("throws when PLATFORM_OPERATOR_PASSWORD is shorter than 12 chars", () => {
    expect(() =>
      loadEnv({
        PLATFORM_OPERATOR_EMAIL: "operator@demo.local",
        PLATFORM_OPERATOR_PASSWORD: "short",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("accepts a complete operator bootstrap config", () => {
    const env = loadEnv({
      PLATFORM_OPERATOR_EMAIL: "operator@demo.local",
      PLATFORM_OPERATOR_PASSWORD: "Operator@12345",
      PLATFORM_OPERATOR_COMPANY_SLUG: "acme",
    } as NodeJS.ProcessEnv);
    expect(env.PLATFORM_OPERATOR_EMAIL).toBe("operator@demo.local");
    expect(env.PLATFORM_OPERATOR_COMPANY_SLUG).toBe("acme");
  });

  it("defaults the worker scheduler to enabled with 5s/10s poll intervals", () => {
    const env = loadEnv({});
    expect(env.WORKERS_SCHEDULER_ENABLED).toBe("true");
    expect(env.OUTBOX_POLL_MS).toBe(5000);
    expect(env.EXPORT_POLL_MS).toBe(10000);
  });

  it("coerces worker poll intervals from strings", () => {
    const env = loadEnv({
      OUTBOX_POLL_MS: "2500",
      EXPORT_POLL_MS: "30000",
    } as NodeJS.ProcessEnv);
    expect(env.OUTBOX_POLL_MS).toBe(2500);
    expect(env.EXPORT_POLL_MS).toBe(30000);
  });

  it("accepts WORKERS_SCHEDULER_ENABLED=false (kill-switch)", () => {
    const env = loadEnv({ WORKERS_SCHEDULER_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(env.WORKERS_SCHEDULER_ENABLED).toBe("false");
  });

  // ── S2-FND-SEED-3 bootstrap default company (owner-chốt #4 — mapping param→cột companies) ──────────
  it("defaults BOOTSTRAP_COMPANY_* to a CHECK-safe demo tenant (language='vi' NOT 'vi-VN', currency='VND')", () => {
    const env = loadEnv({});
    expect(env.BOOTSTRAP_COMPANY_SLUG).toBe("demo"); // khớp PLATFORM_SUPERADMIN_COMPANY_SLUG → chuỗi bootstrap khép kín
    expect(env.BOOTSTRAP_COMPANY_NAME).toBe("Demo Company");
    expect(env.BOOTSTRAP_COMPANY_TIMEZONE).toBe("Asia/Ho_Chi_Minh");
    // language 'vi' (KHÔNG 'vi-VN') để qua companies_language_check IN ('vi','en') (mig 0015).
    expect(env.BOOTSTRAP_COMPANY_LANGUAGE).toBe("vi");
    expect(env.BOOTSTRAP_COMPANY_CURRENCY).toBe("VND");
  });

  it("rejects BOOTSTRAP_COMPANY_LANGUAGE='vi-VN' at the boundary (fail-fast trước CHECK companies.language)", () => {
    // 'vi-VN' vi phạm companies_language_check ⇒ enum ép loadEnv throw NGAY (không để function chạm CHECK runtime).
    expect(() =>
      loadEnv({ BOOTSTRAP_COMPANY_LANGUAGE: "vi-VN" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("rejects BOOTSTRAP_COMPANY_CURRENCY outside {VND,USD} (khớp companies_currency_check)", () => {
    expect(() =>
      loadEnv({ BOOTSTRAP_COMPANY_CURRENCY: "EUR" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("accepts an overridden BOOTSTRAP_COMPANY config (slug/name/language en)", () => {
    const env = loadEnv({
      BOOTSTRAP_COMPANY_SLUG: "acme",
      BOOTSTRAP_COMPANY_NAME: "Acme Corp",
      BOOTSTRAP_COMPANY_LANGUAGE: "en",
      BOOTSTRAP_COMPANY_CURRENCY: "USD",
    } as NodeJS.ProcessEnv);
    expect(env.BOOTSTRAP_COMPANY_SLUG).toBe("acme");
    expect(env.BOOTSTRAP_COMPANY_NAME).toBe("Acme Corp");
    expect(env.BOOTSTRAP_COMPANY_LANGUAGE).toBe("en");
    expect(env.BOOTSTRAP_COMPANY_CURRENCY).toBe("USD");
  });

  it("rejects a non-positive or non-numeric poll interval", () => {
    expect(() => loadEnv({ OUTBOX_POLL_MS: "0" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
    expect(() => loadEnv({ EXPORT_POLL_MS: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  // ── KI-029: PERMISSION_GUARD_ENABLED ────────────────────────────────────────────────────────────
  // Cờ này làm MỌI route đã gate fail-OPEN. Trước 2026-07-28 nó không có trong schema ⇒ không validate,
  // không ai biết. Bốn ca dưới khoá đúng bốn tính chất phải giữ.

  it("mặc định BẬT PermissionGuard khi không khai gì", () => {
    expect(loadEnv({}).PERMISSION_GUARD_ENABLED).toBe("true");
  });

  it("CHẶN BOOT khi tắt PermissionGuard ở production (fail-loud, không phải một dòng warn)", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        PERMISSION_GUARD_ENABLED: "false",
      } as NodeJS.ProcessEnv),
    ).toThrow(/PERMISSION_GUARD_ENABLED/);
  });

  it("production + 'true' vẫn boot bình thường (chốt chỉ nhắm đúng giá trị nguy hiểm)", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      PERMISSION_GUARD_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(env.PERMISSION_GUARD_ENABLED).toBe("true");
  });

  it("dev/test VẪN tắt được — reviewer dùng chính cờ này để tái lập vế RED của gate quyền", () => {
    for (const NODE_ENV of ["development", "test"] as const) {
      const env = loadEnv({ NODE_ENV, PERMISSION_GUARD_ENABLED: "false" } as NodeJS.ProcessEnv);
      expect(env.PERMISSION_GUARD_ENABLED).toBe("false");
    }
  });

  it("từ chối giá trị lạ ('False'/'0'/'') thay vì im lặng coi là BẬT", () => {
    for (const bad of ["False", "0", "", "no"]) {
      expect(() => loadEnv({ PERMISSION_GUARD_ENABLED: bad } as NodeJS.ProcessEnv)).toThrow(
        /Invalid environment variables/,
      );
    }
  });

  // ── KI-031 / S10-FND-ENVKEY-1 — INTERNAL_API_KEY ───────────────────────────────────────────────
  // Ba ca dưới đây ĐÓNG ĐINH CHIỀU ĐÃ CHỌN, không phải mô tả lại schema. WO này có đúng một quyết
  // định đáng cãi (optional hay required) và ca đầu tiên là thứ giữ nó: ai đó "siết cho chặt" thành
  // required sẽ thấy test đỏ kèm lý do, thay vì thấy CI xanh rồi làm sập boot mọi máy chưa đặt biến.
  it("vắng INTERNAL_API_KEY KHÔNG chặn boot — fail-closed nằm ở InternalGuard, không ở schema", () => {
    const env = loadEnv({});
    expect(env.INTERNAL_API_KEY).toBeUndefined();
  });

  it("có khoá nhưng NGẮN hơn 32 ký tự thì ĐỎ ngay ở biên, không để khoá yếu vào chạy thật", () => {
    expect(() => loadEnv({ INTERNAL_API_KEY: "x".repeat(31) } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("nhận khoá đủ dài", () => {
    const key = "y".repeat(32);
    const env = loadEnv({ INTERNAL_API_KEY: key } as NodeJS.ProcessEnv);
    expect(env.INTERNAL_API_KEY).toBe(key);
  });

  // ── S10-CHAT-CALLSWEEP-1 (KI-063): hai ngưỡng gặt cuộc gọi `active` ───────────────────────────────
  // Ba ca dưới ĐÓNG ĐINH cả hai vế của quyết định, không mô tả lại schema:
  //  · vắng ⇒ có default — biến MỚI không mặc định giết fixture int-spec ở một file KHÁC hẳn chỗ gán;
  //  · vượt trần ⇒ ĐỎ — nếu chỉ `.positive()`, một giá trị rác TẮT LẶNG LẼ lưới an toàn mà không ai biết.
  it("vắng cả hai ngưỡng gặt cuộc gọi ⇒ dùng default (2 phút ân hạn · 12 giờ trần thọ)", () => {
    const env = loadEnv({});
    expect(env.CHAT_CALL_ORPHAN_GRACE_MS).toBe(120_000);
    expect(env.CHAT_CALL_ACTIVE_MAX_MS).toBe(43_200_000);
  });

  it("CHAT_CALL_ACTIVE_MAX_MS vượt trần 24 giờ ⇒ ĐỎ ở biên (không cho tắt lặng lẽ lưới an toàn)", () => {
    expect(() =>
      loadEnv({ CHAT_CALL_ACTIVE_MAX_MS: String(86_400_001) } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("CHAT_CALL_ORPHAN_GRACE_MS vượt trần 1 giờ ⇒ ĐỎ; giá trị trong biên thì coerce từ chuỗi", () => {
    expect(() =>
      loadEnv({ CHAT_CALL_ORPHAN_GRACE_MS: String(3_600_001) } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
    const env = loadEnv({ CHAT_CALL_ORPHAN_GRACE_MS: "45000" } as NodeJS.ProcessEnv);
    expect(env.CHAT_CALL_ORPHAN_GRACE_MS).toBe(45_000);
  });

  // ── SÀN (vế nguy hiểm hơn TRẦN) ───────────────────────────────────────────────────────────────────
  // Trần chỉ tắt lặng lẽ lưới an toàn. SÀN chặn một cấu hình rác PHÁ DỮ LIỆU: `=1` cho một nhịp sau gặt
  // MỌI cuộc gọi đang nói chuyện và ghi kết cục HẤP THỤ vào `chat_call_participants` — bảng KHÔNG có
  // `DELETE` grant (BẤT BIẾN #2) ⇒ **không hoàn tác được**.
  it.each([
    ["CHAT_CALL_ACTIVE_MAX_MS", "1"],
    ["CHAT_CALL_ACTIVE_MAX_MS", String(599_999)],
    ["CHAT_CALL_ORPHAN_GRACE_MS", "1"],
    ["CHAT_CALL_ORPHAN_GRACE_MS", String(29_999)],
  ])("%s=%s dưới sàn ⇒ CHẶN BOOT (gặt-sạch-không-hoàn-tác)", (key, value) => {
    expect(() => loadEnv({ [key]: value } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("sàn nằm DƯỚI mọi giá trị fixture đang dùng — đổi sàn mà quên chỗ này là đỏ ở file KHÁC hẳn", () => {
    // Ba số này là fixture THẬT: int-spec `chat-call-stale-active-sweep` đặt 60_000 / 3_600_000, và ca
    // "coerce từ chuỗi" ngay bên trên đặt 45_000. Nâng sàn vượt bất kỳ số nào ở đây sẽ giết chúng ở một
    // file cách xa chỗ gán (memory `env-schema-floor-breaks-test-fixtures`) — ca này bắt ngay tại nguồn.
    const env = loadEnv({
      CHAT_CALL_ORPHAN_GRACE_MS: String(60_000),
      CHAT_CALL_ACTIVE_MAX_MS: String(3_600_000),
    } as NodeJS.ProcessEnv);
    expect(env.CHAT_CALL_ORPHAN_GRACE_MS).toBe(60_000);
    expect(env.CHAT_CALL_ACTIVE_MAX_MS).toBe(3_600_000);
    expect(
      loadEnv({ CHAT_CALL_ORPHAN_GRACE_MS: "45000" } as NodeJS.ProcessEnv)
        .CHAT_CALL_ORPHAN_GRACE_MS,
    ).toBe(45_000);
  });
});
