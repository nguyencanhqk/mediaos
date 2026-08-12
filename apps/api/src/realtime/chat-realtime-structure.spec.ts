import "reflect-metadata";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_CALL_INBOUND_EVENTS } from "@mediaos/contracts";
import { CallSignallingGateway } from "./call-signalling.gateway";

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

/**
 * ⚠️ **DANH SÁCH MIỄN TRỪ — ĐÚNG MỘT PHẦN TỬ.**
 *
 * `S7-CALL-RT-1` nới `CHAT-DEC-005` thành `CHAT-DEC-020` (owner ký `DECISIONS-07` 08/08/2026): tín hiệu
 * SDP/ICE được đi client→server, nhưng **CHỈ** trên namespace RIÊNG `/ws-call` (hàng rào R1). SPEC-15
 * §3.5 ra lệnh trước cho chính file này: *"wave CALL nới phạm vi quét thì vế `/ws` vẫn phải còn khẳng
 * định riêng giữ mức 0"*.
 *
 * Thêm phần tử thứ hai vào đây là **nới bất biến**, không phải sửa test — nó phải đi kèm một ADR có chữ
 * ký owner. Ca `EXEMPT` bên dưới ép việc đó thành một dòng nhìn thấy được trong diff.
 */
const SUBSCRIBE_EXEMPT: readonly string[] = ["realtime/call-signalling.gateway.ts"];

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

