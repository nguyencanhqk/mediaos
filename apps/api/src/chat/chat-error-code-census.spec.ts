/**
 * S7-CHAT-QA-1 — census MÃ LỖI của module CHAT (SPEC-15 §12 · §21 nhóm "Validate").
 *
 * §21 đòi: **20 mã lỗi §12, mỗi mã ≥ 1 ca**. Đòi hỏi đó chỉ có giá trị nếu có thứ gì đó ĐỎ khi ai đó
 * thêm mã lỗi thứ 21 mà quên viết ca — con người không tự đếm lại 20 dòng bảng mỗi lần sửa spec.
 *
 * ┌─ VÌ SAO FILE NÀY COLOCATED TRONG `src/`, KHÔNG PHẢI `test/integration/` ──────────────────────┐
 * │ Mọi `*.int-spec.ts` đều `describe.skipIf(!hasLaneDb)` — không có `LANE_DB` thì SKIP, và SKIP  │
 * │ không phải FAIL. Đặt tripwire chống-trôi ở đó = tripwire ngủ đúng lúc cần nhất (CI thường,    │
 * │ máy dev chạy `pnpm test` trần). Census không cần Postgres ⇒ sống ở glob colocated `src` — glob │
 * │ LUÔN chạy (memory `vitest-unit-specs-must-be-colocated` · `src-green-is-not-integration-green`).│
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ ĐÂY LÀ TRIPWIRE, KHÔNG PHẢI BẰNG CHỨNG. Census quét CHUỖI trong mã nguồn test: một mã lỗi nằm
 * trong comment cũng được tính. Nó KHÔNG chứng minh ca test đó assert đúng — việc đó là của chính ca
 * test và của bằng chứng RED-trước-GREEN (`docs/QA/evidence/S7-CHAT-QA-1-RED-before-GREEN.md`).
 * Nó chỉ chặn đúng MỘT lớp hỏng: thêm/đổi mã lỗi mà không ai ngó tới bộ test.
 * (Không có bề mặt runtime nào liệt kê được mã lỗi: chúng là chuỗi trong THÔNG ĐIỆP, không phải mã HTTP.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_ERR } from "./chat.errors";

/**
 * SPEC-15 §12 chốt ĐÚNG 25 mã sau wave S8 (`S8-CHAT-UX-DOC-1` thêm 021…025).
 * Đổi số này = đổi spec ⇒ phải sửa cả bảng §12 lẫn bộ test.
 */
const SPEC_ERROR_CODE_COUNT = 25;

const ALL_CODES: readonly string[] = Array.from(
  { length: SPEC_ERROR_CODE_COUNT },
  (_, i) => `CHAT-ERR-${String(i + 1).padStart(3, "0")}`,
);

/**
 * Mã ĐÃ CÓ TRONG SPEC nhưng CHƯA có đường code nào sinh ra — mỗi mã kèm WO đang nợ nó.
 *
 * ┌─ VÌ SAO DANH SÁCH NÀY TỒN TẠI THAY VÌ HẠ `SPEC_ERROR_CODE_COUNT` ─────────────────────────────┐
 * │ Hạ số đếm xuống "số mã đã hiện thực" là cách rẻ để test xanh, và nó **giết** vế census còn lại: │
 * │ một mã nằm trong spec mà không ai làm sẽ biến mất khỏi tầm nhìn thay vì được đếm là NỢ.         │
 * │ Danh sách tường minh giữ cả hai vế: mã chưa làm vẫn hiện diện, có tên WO, và ca "nợ đã tiêu     │
 * │ hết" dưới đây bắt buộc phải rút ngắn nó khi WO tương ứng land — quên rút = ĐỎ.                  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
const PENDING_CODES: ReadonlyMap<string, string> = new Map([
  ["CHAT-ERR-022", "S8-CHAT-UX-BE-2 (đặt avatar cho phòng direct → 422)"],
  ["CHAT-ERR-023", "S8-CHAT-UX-BE-2 (không đủ tư cách đặt avatar theo loại phòng → 403)"],
  ["CHAT-ERR-024", "S8-CHAT-UX-BE-3 (thả cảm xúc vào tin đã thu hồi → 422)"],
  ["CHAT-ERR-025", "S8-CHAT-UX-BE-3 (emoji ngoài bộ đóng → 422)"],
]);

/** Mã BẮT BUỘC đã có ca int-spec = mã trong sổ TRỪ phần đang nợ. */
const IMPLEMENTED_CODES: readonly string[] = ALL_CODES.filter((c) => !PENDING_CODES.has(c));

const INTEGRATION_DIR = join(__dirname, "..", "..", "test", "integration");

/** Mọi int-spec của module CHAT (gồm cả `s7-chat-db1-invariants` — tên không mở đầu bằng `chat-`). */
function chatSpecFiles(): { name: string; source: string }[] {
  return readdirSync(INTEGRATION_DIR)
    .filter((f) => /chat.*\.int-spec\.ts$/.test(f))
    .map((name) => ({ name, source: readFileSync(join(INTEGRATION_DIR, name), "utf8") }));
}

