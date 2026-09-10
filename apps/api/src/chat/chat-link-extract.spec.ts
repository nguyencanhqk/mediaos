import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_LINK_PATTERN_SOURCE,
  CHAT_LINK_TRAILING_CHARS,
  extractChatLinks,
} from "./chat-link-extract";

/**
 * S17-CHAT-UX2-BE-2 — luật nhận diện liên kết của `CHAT-API-031`.
 *
 * Suite này có HAI phần và chúng canh hai lớp hỏng khác nhau:
 *   1. hành vi của `extractChatLinks` (trích đúng, gọt đúng, `linkIndex` đúng);
 *   2. **ca đối chiếu FE** — luật ở BE và luật vẽ thẻ `<a>` ở FE phải là MỘT. Không có ca này thì hai
 *      bên trôi khỏi nhau trong im lặng: bảng «Liên kết» liệt kê một địa chỉ mà bong bóng tin hiện nó
 *      dạng chữ (hoặc ngược lại), và không test nào đỏ vì mỗi đường đi qua một literal riêng.
 */

const url = (body: string): string[] => extractChatLinks(body).map((l) => l.url);

describe("extractChatLinks — giao thức", () => {
  it("nhận http và https", () => {
    expect(url("xem http://a.vn/x và https://b.vn/y nhé")).toEqual([
      "http://a.vn/x",
      "https://b.vn/y",
    ]);
  });

  it("KHÔNG nhận javascript: / data: / file: / ftp: — chúng ở lại dạng chữ", () => {
    // Một bảng liên kết bấm-được chứa `javascript:` là đường XSS qua đúng chỗ người dùng tin nhất.
    // Ca này neo cả 4 lược đồ để không ai "nới cho tiện" khi thêm một loại link mới.
    expect(url("javascript:alert(1)")).toEqual([]);
    expect(url("data:text/html;base64,PHNjcmlwdD4=")).toEqual([]);
    expect(url("file:///etc/passwd")).toEqual([]);
    expect(url("ftp://kho.noi.bo/tep.zip")).toEqual([]);
  });

  it("`https` nằm GIỮA một chuỗi khác vẫn được trích (không neo đầu chuỗi)", () => {
    expect(url("(nguồn: https://a.vn/x)")).toEqual(["https://a.vn/x"]);
  });
});

describe("extractChatLinks — gọt dấu câu đuôi", () => {
  it.each([...CHAT_LINK_TRAILING_CHARS].map((ch) => [ch]))("gọt `%s` khỏi đuôi", (ch) => {
    expect(url(`xem tại https://a.vn/b${ch}`)).toEqual(["https://a.vn/b"]);
  });

  it("gọt NHIỀU dấu liên tiếp", () => {
    expect(url("xem (https://a.vn/b).")).toEqual(["https://a.vn/b"]);
  });

  it("KHÔNG gọt dấu nằm giữa đường dẫn", () => {
    expect(url("https://a.vn/b,c/d?q=1")).toEqual(["https://a.vn/b,c/d?q=1"]);
  });

  it("gọt KHÔNG ăn vào phần lược đồ — `https://).` còn lại `https://` (Y HỆT FE)", () => {
    // Đo được, không suy diễn: `:` và `/` KHÔNG nằm trong tập gọt, nên một kết quả khớp không bao giờ
    // mất phần `https://`. Giá trị này xấu (một link chết trong bảng), nhưng bong bóng tin ở FE ĐANG
    // vẽ nó thành thẻ <a> y như vậy — và PARITY mới là hợp đồng của WO này. "Sửa cho đẹp" ở một bên
    // chính là cái trôi mà ca đối chiếu cuối file tồn tại để chặn.
    expect(url("https://).")).toEqual(["https://"]);
  });
});

describe("extractChatLinks — linkIndex", () => {
  it("đánh số 0-based theo THỨ TỰ XUẤT HIỆN trong body", () => {
    expect(extractChatLinks("https://a.vn https://b.vn https://c.vn")).toEqual([
      { url: "https://a.vn", linkIndex: 0 },
      { url: "https://b.vn", linkIndex: 1 },
      { url: "https://c.vn", linkIndex: 2 },
    ]);
  });

  it("KHÔNG khử trùng lặp — cùng địa chỉ dán hai lần là hai dòng", () => {
    // API-13 §5.1d bảng: "không dedupe URL ở server". Khử ở đây làm `linkIndex` không còn đếm được từ
    // `body`, tức con trỏ mất khả năng nối lại giữa hai trang.
    expect(extractChatLinks("https://a.vn và lại https://a.vn")).toHaveLength(2);
  });

  it("body rỗng ⇒ mảng rỗng, không ném", () => {
    expect(extractChatLinks("")).toEqual([]);
  });

  it("gọi HAI LẦN cho cùng một body ra kết quả GIỐNG HỆT", () => {
    // Cờ `g` mang `lastIndex` có trạng thái: một `RegExp` dùng chung ở cấp module sẽ nhớ vị trí giữa
    // hai lần gọi và bỏ sót link ở lần thứ hai. Ca này đóng đinh việc dựng regex MỚI mỗi lần chạy.
    const body = "https://a.vn/x https://b.vn/y";
    expect(extractChatLinks(body)).toEqual(extractChatLinks(body));
  });
});

// ─── ca ĐỐI CHIẾU: một luật, hai người đọc ────────────────────────────────────

/**
 * FE vẽ thẻ `<a>` bằng `splitTextWithLinks`. Đọc THẲNG file nguồn của nó và so literal — đây là cách
 * duy nhất làm ĐỎ được khoảnh khắc một bên đổi luật mà bên kia không đổi, vì hai bên không import được
 * của nhau (BE không phụ thuộc `apps/app`, và ngược lại).
 *
 * __dirname = apps/api/src/chat → lùi 4 cấp tới gốc repo.
 */
const FE_FORMAT_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "app",
  "src",
  "components",
  "chat",
  "chat-format.ts",
);

describe("đối chiếu FE — `splitTextWithLinks` và `extractChatLinks` là MỘT luật", () => {
  const feSource = readFileSync(FE_FORMAT_PATH, "utf8");

  it("file FE tồn tại và vẫn khai `splitTextWithLinks` (neo chống XANH-RỖNG)", () => {
    // Không có ca này thì đổi tên/dời file FE làm hai ca dưới so trên một chuỗi rỗng và XANH mà không
    // so gì cả (memory `refactor-to-helper-blinds-syntax-census`).
    expect(feSource).toContain("export function splitTextWithLinks");
  });

  it("BIỂU THỨC nhận diện trùng nguyên văn", () => {
    // FE viết literal `/https?:\/\/[^\s<>"']+/g`; `RegExp(source).source` cho ra cùng chuỗi đó.
    const feLiteral = `/${new RegExp(CHAT_LINK_PATTERN_SOURCE).source}/g`;
    expect(feLiteral).toBe(String.raw`/https?:\/\/[^\s<>"']+/g`);
    expect(feSource).toContain(feLiteral);
  });

  it("TẬP DẤU CÂU gọt ở đuôi trùng nguyên văn", () => {
    expect(feSource).toContain(`"${CHAT_LINK_TRAILING_CHARS}".includes(`);
  });
});
