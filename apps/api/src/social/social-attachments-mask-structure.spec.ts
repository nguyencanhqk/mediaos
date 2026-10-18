import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-ATTMETAMASK-1 — ràng buộc CẤU TRÚC của luật che metadata đính kèm (plan §3 bất biến 1–3,
 * §6 S-1, mutant ★6/★8). Khuôn đọc nguồn: `social-reports-mask-structure.spec.ts`.
 *
 * Int-spec đo hành vi HTTP/WS trên các fixture đã gieo; một nơi dựng `FeedAttachmentDto` THỨ HAI (hay
 * một `attachments.map(...)` tự dựng trên đường WS) cho cùng kết quả ở mọi fixture hiện có nên không ca
 * nào bắt được — nhưng nó là nguồn luật thứ hai, sẽ trôi khi một bên được sửa. Luật:
 *   (a) tên/cỡ tệp chỉ vào DTO qua `toFeedAttachmentDto` (một vị từ `url === null`);
 *   (b) `decorateMany` dựng phần tử bằng chính hàm đó;
 *   (c) cột tên/cỡ của `files` không được đọc ở tệp SOCIAL nào khác (không đường đọc thứ hai);
 *   (d) hai đường WS (bài · bình luận) dùng chung `wsAttachmentsOf`, không tự `map`.
 */

const SOCIAL_DIR = __dirname;
const SERVICE_FILE = join(SOCIAL_DIR, "social-attachments.service.ts");

/** Bỏ comment, GIỮ dấu xuống dòng — luật nói về CODE, không về docblock giải thích luật. */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const source = (file: string): string => stripComments(readFileSync(file, "utf8"));

/** Đoạn từ ký tự `open` (một `{` hoặc `(`) tới ký tự đóng khớp cặp, gồm cả hai đầu. */
function balanced(text: string, open: number): string {
  const [o, c] = text[open] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === o) depth += 1;
    else if (text[i] === c) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`không khớp cặp ${o}${c} từ vị trí ${open}`);
}

/** Thân hàm/method có chữ ký bắt đầu bằng `signature` — từ `{` đầu tiên sau `)` của danh sách tham số. */
function bodyOf(text: string, signature: string): string {
  const sig = text.indexOf(signature);
  expect(sig, `không tìm thấy \`${signature}\` — đổi tên thì cập nhật spec này`).toBeGreaterThan(
    -1,
  );
  return balanced(text, text.indexOf("{", text.indexOf(")", sig)));
}

describe("S16-SOCIAL-ATTMETAMASK-1 — một nơi dựng đính kèm REST, một helper đính kèm WS", () => {
  it("S-1a: ngoài `toFeedAttachmentDto`, service không gán `sizeBytes:`; `fileName:` chỉ còn ở lời gọi ký (Content-Disposition)", () => {
    const text = source(SERVICE_FILE);
    const dtoBody = bodyOf(text, "export function toFeedAttachmentDto(");
    expect(dtoBody, "neo: hàm dựng có gán tên").toMatch(/\bfileName\s*:/);
    expect(dtoBody, "neo: hàm dựng có gán cỡ").toMatch(/\bsizeBytes\s*:/);

    const sign = text.indexOf("this.storage.get(");
    expect(sign, "neo: lời gọi ký trong signOne").toBeGreaterThan(-1);
    const signArgs = balanced(text, text.indexOf("(", sign));
    const rest = text.replace(dtoBody, "").replace(signArgs, "");
    expect(rest, "nơi dựng thứ hai gán `sizeBytes:`").not.toMatch(/\bsizeBytes\s*:/);
    expect(rest, "nơi dựng thứ hai gán `fileName:`").not.toMatch(/\bfileName\s*:/);
  });

  it("S-1b: `decorateMany` dựng phần tử qua `toFeedAttachmentDto`, không tự ghép tên/cỡ", () => {
    const body = bodyOf(source(SERVICE_FILE), "async decorateMany(");
    expect(body).toMatch(/\btoFeedAttachmentDto\s*\(/);
    expect(body).not.toMatch(/\bfileName\s*:/);
    expect(body).not.toMatch(/\bsizeBytes\s*:/);
  });

  it("S-1c: cột tên/cỡ của `files` chỉ được đọc trong `social-attachments.service.ts` (không đường đọc thứ hai)", () => {
    const files = readdirSync(SOCIAL_DIR).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && !f.endsWith(".d.ts"),
    );
    expect(files.length, "neo: thư mục có mã").toBeGreaterThan(10);
    const readers = files.filter((f) =>
      // ĐỌC cột của bảng `files` (drizzle `files.<cột>` hoặc SQL thô) — không phải chữ `originalName` bất
      // kỳ: cửa tải lên own-scope (`social-files.service.ts`) chuyển `input.originalName` của chính người
      // tải vào đường GHI, không đọc tên tệp của ai.
      /\bfiles\.(originalName|fileSizeBytes)\b|\b(original_name|file_size_bytes)\b/.test(
        source(join(SOCIAL_DIR, f)),
      ),
    );
    expect(readers).toEqual(["social-attachments.service.ts"]);
  });

  it.each(["social-ws-payload.ts", "social-comments.service.ts"])(
    "S-1d: `%s` dựng đính kèm WS qua `wsAttachmentsOf`, không tự `attachments.map(`",
    (file) => {
      const text = source(join(SOCIAL_DIR, file));
      expect(text).toMatch(/\bwsAttachmentsOf\s*\(\s*attachments\s*\)/);
      expect(text).not.toMatch(/\battachments\s*\.\s*map\s*\(/);
    },
  );
});
