/**
 * S16-SOCIAL-FILEDISPOSITION-1 — quy tắc kiểu nội dung của FileService (hàm THUẦN, unit cạnh nguồn).
 *
 * Các thứ được ghim ở đây:
 *   - bảng lý do thất bại của confirm → mã lỗi (đủ khoá, không lý do nào rơi về mã mặc định);
 *   - so kiểu đã LƯU ở storage với kiểu đã ĐĂNG KÝ: khớp · lệch · không rõ (storage không trả kiểu). Chỉ
 *     «khớp» mới qua; hai trường hợp còn lại mang hai lý do riêng + một dòng log an toàn;
 *   - từ chối cứng lúc đăng ký theo kiểu và theo đuôi (không phụ thuộc cấu hình công ty).
 * Mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP cùng khung.
 */
import { ATTACHMENT_ALLOWED_CONTENT_TYPES, FOUNDATION_FILE_ERROR_CODES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
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
  const LRM = at(0x200e); // dấu chiều chữ
  const HIGH_SURROGATE = at(0xd83d); // surrogate lẻ
  const FULLWIDTH_DOT = at(0xff0e);
  const Z_ACUTE = at(0x017a); // chữ z mang dấu sắc
  const NONE: ReadonlySet<string> = new Set();
  const COMPANY: ReadonlySet<string> = new Set(["xyz"]);

  it.each(HARD_BLOCKED)("TỪ CHỐI: đuôi chặn cứng %j bị nhận ra dù tập của công ty RỖNG", (ext) => {
    expect(resolveRegisterExtension(`tep.${ext}`, NONE)).toEqual({
      fileExtension: ext,
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

  it("TỪ CHỐI: đuôi của dạng dự phòng ASCII thuộc tập công ty dù đuôi của dạng Unicode thì không", () => {
    expect(resolveRegisterExtension(`tep.xy${Z_ACUTE}`, new Set(["xy_"]))).toEqual({
      fileExtension: `xy${Z_ACUTE}`,
      blockedExtension: "xy_",
    });
  });

  it("TỪ CHỐI: phép so dùng đuôi ĐẦY ĐỦ — đuôi lưu bị cắt còn 50 ký tự không làm hụt phép so", () => {
    const longExtension = "e".repeat(60);
    expect(resolveRegisterExtension(`tep.${longExtension}`, new Set([longExtension]))).toEqual({
      fileExtension: "e".repeat(50),
      blockedExtension: longExtension,
    });
  });

  it.each<[string, string, string | null]>([
    ["ký tự bị loại trong đuôi", `tep.xy${LRM}z`, "xy_z"],
    ["ký tự bị loại sau đuôi", `tep.xyz${LRM}`, "xyz_"],
    ["dấu chấm cuối", "tep.xyz.", "xyz_"],
    ["chỗ cắt độ dài rơi ngay sau đuôi", `${"a".repeat(176)}.xyz${"z".repeat(9)}`, "xy_"],
    ["dấu chấm toàn chiều rộng", `tep${FULLWIDTH_DOT}xyz`, null],
    ["chữ cuối của đuôi mang dấu", `tep.xy${Z_ACUTE}`, `xy${Z_ACUTE}`],
    ["đuôi chỉ CHỨA đuôi bị chặn", "tep.xyzw", "xyzw"],
  ])(
    "CHO PHÉP: %s ⇒ không chặn (tên phát ra không mang đuôi `xyz`), đuôi lưu %j",
    (_label, fileName, fileExtension) => {
      expect(resolveRegisterExtension(fileName, COMPANY)).toEqual({
        fileExtension,
        blockedExtension: null,
      });
    },
  );

  it.each<[string, string | null]>([
    ["tep.pdf", "pdf"],
    ["bao.cao.quy-3.v2.PDF", "pdf"],
    [".pdf", "pdf"],
    ["tep-khong-duoi", null],
    [`${"a".repeat(300)}.xlsx`, "xlsx"],
  ])("CHO PHÉP: tên thường %j ⇒ đuôi lưu %j, không chặn", (fileName, fileExtension) => {
    expect(resolveRegisterExtension(fileName, COMPANY)).toEqual({
      fileExtension,
      blockedExtension: null,
    });
  });
});
