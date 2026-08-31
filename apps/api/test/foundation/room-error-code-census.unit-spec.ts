/**
 * S11-ROOM-QA-1 — CENSUS "mã lỗi / `kind` ROOM được NÉM mà KHÔNG có ca test nào" (SPEC-14 §21 hàng
 * "Validate: **10** mã lỗi §12, mỗi `kind` ≥ 1 ca").
 *
 * VÌ SAO CẦN CỔNG TĨNH CHỨ KHÔNG CHỈ ĐẾM COVERAGE — và vì sao ROOM cần nó ở mức `kind`, không chỉ mức
 * mã. Coverage dòng của `src/rooms/**` đã cao ngay sau `S11-ROOM-BE-1`, nhưng §21 hỏi một câu khác:
 * *"mỗi kind có ca chưa"*. ROOM gộp rất nhiều luật vào chung một mã — ROOM-ERR-002 có **6** `kind`,
 * ROOM-ERR-006 có **4**, ROOM-ERR-004/005/010 mỗi mã **2** — nên "mã ROOM-ERR-002 đã có ca" hoàn toàn
 * có thể đúng trong khi 3 trong 6 nhánh của nó chưa ai chạm. Đo 30/08/2026: đúng 4 `kind` ở tình
 * trạng đó (`too-many-attendees` · `organizer-not-found` · `organizer-inactive` và nửa `to ≤ from`
 * của `range-too-wide`). Census theo **MÃ** sẽ mù với cả bốn (bài học
 * `coverage-high-but-error-code-untested`, mức tiếp theo của nó).
 *
 * LUẬT ĐANG ĐO:
 *   (1) mã trong `ROOM_ERR_CODE` ĐƯỢC NÉM ở `src/rooms/**` ⇒ PHẢI xuất hiện trong ít nhất một assert
 *       của bề mặt test ROOM (int-spec `test/integration/*room*` ∪ unit spec colocated
 *       `src/rooms/*.spec.ts`);
 *   (2) mỗi `kind` ném được (keys của `ROOM_ERR.WINDOW`/`ROOM_ERR.ATTENDEE` ∪ literal trong
 *       `roomDetails("…")` ∪ `"overlap"`) cũng phải có ca — trừ nhóm `BOUNDARY_ONLY`;
 *   (3) `BOUNDARY_ONLY` = `kind` mà đường HTTP KHÔNG chạm tới được vì Zod đã cắt ở biên với ĐÚNG cùng
 *       ngưỡng. Hôm nay đúng một mục: `too-many-attendees` (`attendeeUserIds.max(50)` ở contracts vs
 *       `attendees.length > 50` ở service). Với nhóm này, census đảo chiều assert: phải CÓ ca biên
 *       400 `VALIDATION-ERR-001`. Nếu một ngày nhánh service chạm được thật, ca ở
 *       `s11-room-qa1-error-residue` mục B sẽ ĐỎ và bắt bổ sung ca runtime — đúng thứ tự, không im lặng.
 *
 * LỚP BẰNG CHỨNG: đây là quét TĨNH trên chuỗi ⇒ nó KHÔNG chứng minh ca test là ca ĐÚNG, chỉ chứng minh
 * "có ai đó neo mã/kind này". Bằng chứng mạnh nằm ở int-spec chạy đường HTTP thật. Vai của census là
 * chặn `kind` THỨ HAI MƯƠI HAI mọc lên mà không ai đo (khuôn `route-census-runtime-gate` ·
 * `asset-error-code-census`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOM_ERR, ROOM_ERR_CODE } from "../../src/rooms/rooms.errors";

const ROOMS_SRC = path.join(__dirname, "..", "..", "src", "rooms");
const INTEGRATION = path.join(__dirname, "..", "integration");

/**
 * Bỏ comment TRƯỚC khi quét. Không bỏ thì một dòng docblock nhắc tên mã cũng "đủ tư cách" làm bằng
 * chứng — đúng cái bẫy `vitest-exclude-selfcheck-reads-comments` đã vấp ở cổng khác.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dir: string, match: (name: string) => boolean): string =>
  fs
    .readdirSync(dir)
    .filter(match)
    .map((n) => stripComments(fs.readFileSync(path.join(dir, n), "utf8")))
    .join("\n");

/** `kind` chặn ở BIÊN Zod ⇒ đường HTTP trả 400, KHÔNG bao giờ trả mã ROOM tương ứng (SPEC-14 §12 đính chính). */
const BOUNDARY_ONLY = ["too-many-attendees"] as const;

