import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S7-CHAT-RT-1 — ràng buộc CẤU TRÚC, không phải hành vi. Ba luật dưới đây không có ca runtime nào bắt
 * được (chúng nói về thứ KHÔNG ĐƯỢC TỒN TẠI), nên chỉ quét mã nguồn mới gác nổi.
 */

const SRC = join(__dirname, "..");
const REALTIME_DIR = join(SRC, "realtime");
const CHAT_DIR = join(SRC, "chat");

/** Đọc mọi file .ts (bỏ spec) trong một thư mục. */
function sourcesOf(dir: string): { file: string; text: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
}

/** Bỏ comment — luật nói về CODE, không về văn xuôi giải thích luật (memory: guard-immutability-matches-comments). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("CHAT-DEC-005 — WS MỘT CHIỀU", () => {
  it("0 `@SubscribeMessage` trong toàn bộ apps/api/src", () => {
    // Không giới hạn ở realtime/**: thêm handler client→server ở BẤT KỲ gateway nào cũng mở lại bề mặt
    // mà CHAT-DEC-005 đã đóng.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
          if (stripComments(readFileSync(p, "utf8")).includes("@SubscribeMessage"))
            offenders.push(p);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("gateway KHÔNG đọc roomId/danh sách phòng từ handshake của client", () => {
    const gateway = stripComments(readFileSync(join(REALTIME_DIR, "realtime.gateway.ts"), "utf8"));

    // Quét TRUY CẬP THUỘC TÍNH `.handshake…` (không phải chữ "handshake" trong chuỗi log). Mỗi lần đọc
    // dữ liệu do client kiểm soát PHẢI là `.handshake.auth` hoặc `.handshake.headers` — hai lối rút
    // TOKEN. Bất cứ khoá nào khác (roomId, rooms, companyId…) là để client tự khai mình ở phòng nào.
    const accesses = [...gateway.matchAll(/\.handshake\s*\.\s*([A-Za-z_$][\w$]*)/g)].map(
      (m) => m[1],
    );
    expect(accesses.length).toBeGreaterThan(0); // positive control: có đọc handshake thật
    for (const key of accesses) {
      expect(["auth", "headers"]).toContain(key);
    }

    // Danh sách phòng phải tới TỪ REPO, không từ socket.
    expect(gateway).toMatch(/listRoomsForUser\(/);
  });
});

describe("Đồ thị module — không dựng lại vòng Realtime→Chat→Realtime", () => {
  it("0 file trong chat/** import `realtime.gateway` hoặc `realtime.module`", () => {
    const offenders = sourcesOf(CHAT_DIR)
      .filter(({ text }) =>
        /from\s+["'][^"']*realtime\.(gateway|module)["']/.test(stripComments(text)),
      )
      .map(({ file }) => file);
    // Lối duy nhất được phép là `realtime-emitter.service` / `realtime-emitter.module` (module LÁ).
    expect(offenders).toEqual([]);
  });

  /**
   * Danh sách MODULE LÁ mà `chat/**` được phép import từ `realtime/**`.
   *
   * ⚠️ Thêm tên vào đây KHÔNG đủ để hợp lệ — ca test ngay dưới đo lại **tính chất lá** của từng cái
   * (memory `index-ratchet-must-pin-definition-not-name`: ratchet phải ghim ĐỊNH NGHĨA, không ghim tên).
   * Một file lá "trên danh nghĩa" mà lỡ import ngược `chat.module`/`realtime.module` sẽ dựng lại đúng
   * cái vòng mà cả cụm này tồn tại để chặn, và Nest sập lúc bootstrap (100+ int-spec đỏ dây chuyền).
   */
  const LEAF_BASENAMES = [
    "realtime-emitter", // S7 — cổng emit
    "chat-presence-reader", // S8-CHAT-UX-FE-3 — vế CHỈ ĐỌC của presence (roster cần ảnh chụp)
  ] as const;

  it("chat/** chỉ đi qua MODULE LÁ của realtime", () => {
    const leafRe = new RegExp(`(${LEAF_BASENAMES.join("|")})\\.(service|module)$`);
    const importers = sourcesOf(CHAT_DIR).filter(({ text }) =>
      /from\s+["']\.\.\/realtime\//.test(stripComments(text)),
    );
    expect(importers.length).toBeGreaterThan(0); // positive control: có thật vài file dùng leaf
    for (const { file, text } of importers) {
      const paths = [
        ...stripComments(text).matchAll(/from\s+["'](\.\.\/realtime\/[^"']+)["']/g),
      ].map((m) => m[1]);
      for (const p of paths) {
        expect(p, `${file} import sai đường realtime`).toMatch(leafRe);
      }
    }
  });

  it("mỗi module LÁ trong allowlist THẬT SỰ là lá — không import ngược chat/** hay realtime.module", () => {
    for (const base of LEAF_BASENAMES) {
      for (const suffix of ["service", "module"] as const) {
        const path = join(REALTIME_DIR, `${base}.${suffix}.ts`);
        if (!existsSync(path)) continue; // `realtime-emitter.service` không có cặp module cùng tên ở mọi bản
        const text = stripComments(readFileSync(path, "utf8"));
        // Import `../chat/**` bất kỳ ⇒ leaf phụ thuộc ngược vào module nghiệp vụ ⇒ hết là lá.
        expect(/from\s+["']\.\.\/chat\//.test(text), `${base}.${suffix} import ngược chat/**`).toBe(
          false,
        );
        expect(
          /from\s+["'][^"']*realtime\.(gateway|module)["']/.test(text),
          `${base}.${suffix} import realtime.gateway/module`,
        ).toBe(false);
      }
    }
  });
});
