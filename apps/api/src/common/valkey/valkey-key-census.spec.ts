import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S10-FND-VALKEYSCOPE-1 — CENSUS TĨNH: không được dựng khoá Valkey tại chỗ.
 *
 * Vì sao cần cả cổng runtime LẪN census tĩnh: cổng runtime chỉ thấy đường code THỰC SỰ CHẠY trong test
 * (và `VALKEY_URL` thường vắng ⇒ nhiều consumer thoát sớm ở `isEnabled()`); census tĩnh thấy MỌI literal,
 * kể cả nhánh chưa có test. Ngược lại census tĩnh mù với khoá ghép động — nên hai cơ chế bù cho nhau,
 * KHÔNG thay thế nhau, và mỗi cái được đo bằng một ca riêng.
 */

/**
 * Định vị `apps/api` từ cwd — KHÔNG dùng `import.meta.url` (tsconfig của api là `module: CommonJS`, tsc
 * từ chối) và KHÔNG giả định cwd. Không tìm thấy thì NÉM: một bộ quét im lặng trỏ vào thư mục rỗng sẽ
 * XANH mãi mãi, đúng chế độ hỏng mà file này sinh ra để chặn.
 */
function apiDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "src", "common", "valkey"))) return dir;
    if (existsSync(join(dir, "apps", "api", "src", "common", "valkey"))) {
      return join(dir, "apps", "api");
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`census: không định vị được apps/api từ cwd=${process.cwd()}`);
}

const API_DIR = apiDir();
const SRC_DIR = join(API_DIR, "src");
const TEST_DIR = join(API_DIR, "test");

/**
 * Tiền tố khoá Valkey đang dùng. NEO Ở ĐẦU literal (ngay sau dấu mở chuỗi) — không quét chuỗi tự do giữa
 * câu, vì `chat:typing`/`chat:message`/… CÒN LÀ TÊN SỰ KIỆN socket.io nằm rải khắp realtime-emitter,
 * gateway và spec. Quét thô sẽ đỏ oan hàng loạt rồi bị nới tới mức vô nghĩa.
 */
const KEY_PREFIXES = [
  "rl:",
  "perm:cap:",
  "perm:obj:",
  "idem:",
  "replay:",
  "chat:typing:",
  "chat:cooldown:",
  "chat:ice-turn-reject:",
  "chat:presence:",
  "me:training:",
  "socket.io:",
];