describe("S11-ROOM-QA-1 census — mọi mã lỗi & kind ROOM được ném đều có ca test", () => {
  // Nguồn NÉM: chỉ file thi công, KHÔNG lấy `*.spec.ts` colocated (spec nhắc mã là "ca test", không
  // phải "chỗ ném") — trộn hai vai vào nhau là census tự chứng minh chính nó.
  const implSrc = readAll(
    ROOMS_SRC,
    (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts") && n !== "rooms.errors.ts",
  );
  // `rooms.errors.ts` vừa ĐỊNH NGHĨA vừa NÉM thật (mapper `mapRoomPgError`, `bookOnBehalfDenied`…), nên
  // tính vào nguồn ném NHƯNG phải bỏ hai khối khai báo hằng (mọi mã/kind đều xuất hiện ở đó).
  const errorsFile = stripComments(fs.readFileSync(path.join(ROOMS_SRC, "rooms.errors.ts"), "utf8"))
    .replace(/export const ROOM_ERR_CODE = \{[\s\S]*?\} as const;/, "")
    .replace(/export const ROOM_ERR = \{[\s\S]*?\n\} as const;/, "");

  const thrownSrc = `${implSrc}\n${errorsFile}`;
  const testSurface = [
    readAll(ROOMS_SRC, (n) => n.endsWith(".spec.ts")),
    readAll(
      INTEGRATION,
      (n) =>
        /room/i.test(n) &&
        !/chat/i.test(n) && // `chat-*-rooms` là phòng CHAT, không phải module ROOM
        (n.endsWith(".int-spec.ts") || n.endsWith(".unit-spec.ts")),
    ),
  ].join("\n");

  const isThrown = (constName: string): boolean =>
    new RegExp(`ROOM_ERR_CODE\\.${constName}\\b`).test(thrownSrc);

  const codeEntries = Object.entries(ROOM_ERR_CODE) as Array<[string, string]>;

  it.each(codeEntries)(
    "mã %s (%s): được ném ở src ⇒ có ít nhất một ca test neo mã",
    (name, code) => {
      expect(
        isThrown(name),
        `${name} không còn được ném ở src/rooms — gỡ hằng hoặc gỡ khỏi census`,
      ).toBe(true);
      expect(
        testSurface.includes(code),
        `mã ${code} (${name}) được ném nhưng KHÔNG spec nào của ROOM assert nó`,
      ).toBe(true);
    },
  );

  /**
   * Tập `kind` ném được, gom từ BA nguồn để không sót nhánh nào:
   *   · keys `ROOM_ERR.WINDOW` (6) — đi qua `windowError(kind)`
   *   · keys `ROOM_ERR.ATTENDEE` (4) — đi qua `attendeeError(kind)`
   *   · literal `roomDetails("…")` ở src (organizer/room/cancel/capacity/name/upcoming/on-behalf)
   *   · `"overlap"` — ROOM-ERR-001 dựng `details` inline, không qua `roomDetails`
   */
  const kinds = (): string[] => {
    const out = new Set<string>([
      ...Object.keys(ROOM_ERR.WINDOW),
      ...Object.keys(ROOM_ERR.ATTENDEE),
      "overlap",
    ]);
    for (const m of thrownSrc.matchAll(/roomDetails\(\s*"([a-z-]+)"/g)) out.add(m[1]);
    return [...out].sort();
  };

  it.each(kinds().filter((k) => !BOUNDARY_ONLY.includes(k as never)))(
    "kind `%s`: ném được ở src ⇒ có ít nhất một ca test neo kind",
    (kind) => {
      expect(
        testSurface.includes(`"${kind}"`),
        `kind ${kind} ném được nhưng KHÔNG spec nào của ROOM assert nó`,
      ).toBe(true);
    },
  );

  it.each(BOUNDARY_ONLY)(
    "kind `%s`: chặn ở BIÊN Zod ⇒ ca phải neo 400 VALIDATION-ERR-001, không phải mã ROOM",
    (kind) => {
      // Vế 1: vẫn còn nhánh ở src (tầng hai cho caller không qua pipe) — nếu bị gỡ thì gỡ luôn khỏi đây.
      expect(
        thrownSrc.includes(kind),
        `${kind} không còn ở src/rooms — gỡ khỏi BOUNDARY_ONLY hoặc khôi phục tầng hai`,
      ).toBe(true);
      // Vế 2: đường THẬT phải có ca ở biên 400 (nếu không, luật này không được ai canh).
      expect(
        testSurface.includes("VALIDATION-ERR-001"),
        `không còn ca biên 400 nào cho ROOM — ${kind} mất bằng chứng`,
      ).toBe(true);
    },
  );

  it("census tự-kiểm: bề mặt test đọc được và KHÔNG rỗng", () => {
    // Không có vế này thì mọi ca trên xanh-rỗng khi đường dẫn đổi (đọc trúng thư mục trống).
    expect(thrownSrc.length).toBeGreaterThan(5_000);
    expect(testSurface.length).toBeGreaterThan(20_000);
    // 9 mã số §12 dùng hằng riêng (003 dùng sentinel NOT-FOUND) + sentinel NOT_FOUND = 10.
    expect(codeEntries.length).toBe(10);
    // 6 WINDOW + 4 ATTENDEE + overlap + 10 literal roomDetails = 21 kind ném được.
    expect(kinds().length).toBe(21);
  });
});
