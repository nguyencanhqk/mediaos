import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S17-CHAT-EMITTERSPLIT-1 — ratchet CẤU TRÚC cho lớp room-op tách khỏi `realtime-emitter.service.ts`.
 *
 * Hành vi đã được ghim bởi các spec có sẵn (`realtime-emitter.{chat,feed,call}.spec.ts` ·
 * `realtime-emitter.{feed,roomops}.io.spec.ts` · `chat-realtime-after-commit.spec.ts`) — chúng đi qua method
 * ủy quyền của emitter nên vẫn đo đúng thân mới. Ca dưới canh những gì các spec đó KHÔNG thấy:
 *   • room-op KHÔNG phát payload (masking của CLAUDE.md §5 đứng ở emitter; một `.emit(` lọt vào đây là
 *     một cổng phát THỨ HAI mà ratchet `.parse()` của `chat-realtime-structure.spec.ts` không đọc tới);
 *   • room-op là LÁ — ratchet lá hiện có chỉ đọc `realtime-emitter.{service,module}.ts`, không đi theo
 *     import bắc cầu, nên lớp này import ngược `chat/**`/`social/**` sẽ dựng lại vòng module mà không ai đỏ;
 *   • MỘT chỗ chứa room-op: emitter không còn `socketsJoin`/`socketsLeave` của riêng nó, và ngoài emitter
 *     không file nguồn nào import lớp này (caller đi qua method ủy quyền, chữ ký không đổi).
 */
const SRC = join(__dirname, "..");
const REALTIME_DIR = join(SRC, "realtime");
const ROOM_OPS = "realtime-room-ops.ts";
const EMITTER = "realtime-emitter.service.ts";

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (file: string): string =>
  stripComments(readFileSync(join(REALTIME_DIR, file), "utf8"));

const importsOf = (code: string): string[] =>
  [
    ...code.matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1] as string);

/** Mọi file .ts (bỏ spec) dưới `apps/api/src`, đường dẫn tương đối dùng `/`, đã bỏ comment. */
function allSources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
        out.push({
          rel: p.slice(SRC.length + 1).replace(/\\/g, "/"),
          text: stripComments(readFileSync(p, "utf8")),
        });
      }
    }
  };
  walk(SRC);
  return out;
}

describe("S17-CHAT-EMITTERSPLIT-1 — room-op ở MỘT lớp riêng, lá, không phát payload", () => {
  it("lớp room-op KHÔNG có `.emit(` (neo dương: có thật `socketsJoin`/`socketsLeave`)", () => {
    const code = read(ROOM_OPS);
    expect(code).toMatch(/\.socketsJoin\(/);
    expect(code).toMatch(/\.socketsLeave\(/);
    expect([...code.matchAll(/\.emit\s*\(/g)]).toHaveLength(0);
  });

  it("lớp room-op là LÁ — chỉ import `@nestjs/common` · `socket.io` · `./rooms`", () => {
    const specs = importsOf(read(ROOM_OPS));
    expect(specs, "positive control — có import thật").toContain("./rooms");
    for (const s of specs) {
      expect(s, `${ROOM_OPS} import ngoài allowlist`).toMatch(
        /^(@nestjs\/common|socket\.io|\.\/rooms)$/,
      );
    }
  });

  it("emitter ủy quyền cho lớp room-op và KHÔNG còn thân room-op riêng", () => {
    const code = read(EMITTER);
    expect(importsOf(code)).toContain("./realtime-room-ops");
    for (const m of ["syncRoomMembership", "syncFeedGroupMembership", "evictFromCallRoom"]) {
      expect(code, `emitter thiếu method ủy quyền ${m}`).toMatch(
        new RegExp(`this\\.roomOps\\.${m}\\(`),
      );
    }
    expect(code).not.toMatch(/\.sockets(?:Join|Leave)\(/);
  });

  it("ngoài emitter, KHÔNG file nguồn nào import lớp room-op (caller đi qua cổng LÁ emitter)", () => {
    const importers = allSources()
      .filter(({ text }) => importsOf(text).some((s) => /(^|\/)realtime-room-ops$/.test(s)))
      .map(({ rel }) => rel);
    expect(importers).toEqual([`realtime/${EMITTER}`]);
  });
});