const LITERAL_AT_START = new RegExp(
  `["'\`](?:${KEY_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "g",
);

/**
 * Miễn trừ — file + LÝ DO. Danh sách này là hợp đồng: thêm một dòng ở đây phải do người chốt vùng đỏ
 * duyệt, KHÔNG phải cách sửa đỏ nhanh.
 */
const ALLOWLIST: Record<string, string> = {
  "common/valkey/valkey-key.ts": "CHỖ DỰNG KHOÁ DUY NHẤT — chính là nơi các literal này phải sống",
  "common/valkey/valkey-key.spec.ts": "spec của chính chỗ dựng khoá",
  "common/valkey/valkey-key-census.spec.ts": "file này — chứa bảng tiền tố để quét",
  "realtime/ws-adapter-config.ts":
    "`socket.io:{envScope}` — kênh adapter, ĐÃ scoped từ S8-CHAT-UX-RT-1",
  "realtime/chat-presence-reader.service.ts":
    "`chat:presence:{envScope}:…` — khoá HỢP LỆ, đã scoped sẵn; đọc chéo module nên không đi qua builder",
  // Bốn spec dưới KHẲNG ĐỊNH trên hai không gian khoá ĐÃ scoped từ S8-CHAT-UX-RT-1 (`socket.io:{envScope}`
  // + `chat:presence:{envScope}`). Chúng là bằng chứng của phép suy đó, không phải chỗ dựng khoá mới —
  // bắt chúng đi qua builder sẽ làm assert tự tham chiếu (so hàm với chính nó = tautology).
  "realtime/ws-adapter-config.spec.ts": "spec của resolveEnvScope/resolveValkeyChannelKey (S8)",
  "realtime/valkey-io.adapter.spec.ts": "assert adapter nhận đúng kênh đã scoped (S8)",
  "realtime/setup-websocket-adapter.spec.ts": "assert bootstrap truyền đúng kênh đã scoped (S8)",
  "realtime/chat-presence.service.spec.ts": "assert khoá presence đã scoped (S8)",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // thư mục không tồn tại (vd test/ trong bản cắt gọn) — không phải lỗi
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Bóc comment TRƯỚC khi khớp. Bắt buộc: docblock của `login-rate-limiter.ts`, `permission.cache.ts`,
 * `forgot-password-rate-limit.spec.ts`… mô tả hình dạng khoá bằng backtick TRONG văn xuôi, khớp y hệt
 * literal thật (cùng lớp gitleaks-prose-colon-false-positive). Không bóc thì census đỏ oan ~6 chỗ ngay
 * vòng đầu và áp lực sẽ đẩy người sửa đi nới regex.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function violationsIn(source: string): string[] {
  return [...stripComments(source).matchAll(LITERAL_AT_START)].map((m) => m[0]);
}

function scan(): Array<{ file: string; hits: string[] }> {
  const found: Array<{ file: string; hits: string[] }> = [];
  for (const full of [...walk(SRC_DIR), ...walk(TEST_DIR)]) {
    const rel = relative(SRC_DIR, full).replace(/\\/g, "/");
    if (ALLOWLIST[rel]) continue;
    const hits = violationsIn(readFileSync(full, "utf8"));
    if (hits.length > 0) found.push({ file: rel, hits });
  }
  return found;
}

describe("census: 0 literal khoá Valkey dựng tại chỗ", () => {
  it("không file nào ngoài allowlist chứa literal mở đầu bằng tiền tố khoá", () => {
    const found = scan();
    // Thông điệp đỏ phải nói được PHẢI LÀM GÌ, không chỉ "có vi phạm".
    expect(
      found,
      `Dựng khoá qua apps/api/src/common/valkey/valkey-key.ts. Nếu thật sự là ngoại lệ, thêm file + LÝ DO vào ALLOWLIST (cần người chốt vùng đỏ duyệt).`,
    ).toEqual([]);
  });

  /**
   * ĐO CỔNG BẰNG VI PHẠM THẬT — không tin một PASS rỗng. Nếu bộ dò hỏng (regex sai, bóc comment quá tay,
   * walk không thấy file) thì ca trên vẫn XANH mãi mãi; ba ca dưới bắt đúng chuyện đó.
   */
  it("phát hiện được một vi phạm cố ý", () => {
    expect(violationsIn("const k = `rl:ip:${slug}|${email}`;")).toHaveLength(1);
    expect(violationsIn('const k = "perm:cap:" + companyId;')).toHaveLength(1);
    expect(violationsIn("const k = 'idem:' + hash;")).toHaveLength(1);
  });

  it("KHÔNG khớp văn xuôi trong comment (nguồn đỏ-oan đã đo thật)", () => {
    expect(violationsIn("// bucket `rl:forgot:*` tách hẳn khỏi `rl:ip:`")).toEqual([]);
    expect(violationsIn("/** perm:cap:{companyId}:{userId} → CompanyRoleGrant[] */")).toEqual([]);
  });

  it("KHÔNG khớp tên SỰ KIỆN socket.io (không phải khoá Valkey)", () => {
    // `chat:message`/`chat:read`/`chat:call:*` là tên sự kiện — có mặt hợp lệ ở emitter/gateway/spec.
    expect(violationsIn(`emit("chat:message", payload); emit("chat:read", p);`)).toEqual([]);
  });

  it("bộ quét thật sự đọc được file (chống walk rỗng ⇒ xanh oan)", () => {
    expect(walk(SRC_DIR).length).toBeGreaterThan(100);
  });
});
