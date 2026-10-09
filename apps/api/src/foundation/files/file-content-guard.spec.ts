/**
 * S16-SOCIAL-FILEDISPOSITION-1 — quy tắc kiểu nội dung của FileService (hàm THUẦN, unit cạnh nguồn).
 *
 * Các thứ được ghim ở đây:
 *   - bảng lý do thất bại của confirm → mã lỗi (đủ khoá, không lý do nào rơi về mã mặc định);
 *   - so kiểu đã LƯU ở storage với kiểu đã ĐĂNG KÝ: khớp · lệch · không rõ (storage không trả kiểu). Chỉ
 *     «khớp» mới qua; hai trường hợp còn lại mang hai lý do riêng + một dòng log an toàn;
 *   - từ chối cứng lúc đăng ký theo kiểu và theo đuôi (không phụ thuộc cấu hình công ty);
 *   - dạng của đuôi được nhận lúc đăng ký: 1–16 chữ cái ASCII / chữ số, hoặc tên không có đuôi.
 * Mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP cùng khung.
 */
import { ATTACHMENT_ALLOWED_CONTENT_TYPES, FOUNDATION_FILE_ERROR_CODES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { buildAttachmentDisposition } from "../../storage/content-disposition";
import {
  CONFIRM_FAILURE_ERROR_CODE,
  compareStoredContentType,
  confirmContentTypeFailure,
  describeSignRejection,
  quoteForLog,
  registerContentRejection,
  resolveRegisterExtension,
} from "./file-content-guard";

/** Chép TAY (không import từ nguồn) để ca dưới ghim đúng tập đuôi — đổi tập ở nguồn phải đổi cả ở đây. */
const HARD_BLOCKED = ["html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "xsl", "xslt"];

describe("CONFIRM_FAILURE_ERROR_CODE — lý do thất bại của confirm → mã lỗi", () => {
  it("có ĐÚNG 4 khoá, mỗi khoá trỏ tới một mã có thật trong catalog", () => {
    expect(Object.keys(CONFIRM_FAILURE_ERROR_CODE).sort()).toEqual([
      "content-type-mismatch",
      "content-type-unknown",
      "object-absent",
      "size-mismatch",
    ]);
    const catalog = new Set<string>(Object.values(FOUNDATION_FILE_ERROR_CODES));
    for (const code of Object.values(CONFIRM_FAILURE_ERROR_CODE)) {
      expect(catalog.has(code)).toBe(true);
    }
  });

  it("object vắng ⇒ CONFIRM-ABSENT; lệch cỡ, lệch kiểu và không rõ kiểu ⇒ CONFIRM-MISMATCH", () => {
    expect(CONFIRM_FAILURE_ERROR_CODE["object-absent"]).toBe("FOUNDATION-FILE-ERR-CONFIRM-ABSENT");
    expect(CONFIRM_FAILURE_ERROR_CODE["size-mismatch"]).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
    expect(CONFIRM_FAILURE_ERROR_CODE["content-type-mismatch"]).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
    expect(CONFIRM_FAILURE_ERROR_CODE["content-type-unknown"]).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
  });
});

describe("compareStoredContentType — kiểu đã lưu phải khớp kiểu đã đăng ký (ba giá trị)", () => {
  it.each([
    ["application/pdf", "text/html"],
    ["application/pdf", "image/png"],
    ["text/plain", "text/html"],
    ["application/pdf", "application/pdfx"],
    ["application/pdf", "binary/octet-stream"],
    ["application/pdf", "application/octet-stream"],
  ])("TỪ CHỐI: đăng ký %j, storage lưu %j ⇒ mismatch", (registered, stored) => {
    expect(compareStoredContentType(registered, stored)).toBe("mismatch");
  });

  it.each([
    ["application/pdf", "rác"],
    ["application/pdf", "; charset=utf-8"],
    ["application/pdf", "text/html, application/pdf"],
  ])("TỪ CHỐI: đăng ký %j, storage CÓ trả nhưng sai dạng (%j) ⇒ mismatch", (registered, stored) => {
    expect(compareStoredContentType(registered, stored)).toBe("mismatch");
  });

  it.each([
    ["application/pdf", null],
    ["application/pdf", ""],
    ["application/pdf", "   "],
    ["", ""],
    ["", null],
    ["rác", null],
  ])("TỪ CHỐI: đăng ký %j, storage KHÔNG trả kiểu (%j) ⇒ unknown", (registered, stored) => {
    expect(compareStoredContentType(registered, stored)).toBe("unknown");
  });

  it.each([
    ["rác", "rác"],
    ["không/hợp lệ", "không/hợp lệ"],
    ["", "application/pdf"],
  ])(
    "TỪ CHỐI: kiểu đăng ký sai dạng (%j) ⇒ mismatch dù storage trả đúng chuỗi đó (%j)",
    (registered, stored) => {
      expect(compareStoredContentType(registered, stored)).toBe("mismatch");
    },
  );

  it.each([
    ["application/pdf", "application/pdf"],
    ["application/pdf", "Application/PDF; x=1"],
    ["text/plain", "text/plain; charset=utf-8"],
    ["text/plain", " TEXT/PLAIN "],
    [" Text/CSV ;charset=utf-8", "text/csv"],
    ["image/png", "image/png"],
  ])("CHO PHÉP: đăng ký %j, storage lưu %j ⇒ match sau thường hoá", (registered, stored) => {
    expect(compareStoredContentType(registered, stored)).toBe("match");
  });
});

describe("confirmContentTypeFailure — lý do + dòng log của một lượt confirm không khớp kiểu", () => {
  const ROW = {
    id: "33333333-3333-3333-3333-333333333333",
    companyId: "11111111-1111-1111-1111-111111111111",
    mimeType: "application/pdf",
  };

  it("CHO PHÉP: kiểu khớp ⇒ null (không có gì để ghi)", () => {
    expect(confirmContentTypeFailure(ROW, "application/pdf")).toBeNull();
    expect(confirmContentTypeFailure(ROW, "Application/PDF; x=1")).toBeNull();
  });

  it("TỪ CHỐI: storage trả kiểu khác ⇒ lý do content-type-mismatch, dòng log đủ 4 trường", () => {
    const failure = confirmContentTypeFailure(ROW, "text/html");

    expect(failure?.reason).toBe("content-type-mismatch");
    expect(failure?.logLine).toContain(`fileId=${ROW.id}`);
    expect(failure?.logLine).toContain(`companyId=${ROW.companyId}`);
    expect(failure?.logLine).toContain('registeredType="application/pdf"');
    expect(failure?.logLine).toContain('storedType="text/html"');
    expect(failure?.logLine).toContain("content-type-mismatch");
  });

  it.each([[null], [""], ["   "]])(
    "TỪ CHỐI: storage không trả kiểu (%j) ⇒ lý do content-type-unknown, khác lý do lệch kiểu",
    (stored) => {
      const failure = confirmContentTypeFailure(ROW, stored);

      expect(failure?.reason).toBe("content-type-unknown");
      expect(failure?.logLine).toContain("content-type-unknown");
      expect(failure?.logLine).toContain(`storedType=${stored === null ? "null" : `"${stored}"`}`);
    },
  );

  it("câu trả cho người dùng KHÔNG chép kiểu nào; hai lý do có hai câu khác nhau", () => {
    const mismatch = confirmContentTypeFailure(ROW, "text/html");
    const unknown = confirmContentTypeFailure(ROW, null);

    expect(mismatch?.message).not.toContain("text/html");
    expect(mismatch?.message).not.toContain("application/pdf");
    expect(unknown?.message).not.toContain("application/pdf");
    expect(unknown?.message).not.toBe(mismatch?.message);
  });

  it("kiểu storage trả là chuỗi do bên ngoài điều khiển ⇒ dòng log vẫn là MỘT dòng ASCII, bị cắt", () => {
    const lineBreaks = [10, 13, 0x85, 0x2028].map((code) => String.fromCodePoint(code)).join("");
    const hostile = `text/html${lineBreaks}dong-gia fileId=khac${"x".repeat(500)}`;

    const failure = confirmContentTypeFailure(ROW, hostile);

    expect(failure?.reason).toBe("content-type-mismatch");
    const logLine = failure?.logLine ?? "";
    expect(logLine).toMatch(/^[ -~]+$/);
    expect(logLine.length).toBeLessThan(400);
    // Giá trị nằm trọn trong MỘT cặp nháy: không tự đóng nháy để chèn trường mới.
    expect(logLine.match(/storedType="/g)).toHaveLength(1);
  });
});

describe("quoteForLog — đưa một chuỗi ngoài vào dòng log", () => {
  it("null ⇒ null; chuỗi thường ⇒ trong nháy kép", () => {
    expect(quoteForLog(null)).toBe("null");
    expect(quoteForLog("image/png")).toBe('"image/png"');
    expect(quoteForLog("")).toBe('""');
  });

  it("nháy kép trong giá trị bị thoát; dài quá trần ⇒ cắt kèm dấu ba chấm", () => {
    const escapedQuote = quoteForLog('a"b');
    expect(escapedQuote).toHaveLength(6);
    expect(escapedQuote.startsWith('"a')).toBe(true);
    expect(escapedQuote.endsWith('"b"')).toBe(true);
    expect(quoteForLog("y".repeat(300))).toBe(`"${"y".repeat(120)}..."`);
  });

  it("mọi điểm mã ngoài ASCII in được ⇒ không còn trong đầu ra", () => {
    const every = [0, 9, 10, 13, 27, 0x7f, 0x85, 0x9f, 0xa0, 0x2028, 0x2029, 0x202e, 0xfffd]
      .map((code) => String.fromCodePoint(code))
      .join("|");
    expect(quoteForLog(every)).toMatch(/^[ -~]+$/);
  });
});

describe("describeSignRejection — dòng log khi tầng ký từ chối một lượt đăng ký", () => {
  it("đủ 4 trường: kind · companyId · kiểu khai · thông điệp gốc", () => {
    const line = describeSignRejection("11111111-1111-1111-1111-111111111111", "application/x-a", {
      kind: "content-type",
      message: "ngoai tran: application/x-a",
    });

    expect(line).toContain("kind=content-type");
    expect(line).toContain("companyId=11111111-1111-1111-1111-111111111111");
    expect(line).toContain('declaredType="application/x-a"');
    expect(line).toContain('detail="ngoai tran: application/x-a"');
    expect(line).toMatch(/^[ -~]+$/);
  });
});

describe("registerContentRejection — từ chối cứng lúc đăng ký", () => {
  it.each([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "application/atom+xml",
    " TEXT/HTML ",
    "text/html; charset=utf-8",
    "IMAGE/SVG+XML",
  ])("TỪ CHỐI: kiểu %j ⇒ active-mime (có hay không có đuôi)", (declared) => {
    expect(registerContentRejection(declared, null)).toBe("active-mime");
    expect(registerContentRejection(declared, "png")).toBe("active-mime");
  });

  it.each(HARD_BLOCKED)("TỪ CHỐI: đuôi %j ⇒ hard-blocked-extension dù kiểu khai hợp lệ", (ext) => {
    expect(registerContentRejection("application/pdf", ext)).toBe("hard-blocked-extension");
    expect(registerContentRejection("application/zip", ext)).toBe("hard-blocked-extension");
  });

  it.each(["SVG", "Html", ".xml", ".XSLT"])(
    "TỪ CHỐI: đuôi viết hoa / có dấu chấm đầu (%j) vẫn bị nhận ra",
    (ext) => {
      expect(registerContentRejection("application/pdf", ext)).toBe("hard-blocked-extension");
    },
  );

  it("kiểu bị từ chối được báo TRƯỚC đuôi khi cả hai cùng vi phạm", () => {
    expect(registerContentRejection("text/html", "html")).toBe("active-mime");
  });

  it("CHO PHÉP — bảng 14 kiểu của tầng storage: không kiểu nào bị từ chối cứng", () => {
    expect(ATTACHMENT_ALLOWED_CONTENT_TYPES).toHaveLength(14);
    for (const type of ATTACHMENT_ALLOWED_CONTENT_TYPES) {
      expect(registerContentRejection(type, null), type).toBeNull();
    }
  });

  it.each(["pdf", "png", "docx", "xlsx", "pptx", "csv", "txt", "zip", "htmlx", "xmlx", "xl"])(
    "CHO PHÉP: đuôi %j không thuộc tập chặn cứng (so ĐÚNG chuỗi, không so chuỗi con)",
    (ext) => {
      expect(registerContentRejection("application/zip", ext)).toBeNull();
    },
  );

  it("CHO PHÉP: tệp không đuôi với kiểu hợp lệ ⇒ null", () => {
    expect(registerContentRejection("application/pdf", null)).toBeNull();
  });

  it("kiểu SAI DẠNG không thuộc lưới này (allowlist công ty + trần của tầng storage lo) ⇒ null", () => {
    expect(registerContentRejection("rác", null)).toBeNull();
    expect(registerContentRejection("", null)).toBeNull();
  });
});

describe("resolveRegisterExtension — đuôi của tên SẼ PHÁT RA, so với tập chặn cứng HỢP tập của công ty", () => {
  /** Ký tự đặc biệt dựng từ ĐIỂM MÃ — tệp nguồn không chứa ký tự vô hình. */
  const at = (codePoint: number): string => String.fromCodePoint(codePoint);
  const HIGH_SURROGATE = at(0xd83d); // surrogate lẻ
  const FULLWIDTH_DOT = at(0xff0e);
  const KELVIN_SIGN = at(0x212a); // dạng chuẩn tắc của nó là chữ K không dấu
  const NONE: ReadonlySet<string> = new Set();
  const COMPANY: ReadonlySet<string> = new Set(["xyz"]);

  it.each(HARD_BLOCKED)("TỪ CHỐI: đuôi chặn cứng %j bị nhận ra dù tập của công ty RỖNG", (ext) => {
    expect(resolveRegisterExtension(`tep.${ext}`, NONE)).toEqual({
      fileExtension: ext,
      malformedExtension: false,
      blockedExtension: ext,
    });
    expect(resolveRegisterExtension(`TEP.${ext.toUpperCase()}`, NONE).blockedExtension).toBe(ext);
    expect(resolveRegisterExtension(`.${ext}`, NONE).blockedExtension).toBe(ext);
    expect(resolveRegisterExtension(`tep${HIGH_SURROGATE}.${ext}`, NONE).blockedExtension).toBe(
      ext,
    );
  });

  it("TỪ CHỐI: đuôi chỉ có trong tập của công ty; HỢP — đuôi chặn cứng vẫn bị chặn khi tập công ty khác rỗng", () => {
    expect(resolveRegisterExtension("tep.xyz", COMPANY).blockedExtension).toBe("xyz");
    expect(resolveRegisterExtension(".xyz", COMPANY).blockedExtension).toBe("xyz");
    expect(resolveRegisterExtension("tep.svg", COMPANY).blockedExtension).toBe("svg");
  });

  it("TỪ CHỐI: ký tự có dạng chuẩn tắc là một chữ cái không dấu được so như chính chữ cái đó", () => {
    expect(resolveRegisterExtension(`tep.xy${KELVIN_SIGN}`, new Set(["xyk"]))).toEqual({
      fileExtension: "xyk",
      malformedExtension: false,
      blockedExtension: "xyk",
    });
    expect(resolveRegisterExtension(`tep.xy${KELVIN_SIGN}`, COMPANY).blockedExtension).toBeNull();
  });

  it.each<[string, string | null]>([
    ["tep.pdf", "pdf"],
    ["bao.cao.quy-3.v2.PDF", "pdf"],
    [".pdf", "pdf"],
    ["tep-khong-duoi", null],
    [`${"a".repeat(300)}.xlsx`, "xlsx"],
    ["tep.xyzw", "xyzw"],
    [`tep${FULLWIDTH_DOT}xyz`, null],
  ])("CHO PHÉP: tên %j ⇒ đuôi lưu %j, không chặn", (fileName, fileExtension) => {
    expect(resolveRegisterExtension(fileName, COMPANY)).toEqual({
      fileExtension,
      malformedExtension: false,
      blockedExtension: null,
    });
  });
});

describe("resolveRegisterExtension — đuôi được nhận chỉ gồm 1–16 chữ cái ASCII hoặc chữ số", () => {
  const at = (codePoint: number): string => String.fromCodePoint(codePoint);
  const codePointLabel = (codePoint: number): string =>
    `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const fullwidth = (text: string): string =>
    Array.from(text, (char) => at(char.charCodeAt(0) + 0xfee0)).join("");
  const END_MARK = at(0x180e);
  const LONG_S = at(0x017f);
  const DOTLESS_I = at(0x0131);
  const LRM = at(0x200e); // dấu chiều chữ — phép làm sạch thay bằng `_`
  const ZERO_WIDTH_SPACE = at(0x200b);
  const Z_ACUTE = at(0x017a); // chữ z mang dấu sắc
  const RESERVED_PUNCTUATION = [":", "*", "?", '"', "<", ">", "|"];
  const INVISIBLE_FORMAT = [0x200b, 0x200d, 0x2060, 0x00ad, 0x061c].map(
    (codePoint): [string, string] => [codePointLabel(codePoint), at(codePoint)],
  );
  /** Ba đuôi thử cho mỗi lớp: thuộc tập chặn cứng · chỉ thuộc tập của công ty · đuôi thường. */
  const SAMPLE_EXTENSIONS = ["svg", "xyz", "zip"];
  const NONE: ReadonlySet<string> = new Set();
  const COMPANY: ReadonlySet<string> = new Set(["xyz", "xis"]);

  /** Kết cục của một tên theo ĐÚNG thứ tự bên gọi xét: dạng của đuôi trước, tập chặn sau. */
  const outcomeOf = (fileName: string): "malformed" | "blocked" | "accepted" => {
    const verdict = resolveRegisterExtension(fileName, COMPANY);
    if (verdict.malformedExtension) return "malformed";
    return verdict.blockedExtension === null ? "accepted" : "blocked";
  };

  /** [nhãn, tên] — ký tự của bốn lớp nằm TRONG hoặc ngay SAU đuôi. */
  const MARK_IN_EXTENSION: Array<[string, string]> = [
    ...SAMPLE_EXTENSIONS.map((ext): [string, string] => [
      `lớp 1 — U+180E sau đuôi ${ext}`,
      `tep.${ext}${END_MARK}`,
    ]),
    ...RESERVED_PUNCTUATION.flatMap((mark) =>
      SAMPLE_EXTENSIONS.map((ext): [string, string] => [
        `lớp 2 — dấu ${mark} sau đuôi ${ext}`,
        `tep.${ext}${mark}`,
      ]),
    ),
    ["lớp 3 — U+017F thay một chữ của đuôi svg", `tep.${LONG_S}vg`],
    ["lớp 3 — U+017F thay một chữ của đuôi xsl", `tep.x${LONG_S}l`],
    ["lớp 3 — U+017F thay một chữ của đuôi xis", `tep.xi${LONG_S}`],
    ["lớp 3 — U+0131 thay một chữ của đuôi xis", `tep.x${DOTLESS_I}s`],
    ["lớp 3 — U+017F trong một đuôi thường", `tep.${LONG_S}vgx`],
    ...INVISIBLE_FORMAT.flatMap(
      ([label, mark]): Array<[string, string]> => [
        [`lớp 4 — ${label} giữa đuôi svg`, `tep.sv${mark}g`],
        [`lớp 4 — ${label} giữa đuôi xyz`, `tep.xy${mark}z`],
        [`lớp 4 — ${label} giữa đuôi zip`, `tep.zi${mark}p`],
      ],
    ),
    ["dấu câu giữa đuôi", "tep.svg?x"],
    ["khoảng trắng + ngoặc sau đuôi", "tep.xyz (1)"],
    ["dấu câu giữa một đuôi thường", "tep.sv?gx"],
  ];

  it.each(MARK_IN_EXTENSION)("TỪ CHỐI — %s ⇒ đuôi không hợp lệ", (_label, fileName) => {
    expect(outcomeOf(fileName)).toBe("malformed");
  });

  /** Cùng các ký tự đó nằm ở THÂN tên, đuôi thường. */
  const MARK_IN_STEM: Array<[string, string]> = [
    ["U+180E", END_MARK],
    ...RESERVED_PUNCTUATION.map((mark): [string, string] => [`dấu ${mark}`, mark]),
    ["U+017F", LONG_S],
    ["U+0131", DOTLESS_I],
    ...INVISIBLE_FORMAT,
  ];

  it.each(MARK_IN_STEM)("CHO PHÉP — %s nằm ở THÂN tên, đuôi thường ⇒ nhận", (_label, mark) => {
    expect(resolveRegisterExtension(`te${mark}p.zip`, COMPANY)).toEqual({
      fileExtension: "zip",
      malformedExtension: false,
      blockedExtension: null,
    });
  });

  it.each<[string, string]>([
    ["chỉ một dấu câu", "tep.svg.?"],
    ["chỉ U+180E", `tep.svg.${END_MARK}`],
    ["chỉ U+200B", `tep.svg.${ZERO_WIDTH_SPACE}`],
    ["chỉ một dấu câu (tên mang đuôi của tập công ty)", "tep.xyz.?"],
    ["một dấu câu, lặp hai lần", "tep.svg.?.?"],
    ["khoảng trắng rồi dấu câu", "tep.svg. ?"],
    ["dấu câu rồi chữ", "tep.svg.?x"],
    ["khoảng trắng rồi chữ", "tep.svg. ban cuoi"],
  ])("TỪ CHỐI — đoạn sau dấu chấm cuối là %s ⇒ đuôi không hợp lệ", (_label, fileName) => {
    expect(outcomeOf(fileName)).toBe("malformed");
  });

  it.each<[string, string, string]>([
    ["ký tự bị thay trong đuôi", `tep.xy${LRM}z`, "xy_z"],
    ["ký tự bị thay sau đuôi", `tep.xyz${LRM}`, "xyz_"],
    ["dấu chấm cuối tên", "tep.xyz.", "xyz_"],
    ["dấu chấm cuối tên (đuôi chặn cứng)", "tep.svg.", "svg_"],
    ["chỗ cắt độ dài rơi vào đuôi", `${"a".repeat(176)}.xyz${"z".repeat(9)}`, "xy_"],
  ])(
    "TỪ CHỐI — %s: phép làm sạch chèn `_` vào đuôi ⇒ đuôi không hợp lệ",
    (_label, fileName, fileExtension) => {
      expect(resolveRegisterExtension(fileName, COMPANY)).toEqual({
        fileExtension,
        malformedExtension: true,
        blockedExtension: null,
      });
    },
  );

  it.each<[string, string]>([
    ["gạch dưới", "tep.x_t"],
    ["gạch nối", "tep.tar-gz"],
    ["dấu ngã", "ban-nhap.txt~"],
    ["khoảng trắng (tên dạng câu)", "Ghi chu. Ban cuoi"],
    ["chữ mang dấu", `tep.xy${Z_ACUTE}`],
    ["chữ cái toàn chiều rộng", `tep.${fullwidth("zip")}`],
    ["chữ cái toàn chiều rộng (đuôi khác)", `tep.${fullwidth("svg")}`],
    ["17 ký tự", `tep.${"a".repeat(17)}`],
    ["60 ký tự", `tep.${"e".repeat(60)}`],
  ])("TỪ CHỐI — đuôi có %s ⇒ đuôi không hợp lệ", (_label, fileName) => {
    expect(outcomeOf(fileName)).toBe("malformed");
  });

  it("hai kết quả tách bạch: «không hợp lệ» không thay «bị chặn» — bên gọi xét dạng của đuôi TRƯỚC", () => {
    // Dạng dự phòng ASCII của đuôi này trùng một phần tử của tập công ty; đuôi chính thì không đúng dạng.
    expect(resolveRegisterExtension(`tep.xy${Z_ACUTE}`, new Set(["xy_"]))).toEqual({
      fileExtension: `xy${Z_ACUTE}`,
      malformedExtension: true,
      blockedExtension: "xy_",
    });
    // Đuôi LƯU cắt còn 50 ký tự; phép so tập chặn dùng đuôi ĐẦY ĐỦ.
    const longExtension = "e".repeat(60);
    expect(resolveRegisterExtension(`tep.${longExtension}`, new Set([longExtension]))).toEqual({
      fileExtension: "e".repeat(50),
      malformedExtension: true,
      blockedExtension: longExtension,
    });
    expect(resolveRegisterExtension("tep.svg", COMPANY)).toEqual({
      fileExtension: "svg",
      malformedExtension: false,
      blockedExtension: "svg",
    });
  });

  it.each<[string, string, string | null]>([
    ["tên tiếng Việt có dấu", "Hồ sơ dự thầu – Đặng Thị Ánh.zip", "zip"],
    ["hai đuôi", "a.tar.gz", "gz"],
    ["nhiều dấu chấm ở thân", "Bien ban hop 12.10.pdf", "pdf"],
    ["dấu chấm giữa câu, phần sau là chữ số", "Bien ban hop 12.10", "10"],
    ["số trong ngoặc ở thân", "anh (1).png", "png"],
    ["chữ hoa", "ANH.PNG", "png"],
    ["chữ hoa + số trong ngoặc ở thân", "IMG_0012 (2).JPG", "jpg"],
    ["tên dài hơn 180 byte", `${"ă".repeat(295)}.xlsx`, "xlsx"],
    ["tên không có dấu chấm", "tep-khong-duoi", null],
    ["dấu chấm duy nhất nằm cuối tên", "Bao cao thang 10.", null],
    ["đuôi có chữ số", "tep.7z", "7z"],
    ["đuôi toàn chữ số", "tep.001", "001"],
    ["đuôi 16 ký tự", `tep.${"a".repeat(16)}`, "a".repeat(16)],
  ])("CHO PHÉP — %s ⇒ nhận, không chặn", (_label, fileName, fileExtension) => {
    expect(resolveRegisterExtension(fileName, COMPANY)).toEqual({
      fileExtension,
      malformedExtension: false,
      blockedExtension: null,
    });
  });

  it("thuộc tính — mọi điểm mã U+0000…U+FFFF đặt vào đuôi: tên được nhận ⇒ cả hai dạng tên phát ra kết thúc bằng «.» + 1–16 chữ cái ASCII / chữ số", () => {
    const ACCEPTED_TAIL = /\.[A-Za-z0-9]{1,16}$/;
    const MAX_REPORTED = 5;
    const offenders: string[] = [];
    let accepted = 0;
    for (let codePoint = 0; codePoint <= 0xffff; codePoint += 1) {
      const char = at(codePoint);
      for (const fileName of [`tep.xy${char}`, `tep.x${char}y`, `tep.${char}xy`]) {
        if (resolveRegisterExtension(fileName, NONE).malformedExtension) continue;
        accepted += 1;
        const header = buildAttachmentDisposition(fileName);
        const match = /^attachment; filename="([^"]*)"; filename\*=UTF-8''(.*)$/.exec(header);
        const forms = [match?.[1] ?? "", decodeURIComponent(match?.[2] ?? "")];
        if (forms.every((form) => ACCEPTED_TAIL.test(form))) continue;
        if (offenders.length < MAX_REPORTED) offenders.push(codePointLabel(codePoint));
      }
    }

    expect(offenders).toEqual([]);
    // 62 chữ cái ASCII / chữ số ở ba vị trí là mức tối thiểu ⇒ vòng lặp có đi qua nhánh «được nhận».
    expect(accepted).toBeGreaterThanOrEqual(62 * 3);
  });
});
