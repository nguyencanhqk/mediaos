/**
 * S16-SOCIAL-FILEDISPOSITION-1 — quy tắc kiểu nội dung của FileService (hàm THUẦN, unit cạnh nguồn).
 *
 * Ba thứ được ghim ở đây:
 *   - bảng lý do thất bại của confirm → mã lỗi (đủ khoá, không lý do nào rơi về mã mặc định);
 *   - so kiểu đã LƯU ở storage với kiểu đã ĐĂNG KÝ (thiếu / sai dạng ở bất kỳ vế nào = không khớp);
 *   - từ chối cứng lúc đăng ký theo kiểu và theo đuôi (không phụ thuộc cấu hình công ty).
 * Mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP cùng khung.
 */
import { ATTACHMENT_ALLOWED_CONTENT_TYPES, FOUNDATION_FILE_ERROR_CODES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_FAILURE_ERROR_CODE,
  registerContentRejection,
  resolveRegisterExtension,
  storedContentTypeMatches,
} from "./file-content-guard";

/** Chép TAY (không import từ nguồn) để ca dưới ghim đúng tập đuôi — đổi tập ở nguồn phải đổi cả ở đây. */
const HARD_BLOCKED = ["html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "xsl", "xslt"];

describe("CONFIRM_FAILURE_ERROR_CODE — lý do thất bại của confirm → mã lỗi", () => {
  it("có ĐÚNG 3 khoá, mỗi khoá trỏ tới một mã có thật trong catalog", () => {
    expect(Object.keys(CONFIRM_FAILURE_ERROR_CODE).sort()).toEqual([
      "content-type-mismatch",
      "object-absent",
      "size-mismatch",
    ]);
    const catalog = new Set<string>(Object.values(FOUNDATION_FILE_ERROR_CODES));
    for (const code of Object.values(CONFIRM_FAILURE_ERROR_CODE)) {
      expect(catalog.has(code)).toBe(true);
    }
  });

  it("object vắng ⇒ CONFIRM-ABSENT; lệch cỡ và lệch kiểu ⇒ CONFIRM-MISMATCH", () => {
    expect(CONFIRM_FAILURE_ERROR_CODE["object-absent"]).toBe("FOUNDATION-FILE-ERR-CONFIRM-ABSENT");
    expect(CONFIRM_FAILURE_ERROR_CODE["size-mismatch"]).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
    expect(CONFIRM_FAILURE_ERROR_CODE["content-type-mismatch"]).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
  });
});

describe("storedContentTypeMatches — kiểu đã lưu phải khớp kiểu đã đăng ký", () => {
  it.each([
    ["application/pdf", "text/html"],
    ["application/pdf", "image/png"],
    ["text/plain", "text/html"],
    ["application/pdf", "application/pdfx"],
    ["application/pdf", "binary/octet-stream"],
    ["application/pdf", "application/octet-stream"],
  ])("TỪ CHỐI: đăng ký %j, storage lưu %j ⇒ không khớp", (registered, stored) => {
    expect(storedContentTypeMatches(registered, stored)).toBe(false);
  });

  it.each([
    ["application/pdf", null],
    ["application/pdf", ""],
    ["application/pdf", "   "],
    ["application/pdf", "rác"],
    ["application/pdf", "; charset=utf-8"],
  ])(
    "TỪ CHỐI: đăng ký %j, storage không trả kiểu dùng được (%j) ⇒ không khớp",
    (registered, stored) => {
      expect(storedContentTypeMatches(registered, stored)).toBe(false);
    },
  );

  it.each([
    ["rác", "rác"],
    ["", ""],
    ["", null],
    ["không/hợp lệ", "không/hợp lệ"],
  ])(
    "TỪ CHỐI: kiểu đăng ký sai dạng (%j) ⇒ không khớp dù hai chuỗi giống nhau (%j)",
    (registered, stored) => {
      expect(storedContentTypeMatches(registered, stored)).toBe(false);
    },
  );

  it.each([
    ["application/pdf", "application/pdf"],
    ["application/pdf", "Application/PDF; x=1"],
    ["text/plain", "text/plain; charset=utf-8"],
    ["text/plain", " TEXT/PLAIN "],
    [" Text/CSV ;charset=utf-8", "text/csv"],
    ["image/png", "image/png"],
  ])("CHO PHÉP: đăng ký %j, storage lưu %j ⇒ khớp sau thường hoá", (registered, stored) => {
    expect(storedContentTypeMatches(registered, stored)).toBe(true);
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