describe("CHAT-DEC-005/020 — WS một chiều, ngoại lệ ĐÓNG ở `/ws-call`", () => {
  it("EXEMPT đúng MỘT phần tử — nới thêm phải là quyết định nhìn thấy được", () => {
    expect(SUBSCRIBE_EXEMPT).toEqual(["realtime/call-signalling.gateway.ts"]);
  });

  it("`/ws` (realtime.gateway.ts) VẪN 0 `@SubscribeMessage`", () => {
    // Khẳng định RIÊNG cho `/ws`, KHÔNG đi qua allowlist: gateway CHAT+NOTI là thứ `CHAT-DEC-005` bảo
    // vệ, và `DECISIONS-07` R1 nới một namespace KHÁC chứ không nới file này. Ai thêm handler vào đây
    // phải làm đỏ một ca gọi đúng tên file mình vừa sửa.
    const gateway = stripComments(readFileSync(join(REALTIME_DIR, "realtime.gateway.ts"), "utf8"));
    expect(gateway).not.toContain("@SubscribeMessage");
  });

  it("0 `@SubscribeMessage` trong toàn bộ apps/api/src — TRỪ đúng file miễn trừ", () => {
    // Không giới hạn ở realtime/**: thêm handler client→server ở BẤT KỲ gateway nào cũng mở lại bề mặt
    // mà CHAT-DEC-005 đã đóng.
    const offenders = allSources()
      .filter(
        ({ rel, text }) => text.includes("@SubscribeMessage") && !SUBSCRIBE_EXEMPT.includes(rel),
      )
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("MỌI gateway đọc handshake CHỈ để rút token — không nhận roomId/callId từ client", () => {
    // Quét TRUY CẬP THUỘC TÍNH `.handshake…` (không phải chữ "handshake" trong chuỗi log). Mỗi lần đọc
    // dữ liệu do client kiểm soát PHẢI là `.handshake.auth` hoặc `.handshake.headers` — hai lối rút
    // TOKEN. Bất cứ khoá nào khác (roomId, rooms, companyId…) là để client tự khai mình ở đâu.
    //
    // ⚠️ Quét CẢ HAI gateway: `/ws-call` có bản rút token riêng (CỐ Ý không refactor thành helper dùng
    // chung — rút hàm ra file khác làm positive control `accesses.length > 0` của ca này RỖNG, tức
    // ratchet chết im lặng). Bản sao được gác bởi cùng một luật không phải bản sao sẽ trôi.
    for (const file of ["realtime.gateway.ts", "call-signalling.gateway.ts"]) {
      const src = stripComments(readFileSync(join(REALTIME_DIR, file), "utf8"));
      const accesses = [...src.matchAll(/\.handshake\s*\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
      expect(
        accesses.length,
        `${file}: positive control — phải có đọc handshake thật`,
      ).toBeGreaterThan(0);
      for (const key of accesses) {
        expect(["auth", "headers"], `${file} đọc handshake.${key}`).toContain(key);
      }
    }

    // Danh sách phòng phải tới TỪ REPO, không từ socket.
    expect(stripComments(readFileSync(join(REALTIME_DIR, "realtime.gateway.ts"), "utf8"))).toMatch(
      /listRoomsForUser\(/,
    );
  });
});

describe("DECISIONS-07 R2 — allowlist inbound `/ws-call` ĐÓNG đúng 8", () => {
  /**
   * Census **RUNTIME**, không grep chuỗi: đọc metadata mà `@SubscribeMessage` ghi lên chính hàm
   * (`websockets:message_mapping` + `message` — `@nestjs/websockets/decorators/subscribe-message.decorator.js`).
   *
   * Grep là tripwire, metadata là BẰNG CHỨNG (memory `route-census-runtime-gate`): một handler khai bằng
   * `Reflect.defineMetadata` tay, hoặc một decorator bọc lại, đều vô hình với grep nhưng hiện ở đây.
   *
   * ⚠️ Đọc trên `prototype`, **KHÔNG instantiate** — `loadEnv()` của gateway nằm ở field initializer nên
   * chỉ chạy khi `new`. Nhờ vậy ca này sống ở glob `src` (LUÔN chạy) thay vì rơi xuống int-spec, nơi
   * `skipIf(!LANE_DB)` sẽ cho nó ngủ đúng lúc cần nhất.
   */
  function subscribedEvents(): string[] {
    const proto = CallSignallingGateway.prototype as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .map((name) => proto[name])
      .filter((v): v is (...a: unknown[]) => unknown => typeof v === "function")
      .filter((fn) => Reflect.getMetadata("websockets:message_mapping", fn) === true)
      .map((fn) => Reflect.getMetadata("message", fn) as string);
  }

  it("ĐÚNG 8 handler, và tập tên BẰNG ĐÚNG `CHAT_CALL_INBOUND_EVENTS`", () => {
    const events = subscribedEvents();
    expect(events).toHaveLength(CHAT_CALL_INBOUND_EVENTS.length);
    expect([...events].sort()).toEqual([...CHAT_CALL_INBOUND_EVENTS].sort());
  });

  it("KHÔNG có listener inbound gắn TAY ở bất kỳ đâu ngoài `onAny` của gateway", () => {
    // ⚠️ Census `@SubscribeMessage` MÙ với `socket.on('call:evil', …)` / `nsp.on('connection', s => s.on(…))`.
    // Trước RT-1 viết listener tay là bất thường; TỪ RT-1 (`onAny`) nó là chuyện bình thường ⇒ thiếu ca
    // này là có đường vòng qua cả ba khẳng định ở trên — đúng kiểu "thêm một handler nhỏ" mà R2 sinh ra
    // để chặn.
    //
    // `server.use(...)` (middleware NAMESPACE) KHÔNG bị cấm: đó là cổng auth ở handshake của cả hai
    // gateway. `socket.use(...)` (middleware GÓI TIN) thì CẤM — `next(err)` của nó đi qua `_onerror` →
    // `emitReserved('error')`, mà Socket không có listener 'error' ⇒ EventEmitter ném ⇒ SẬP TIẾN TRÌNH.
    const BIND =
      /\b(?:client|socket|server|nsp|namespace|io)\s*\.\s*(?:on|once|onAny|prependAny|prependAnyOutgoing|onAnyOutgoing)\s*\(/g;
    const PACKET_MW = /\b(?:client|socket)\s*\.\s*use\s*\(/g;

    // Chỉ quét file THẬT SỰ chạm Socket.IO. Không phải để nới: một listener socket không thể tồn tại ở
    // file không có đối tượng socket nào. Nếu không lọc, `valkey.service.ts` (`client.on("error")` của
    // **ioredis**) đỏ oan — và một ratchet đỏ oan là ratchet sẽ bị ai đó tắt.
    const touchesSocketIo = ({ text }: { text: string }): boolean =>
      /from\s+["'](?:socket\.io|@nestjs\/websockets)["']/.test(text);

    const scanned = allSources().filter(touchesSocketIo);
    expect(scanned.length, "positive control: có file chạm Socket.IO để quét").toBeGreaterThan(0);

    for (const { rel, text } of scanned) {
      const binds = [...text.matchAll(BIND)].map((m) => m[0]);
      const packetMw = [...text.matchAll(PACKET_MW)].map((m) => m[0]);
      if (SUBSCRIBE_EXEMPT.includes(rel)) {
        // Gateway `/ws-call`: ĐÚNG 1 `onAny(` (cưỡng chế allowlist) và không gì khác.
        expect(binds, `${rel}: chỉ được có đúng 1 onAny`).toHaveLength(1);
        expect(binds[0], `${rel}: bind sai loại`).toMatch(/onAny\s*\($/);
        expect(packetMw, `${rel}: socket.use() làm sập tiến trình khi next(err)`).toEqual([]);
      } else {
        expect(binds, `${rel}: bind listener inbound ngoài allowlist`).toEqual([]);
        expect(packetMw, `${rel}: socket.use() bị cấm`).toEqual([]);
      }
    }
  });

  it("R4 — gateway KHÔNG có đường ghi DB nào ngoài writer hẹp (cấu trúc, không phải lời hứa)", () => {
    // ⚠️ Bản đầu của WO tiêm `DatabaseService` vào gateway để ghi `user_security_events`. Nó chạy đúng,
    // nhưng `db.withTenant` cấp quyền ghi **MỌI bảng** — kể cả `chat_calls`. Khi đó hàng rào R4 ("vòng
    // đời cuộc gọi chỉ đi REST, qua PermissionGuard + audit") chỉ còn được giữ bởi một dòng docblock, và
    // một `tx.insert(chatCalls)` viết thêm vào file này sẽ không làm gì đỏ. FULL gate chỉ ra đúng điểm
    // đó: WO tốn công KHÔNG export `ChatCallsRepository` rồi mở một cửa rộng hơn ngay bên cạnh.
    const gateway = stripComments(
      readFileSync(join(REALTIME_DIR, "call-signalling.gateway.ts"), "utf8"),
    );
    expect(gateway, "gateway không được mở transaction").not.toMatch(/withTenant\s*\(/);
    expect(gateway, "gateway không được cầm DatabaseService").not.toMatch(/DatabaseService/);
    expect(gateway, "gateway không được cầm writer chung của security-event").not.toMatch(
      /SecurityEventWriter/,
    );

    // Positive control: đường ghi DUY NHẤT vẫn còn (nếu ai gỡ hẳn, ba khẳng định trên xanh RỖNG).
    expect(gateway).toMatch(/this\.violations\.record\(/);
    const writer = stripComments(
      readFileSync(join(REALTIME_DIR, "call-signalling-violation.writer.ts"), "utf8"),
    );
    expect(writer.match(/withTenant\s*\(/g) ?? [], "writer chỉ có ĐÚNG 1 transaction").toHaveLength(
      1,
    );
    expect(writer, "writer chỉ ghi user_security_events").not.toMatch(/chatCalls|chat_calls/);
  });

  it("gateway phát ra CHỈ qua MỘT chỗ `.emit(` — masking là cấu trúc, không phải kỷ luật", () => {
    // Relay là đường emit DUY NHẤT của hệ KHÔNG đi qua `RealtimeEmitterService` (cổng `.parse()` hiện
    // có). Ép cả 7 sự kiện ra chung một helper làm "quên parse" thành chuyện không thể xảy ra ở call
    // site — thay vì một luật mà ai cũng phải nhớ.
    const gateway = stripComments(
      readFileSync(join(REALTIME_DIR, "call-signalling.gateway.ts"), "utf8"),
    );
    const emits = [...gateway.matchAll(/\.emit\s*\(/g)];
    expect(emits, "đúng 1 call site `.emit(` trong gateway").toHaveLength(1);
    expect(gateway, "call site đó phải parse trước khi phát").toMatch(/\.parse\(/);
  });

  /**
   * 🔴 S7-CALL-RT-FIX-2 — ca TRÊN đếm `.emit(` **chỉ trong file gateway**, nên nó vẫn XANH sau khi
   * `RealtimeEmitterService` trở thành người phát THỨ HAI vào namespace `/ws-call`. Ratchet xanh + lời
   * hứa "đúng một call site trong toàn namespace" = một lời hứa không còn ai canh.
   *
   * Ca này phủ nốt: mọi `.emit(` trên `this.callServer` phải `.parse()` **ngay tại call site**. Đó là
   * cùng một hợp đồng mà helper `relay` của gateway đang giữ — masking là cấu trúc, không phải kỷ luật.
   */
  it("người phát THỨ HAI vào /ws-call (`RealtimeEmitterService`) cũng `.parse()` tại call site", () => {
    const emitter = stripComments(
      readFileSync(join(REALTIME_DIR, "realtime-emitter.service.ts"), "utf8"),
    );

    // Mọi câu lệnh chạm `callServer` rồi `.emit(` — tách theo `;` để mỗi call site là một chuỗi riêng.
    const callServerEmits = emitter
      .split(";")
      .filter((stmt) => /this\.callServer/.test(stmt) && /\.emit\s*\(/.test(stmt));

    // Positive control: nếu ai xoá hẳn `emitCallPeerLeft`, khẳng định dưới sẽ xanh RỖNG.
    expect(callServerEmits, "phải CÓ ít nhất một call site phát vào /ws-call").not.toHaveLength(0);
    for (const stmt of callServerEmits) {
      expect(stmt, `call site /ws-call thiếu .parse(): ${stmt.trim().slice(0, 120)}`).toMatch(
        /\.parse\(/,
      );
    }
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
