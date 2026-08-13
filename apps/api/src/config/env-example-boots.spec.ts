import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.schema";

/**
 * S10-FND-ENVKEY-1 — chốt hồi quy cho bước cài đặt lần đầu ghi ở CLAUDE.md §7: `cp .env.example .env`.
 *
 * Vì sao spec này tồn tại (đo 13/08/2026, lỗi CÓ THẬT trên master TRƯỚC WO này): `.env.example` ship
 * giá trị RỖNG cho các secret tắt-mềm, `load-env.ts` gán thẳng `process.env[key] = ""` (nó KHÔNG lọc
 * rỗng), còn schema đòi `.min(32)`. Chuỗi rỗng KHÔNG phải `undefined` ⇒ trượt sàn độ dài ⇒ `loadEnv()`
 * NÉM ⇒ **API không boot**. Người cài làm đúng hướng dẫn — copy file mẫu, điền hết chỗ `__SET_ME__` —
 * vẫn nhận "Invalid environment variables" về ba token họ chưa từng nghe tên và không hề định bật.
 *
 * Ranh giới của phép thử — đọc kỹ trước khi sửa spec này:
 *   • `__SET_ME__` là CỐ Ý không hợp lệ (header `.env.example` · S6-SEC-ROTATE-1/KI-043): quên điền thì
 *     phải sập, đó là fail-closed đúng thiết kế. Nên ở đây ta ĐIỀN chúng trước, mô phỏng người cài đã
 *     làm xong phần bắt buộc.
 *   • Sau bước đó, thứ CÒN LẠI làm sập boot chỉ có thể là secret TẮT-MỀM để rỗng — và đó là lỗi.
 * Nói cách khác spec này khẳng định: "điền hết phần bắt buộc rồi thì API PHẢI boot được, không cần
 * cấu hình thêm bất kỳ tính năng tuỳ chọn nào."
 */
function envExampleWithRequiredSecretsFilled(): NodeJS.ProcessEnv {
  const raw = readFileSync(resolve(__dirname, "../../../../.env.example"), "utf8");
  // Không phải secret thật, chỉ là chuỗi đủ dài để qua `.min(32)` — sinh tại chỗ để không có literal
  // entropy cao nằm trong repo (bài học gitleaks `generic-api-key`).
  const filler = "placeholder".padEnd(48, "0");
  const env: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .split("__SET_ME__")
      .join(filler);
  }
  return env as NodeJS.ProcessEnv;
}

describe(".env.example (bước cài lần đầu CLAUDE.md §7)", () => {
  it("điền xong mọi __SET_ME__ thì loadEnv PHẢI qua — không tính năng tuỳ chọn nào được chặn boot", () => {
    expect(() => loadEnv(envExampleWithRequiredSecretsFilled())).not.toThrow();
  });

  it("mọi secret TẮT-MỀM để rỗng đều đọc là CHƯA SET, không phải 'khoá dài 0 ký tự'", () => {
    for (const key of [
      "INTERNAL_API_KEY",
      "LMS_SSO_SECRET",
      "LMS_SYNC_TOKEN",
      "LMS_PROGRESS_TOKEN",
      "LMS_NOTI_TOKEN",
      "SOCIAL_SSO_SECRET",
    ]) {
      const env = loadEnv({ [key]: "" } as NodeJS.ProcessEnv);
      expect(env[key as keyof typeof env], `${key}="" phải là undefined`).toBeUndefined();
    }
  });

  it("sàn độ dài VẪN ép khi có giá trị thật (nới rỗng KHÔNG được nới luôn khoá yếu)", () => {
    expect(() => loadEnv({ INTERNAL_API_KEY: "x".repeat(31) } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
    expect(() => loadEnv({ LMS_NOTI_TOKEN: "x".repeat(31) } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });
});