describe("S7-CHAT-QA-1 — census mã lỗi CHAT (SPEC-15 §12 · §21 nhóm Validate)", () => {
  const files = chatSpecFiles();

  it("bộ int-spec CHAT tồn tại (census quét vào chỗ RỖNG thì mọi assert dưới đây vô nghĩa)", () => {
    // Không có ca này thì đổi tên thư mục/quy ước file sẽ làm census trả 0 file và... vẫn xanh nếu
    // các assert dưới viết bằng `.every()` trên mảng rỗng. Chốt chặn trước.
    expect(files.length, `int-spec CHAT tìm thấy trong ${INTEGRATION_DIR}`).toBeGreaterThanOrEqual(
      13,
    );
  });

  it.each(IMPLEMENTED_CODES)("%s có ít nhất 1 ca trong bộ int-spec CHAT", (code) => {
    const hits = files.filter((f) => f.source.includes(code)).map((f) => f.name);
    expect(
      hits.length,
      `${code} (SPEC-15 §12) không xuất hiện ở int-spec CHAT nào — §21 nhóm "Validate" đòi mỗi mã ≥1 ca`,
    ).toBeGreaterThan(0);
  });

  it("KHÔNG có mã ngoài sổ: mọi CHAT-ERR-xxx dùng trong src/ đều nằm trong 20 mã của §12", () => {
    // Chiều ngược lại của census. Đẻ `CHAT-ERR-021` trong service mà quên cập nhật SPEC-15 §12 là
    // trôi tài liệu — mã lỗi lọt ra sản phẩm rồi mới có người hỏi "cái này là gì".
    const errorsSource = readFileSync(join(__dirname, "chat.errors.ts"), "utf8");
    const used = new Set(errorsSource.match(/CHAT-ERR-\d{3}/g) ?? []);
    const outOfBook = [...used].filter((c) => !ALL_CODES.includes(c)).sort();
    expect(outOfBook, "mã lỗi có trong code nhưng KHÔNG có trong bảng SPEC-15 §12").toEqual([]);
  });

  it("danh sách NỢ đúng hiện trạng: mã đã hiện thực thì PHẢI rời PENDING_CODES", () => {
    // Chiều thứ ba của census — chống chính danh sách nợ mục ruỗng. WO sau hiện thực CHAT-ERR-022 mà
    // quên gỡ nó khỏi `PENDING_CODES` sẽ làm mã đó VĨNH VIỄN không bị đòi ca int-spec: nợ được xoá
    // trong im lặng thay vì được trả. Ca này bắt đúng lúc đó.
    const errorsSource = readFileSync(join(__dirname, "chat.errors.ts"), "utf8");
    const used = new Set(errorsSource.match(/CHAT-ERR-\d{3}/g) ?? []);
    const paidButStillListed = [...PENDING_CODES.keys()].filter((c) => used.has(c)).sort();
    expect(
      paidButStillListed,
      "mã đã có đường code sinh ra nhưng vẫn nằm trong PENDING_CODES — gỡ nó ra để census đòi ca int-spec",
    ).toEqual([]);
  });

  /**
   * Hằng CHẾT = luật viết trong sổ nhưng không đường nào ném ra. Nguy hiểm vì đọc code thấy "đã xử
   * lý", còn hành vi thật do chỗ khác quyết (memory `ui-promises-backend-never-reads`).
   *
   * ⚠️ HAI hằng ĐANG chết, và cả hai đều là chết-LÀNH — luật vẫn được ép, chỉ là ép ở tầng khác:
   *   • `BODY_INVALID` (CHAT-ERR-004) — Zod `body: z.string().min(1).max(4000)` chặn ở biên HTTP.
   *   • `EDIT_UNSUPPORTED` (CHAT-ERR-007) — ép bằng SỰ VẮNG MẶT: 0 route @Patch/@Put trên tin nhắn,
   *     cộng column-GRANT ở tầng DB (`chat-be2-messages` ca 21 + `s7-chat-db1-invariants` khối A).
   *     Không có nhánh nào để ném hằng này, và đó là thiết kế ĐÚNG.
   * WO QA KHÔNG sửa production code ⇒ ghim hiện trạng bằng allowlist tường minh: hằng chết THỨ BA
   * sẽ làm ca này ĐỎ. Xem `docs/QA/evidence/S7-CHAT-QA-1-TRACEABILITY.md` §Phát hiện.
   */
  it("hằng mã lỗi chết được KIỂM SOÁT (allowlist tường minh, không im lặng)", () => {
    const srcDir = __dirname;
    const callerSources = readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts") && f !== "chat.errors.ts" && !f.endsWith(".spec.ts"))
      .map((f) => readFileSync(join(srcDir, f), "utf8"))
      .join("\n");

    const KNOWN_DEAD = ["BODY_INVALID", "EDIT_UNSUPPORTED"] as const;
    const dead = Object.keys(CHAT_ERR).filter((k) => !callerSources.includes(`CHAT_ERR.${k}`));

    expect(
      dead.slice().sort(),
      "hằng CHAT_ERR không có caller nào trong src/chat — thêm mới thì phải nối đường ném, hoặc gỡ hằng",
    ).toEqual([...KNOWN_DEAD].slice().sort());
  });
});
