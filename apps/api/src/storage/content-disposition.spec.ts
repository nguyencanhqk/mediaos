/**
 * S16-SOCIAL-FILEDISPOSITION-1 — tên tệp phát ra khi tải về + `Content-Disposition: attachment`
 * (hàm thuần, toàn phần).
 *
 * P3 · P4 của plan §4, cộng nhóm ca «đuôi của tên phát ra = đuôi đã kiểm lúc đăng ký»:
 *   N1 — ký tự bị loại được THAY bằng `_` (không xoá) ⇒ hai phần của tên không liền lại thành đuôi khác;
 *   N2 — dấu chấm / khoảng trắng ở cuối tên;
 *   N3 — phép cắt độ dài không sinh đuôi mới;
 *   N4 — ký tự tương thích toàn chiều rộng không thành ASCII ở dạng dự phòng;
 *   N5 — đuôi có dấu không thành đuôi ASCII ở dạng dự phòng;
 *   N6 — surrogate lẻ: giữ được phần còn lại của tên + đuôi;
 *   N7 — tên bắt đầu bằng dấu chấm;
 *   NP — ca thuộc tính trên corpus tên bất thường + bộ sinh tổ hợp xác định (cuối file).
 *
 * Ký tự đặc biệt trong ca được dựng từ ĐIỂM MÃ (`at(0x…)`) — tệp nguồn không chứa ký tự vô hình.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttachmentDisposition,
  fileNameExtension,
  servedFileName,
  servedFileNameExtensions,
} from "./content-disposition";

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const MAX_HEADER_CHARS = 700;

const at = (codePoint: number): string => String.fromCodePoint(codePoint);
const BELL = at(0x0007); // C0
const NEL = at(0x0085); // C1
const NBSP = at(0x00a0); // khoảng trắng không ngắt
const ACUTE = at(0x0301); // dấu sắc kết hợp
const Z_ACUTE = at(0x017a); // chữ z mang dấu sắc (dạng ghép sẵn)
const D_STROKE = at(0x0111); // chữ đ
const LRM = at(0x200e); // dấu chiều chữ
const ONE_DOT_LEADER = at(0x2024);
const LINE_SEPARATOR = at(0x2028);
const EMBED_END = at(0x202c); // kết thúc nhúng chiều chữ
const RLO = at(0x202e); // ghi đè chiều chữ
const IDEOGRAPHIC_SPACE = at(0x3000);
const HIGH_SURROGATE = at(0xd83d); // surrogate lẻ (nửa đầu)
const LOW_SURROGATE = at(0xdc00); // surrogate lẻ (nửa sau)
const FULLWIDTH_DOT = at(0xff0e);
const FULLWIDTH_SOLIDUS = at(0xff0f);
const REPLACEMENT_CHAR = at(0xfffd);

/** Chữ ASCII → chữ toàn chiều rộng tương ứng (U+FF01–U+FF5E). */
const fullwidth = (text: string): string =>
  Array.from(text, (char) => at(char.charCodeAt(0) + 0xfee0)).join("");

/**
 * BẢN CHÉP parser tên tệp phía FE — nguồn: `packages/web-core/src/lib/api-client.ts:597-609`
 * (`parseContentDispositionFilename`, chép ngày 08/10/2026). FE đổi parser ⇒ chép lại bản mới vào đây;
 * ca P4 tồn tại để hai phía không trôi khỏi nhau.
 */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return extended[1];
    }
  }
  const plain = /filename=["']?([^"';\r\n]+)["']?/i.exec(header);
  return plain?.[1] ?? null;
}

/** Hai dạng tên trong header của một tên thô: `unicode` đọc bằng parser FE, `ascii` là phần trong nháy kép. */
function emittedNames(rawName: string): { unicode: string; ascii: string } {
  const header = buildAttachmentDisposition(rawName);
  const quoted = /^attachment; filename="([^"]*)"; filename\*=/.exec(header);
  const unicode = parseContentDispositionFilename(header);
  if (quoted?.[1] === undefined || unicode === null) throw new Error(`header sai dạng: ${header}`);
  return { unicode, ascii: quoted[1] };
}

/** 9 tên của phép chạy thử U3: [nhãn, tên thô, tên kỳ vọng sau khi làm sạch]. */
const NAME_CASES: ReadonlyArray<readonly [string, string, string]> = [
  ["tiếng Việt", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf"],
  ["nháy kép", 'a "b" c.docx', 'a "b" c.docx'],
  ["chấm phẩy + phần trăm", "x;y%20z%.txt", "x;y%20z%.txt"],
  ["CR/LF", "dong1\r\nX-Khac: a=b.pdf", "dong1__X-Khac: a=b.pdf"],
  ["gạch chéo", "..\\..\\thu-muc/tep", ".._.._thu-muc_tep"],
  ["ký tự đảo chiều", `bao${RLO}cao.pdf`, "bao_cao.pdf"],
  ["nháy đơn + ngoặc + sao", "it's (1)*.png", "it's (1)*.png"],
  ["rỗng", "", "download"],
  ["300 ký tự", `${"ă".repeat(300)}.xlsx`, `${"ă".repeat(87)}.xlsx`],
];

describe("buildAttachmentDisposition — P3", () => {
  it.each(NAME_CASES)("%s: đầu ra ASCII in được, không xuống dòng, ≤ 700 ký tự", (_label, raw) => {
    const header = buildAttachmentDisposition(raw);
    expect(header).toMatch(PRINTABLE_ASCII);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.length).toBeLessThanOrEqual(MAX_HEADER_CHARS);
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).toContain("; filename*=UTF-8''");
  });

  it("phần dự phòng trong nháy kép không chứa nháy kép / gạch chéo / chấm phẩy / phần trăm", () => {
    for (const [, raw] of NAME_CASES) {
      expect(emittedNames(raw).ascii, raw).not.toMatch(/["\\/;%]/);
    }
  });

  it("emoji (ngoài BMP) vắt qua mốc 180 byte: KHÔNG ném, đầu ra ASCII, không cắt đôi ký tự", () => {
    const raw = `${"a".repeat(174)}😀😀.pdf`;
    const header = buildAttachmentDisposition(raw);
    expect(header).toMatch(PRINTABLE_ASCII);
    expect(parseContentDispositionFilename(header)).toBe(`${"a".repeat(174)}.pdf`);
  });

  it("đầu vào không phải chuỗi lúc chạy (null / undefined): KHÔNG ném", () => {
    const loose = buildAttachmentDisposition as (rawName: unknown) => string;
    expect(loose(null)).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
    expect(loose(undefined)).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
  });

  it.each(["..", ".", " . ", "   "])(
    "tên chỉ gồm dấu chấm / khoảng trắng (%j) ⇒ download",
    (raw) => {
      expect(parseContentDispositionFilename(buildAttachmentDisposition(raw))).toBe("download");
    },
  );

  it("tên ASCII thường giữ nguyên", () => {
    expect(buildAttachmentDisposition("report-2026.pdf")).toBe(
      "attachment; filename=\"report-2026.pdf\"; filename*=UTF-8''report-2026.pdf",
    );
  });

  it("cắt theo byte UTF-8 vẫn giữ đuôi tệp", () => {
    const header = buildAttachmentDisposition(`${"x".repeat(400)}.docx`);
    expect(parseContentDispositionFilename(header)).toBe(`${"x".repeat(175)}.docx`);
  });
});

describe("buildAttachmentDisposition — P4 (đối chiếu parser FE)", () => {
  it.each(NAME_CASES)(
    "%s: parser FE đọc ngược ra đúng tên đã làm sạch",
    (_label, raw, expected) => {
      expect(parseContentDispositionFilename(buildAttachmentDisposition(raw))).toBe(expected);
    },
  );

  it("tên thô chứa chính chuỗi `filename*=` không đánh lừa parser FE", () => {
    const header = buildAttachmentDisposition("filename*=khac.pdf");
    expect(parseContentDispositionFilename(header)).toBe("filename*=khac.pdf");
  });
});

describe("tên phát ra — N1: ký tự bị loại được THAY bằng `_`, không xoá", () => {
  it.each([
    ["dấu chiều chữ TRONG đuôi", `tep.xy${LRM}z`, "tep.xy_z"],
    ["dấu chiều chữ ngay SAU đuôi", `tep.xyz${LRM}`, "tep.xyz_"],
    ["ký tự C1 ngay sau đuôi", `tep.xyz${NEL}`, "tep.xyz_"],
    ["ngắt dòng Unicode ngay sau đuôi", `tep.xyz${LINE_SEPARATOR}`, "tep.xyz_"],
    ["ký tự điều khiển C0 trong đuôi", `tep.sv${BELL}g`, "tep.sv_g"],
    ["dấu kết thúc nhúng chiều chữ trong đuôi", `trang.ht${EMBED_END}ml`, "trang.ht_ml"],
    ["ký tự thay thế U+FFFD trong đuôi", `tep.xy${REPLACEMENT_CHAR}z`, "tep.xy_z"],
    ["gạch chéo trong đuôi", "tep.xy/z", "tep.xy_z"],
  ])("%s: cả hai dạng mang `_` đúng chỗ ký tự bị loại", (_label, raw, expected) => {
    expect(emittedNames(raw)).toEqual({ unicode: expected, ascii: expected });
  });
});

describe("tên phát ra — N2: dấu chấm / khoảng trắng ở cuối tên", () => {
  it.each([
    ["một dấu chấm", "tep.xyz.", "tep.xyz_"],
    ["nhiều dấu chấm", "tep.xyz...", "tep.xyz_"],
    ["dấu chấm rồi khoảng trắng", "tep.xyz. ", "tep.xyz_"],
    ["khoảng trắng xen dấu chấm", "tep.xyz . .", "tep.xyz_"],
    ["khoảng trắng không ngắt rồi dấu chấm", `tep.xyz${NBSP}.`, "tep.xyz_"],
    ["bắt đầu và kết thúc bằng dấu chấm", ".xyz.", ".xyz_"],
  ])("%s: cả cụm cuối thành MỘT `_`", (_label, raw, expected) => {
    expect(emittedNames(raw)).toEqual({ unicode: expected, ascii: expected });
  });

  it("CHO PHÉP: khoảng trắng thuần ở cuối chỉ bị bỏ — đuôi vẫn là đuôi thật của tên", () => {
    expect(emittedNames("tep.xyz  ")).toEqual({ unicode: "tep.xyz", ascii: "tep.xyz" });
  });
});

describe("tên phát ra — N3: phép cắt 180 byte không sinh đuôi mới", () => {
  it("phần sau dấu chấm cuối dài quá mức giữ đuôi ⇒ tên đã cắt kết thúc bằng `_`", () => {
    const expected = `${"a".repeat(176)}.xy_`;
    expect(emittedNames(`${"a".repeat(176)}.xyz${"z".repeat(9)}`)).toEqual({
      unicode: expected,
      ascii: expected,
    });
  });

  it("chỗ cắt rơi đúng sau một dấu chấm ⇒ dấu chấm cuối thành `_`", () => {
    const raw = `${"a".repeat(175)}.xyz.${"y".repeat(20)}`;
    expect(emittedNames(raw).unicode).toBe(`${"a".repeat(175)}.xyz_`);
  });

  it("CHO PHÉP: đuôi ngắn (≤ 11 ký tự) được giữ NGUYÊN, chỉ thân bị cắt", () => {
    const raw = `${"a".repeat(176)}.xyz${"z".repeat(8)}`;
    expect(emittedNames(raw).unicode).toBe(`${"a".repeat(168)}.xyz${"z".repeat(8)}`);
  });

  it("CHO PHÉP: tên dài không có dấu chấm chỉ bị cắt, không thêm `_`", () => {
    expect(emittedNames("b".repeat(300)).unicode).toBe("b".repeat(180));
  });
});

describe("tên phát ra — N4: ký tự tương thích toàn chiều rộng không thành ASCII", () => {
  it.each([
    ["dấu chấm toàn chiều rộng", `tep${FULLWIDTH_DOT}xyz`, "tep_xyz"],
    ["chữ cái toàn chiều rộng ở đuôi", `tep.${fullwidth("xyz")}`, "tep.___"],
    [
      "gạch chéo toàn chiều rộng",
      `..${FULLWIDTH_SOLIDUS}..${FULLWIDTH_SOLIDUS}tep.pdf`,
      ".._.._tep.pdf",
    ],
    ["dấu chấm dẫn U+2024", `tep${ONE_DOT_LEADER}xyz`, "tep_xyz"],
  ])("%s: dạng dự phòng dùng `_`, dạng Unicode giữ nguyên ký tự gốc", (_label, raw, ascii) => {
    expect(emittedNames(raw)).toEqual({ unicode: raw, ascii });
  });
});

describe("tên phát ra — N5: đuôi có dấu không thành đuôi ASCII", () => {
  it.each([
    ["chữ cuối của đuôi mang dấu sắc", `tep.xy${Z_ACUTE}`, `tep.xy${Z_ACUTE}`, "tep.xy_"],
    [
      "dấu kết hợp rời sau chữ cuối (NFC ghép lại)",
      `tep.xyz${ACUTE}`,
      `tep.xy${Z_ACUTE}`,
      "tep.xy_",
    ],
    ["dấu kết hợp không ghép được ở giữa đuôi", `tep.x${ACUTE}yz`, `tep.x${ACUTE}yz`, "tep.x_yz"],
    ["chữ đ ở đầu đuôi", `tep.${D_STROKE}oc`, `tep.${D_STROKE}oc`, "tep._oc"],
  ])("%s: đuôi KHÔNG được chuyển tự", (_label, raw, unicode, ascii) => {
    expect(emittedNames(raw)).toEqual({ unicode, ascii });
  });

  it("CHO PHÉP: THÂN tên tiếng Việt vẫn được bỏ dấu ở dạng dự phòng", () => {
    expect(emittedNames("Báo cáo – Đặng Thị Ánh.pdf").ascii).toBe("Bao cao _ Dang Thi Anh.pdf");
  });
});

describe("tên phát ra — N6: surrogate lẻ", () => {
  it("giữ phần còn lại của tên + đuôi (không rơi về tên dự phòng)", () => {
    expect(buildAttachmentDisposition(`a${HIGH_SURROGATE}.pdf`)).toBe(
      "attachment; filename=\"a_.pdf\"; filename*=UTF-8''a_.pdf",
    );
  });

  it("surrogate lẻ trong đuôi cũng thành `_`", () => {
    expect(emittedNames(`tep.pd${LOW_SURROGATE}f`)).toEqual({
      unicode: "tep.pd_f",
      ascii: "tep.pd_f",
    });
  });

  it("tên đã qua lưu trữ (surrogate lẻ thành U+FFFD) phát ra Y HỆT tên lúc kiểm", () => {
    const checked = `tep${HIGH_SURROGATE}.xyz`;
    const stored = Buffer.from(checked, "utf8").toString("utf8");
    expect(stored).toBe(`tep${REPLACEMENT_CHAR}.xyz`);
    expect(emittedNames(stored)).toEqual(emittedNames(checked));
    expect(emittedNames(stored).unicode).toBe("tep_.xyz");
  });
});

describe("tên phát ra — N7: tên bắt đầu bằng dấu chấm", () => {
  it("tên dạng «.xyz» được phát nguyên văn và CÓ đuôi `xyz`", () => {
    expect(emittedNames(".xyz")).toEqual({ unicode: ".xyz", ascii: ".xyz" });
    expect(servedFileNameExtensions(".xyz")).toEqual(["xyz"]);
    expect(fileNameExtension(".xyz")).toBe("xyz");
  });
});

describe("servedFileName · fileNameExtension · servedFileNameExtensions", () => {
  it.each(NAME_CASES)(
    "servedFileName — %s: đúng tên của `filename*`, áp lần hai không đổi gì",
    (_label, raw, expected) => {
      expect(servedFileName(raw)).toBe(expected);
      expect(servedFileName(servedFileName(raw))).toBe(expected);
    },
  );

  it("servedFileName / servedFileNameExtensions nhận đầu vào không phải chuỗi mà không ném", () => {
    expect(servedFileName(42)).toBe("download");
    expect(servedFileNameExtensions(undefined)).toEqual([]);
  });

  it.each<[string, string | null]>([
    ["a.pdf", "pdf"],
    ["A.PDF", "pdf"],
    ["a.b.c", "c"],
    ["a.pdf.", "pdf"],
    ["a.pdf . ", "pdf"],
    [".xyz", "xyz"],
    ["a", null],
    ["a.", null],
    ["...", null],
    ["", null],
  ])("fileNameExtension(%j) ⇒ %j", (name, expected) => {
    expect(fileNameExtension(name)).toBe(expected);
  });

  it("fileNameExtension cắt đuôi dài còn 50 ký tự (độ rộng cột lưu)", () => {
    expect(fileNameExtension(`a.${"e".repeat(60)}`)).toBe("e".repeat(50));
  });

  it.each<[string, string, string[]]>([
    ["tên thường", "tep.pdf", ["pdf"]],
    ["không đuôi", "tep", []],
    ["ký tự bị loại trong đuôi", `trang.ht${EMBED_END}ml`, ["ht_ml"]],
    ["ký tự bị loại sau đuôi", `tep.svg${LRM}`, ["svg_"]],
    ["dấu chấm cuối", "tep.xyz.", ["xyz_"]],
    ["khoảng trắng thuần ở cuối", "tep.xyz  ", ["xyz"]],
    ["cắt độ dài", `${"a".repeat(176)}.xyz${"z".repeat(9)}`, ["xy_"]],
    ["dấu chấm toàn chiều rộng", `tep${FULLWIDTH_DOT}xyz`, []],
    ["đuôi có dấu — ĐỦ đuôi của cả hai dạng", `tep.xy${Z_ACUTE}`, [`xy${Z_ACUTE}`, "xy_"]],
    ["surrogate lẻ ở thân", `a${HIGH_SURROGATE}.pdf`, ["pdf"]],
  ])("servedFileNameExtensions — %s", (_label, raw, expected) => {
    expect(servedFileNameExtensions(raw)).toEqual(expected);
  });
});

// ─── NP — ca thuộc tính ────────────────────────────────────────────────────────────────────────────

/** Chép TAY tập đuôi chặn cứng (không import từ nguồn) + vài đuôi thường — các đuôi được THEO DÕI. */
const HARD_BLOCKED = ["html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "xsl", "xslt"];
const ORDINARY = ["pdf", "docx", "xyz"];
const TRACKED = new Set([...HARD_BLOCKED, ...ORDINARY]);

/** Mỗi lớp ký tự bị loại có ít nhất một đại diện. */
const REPLACED_SAMPLES = [
  BELL,
  at(0x007f),
  NEL,
  LINE_SEPARATOR,
  at(0x2029),
  LRM,
  at(0x200f),
  at(0x202a),
  RLO,
  at(0x2066),
  at(0x2069),
  HIGH_SURROGATE,
  LOW_SURROGATE,
  REPLACEMENT_CHAR,
  "\\",
  "/",
];
const TAILS = [
  ".",
  "..",
  " .",
  ". ",
  " . .",
  `${NBSP}.`,
  `.${IDEOGRAPHIC_SPACE}`,
  LRM,
  `.${LRM}`,
  `${LRM}.`,
];
const DOT_LOOKALIKES = [FULLWIDTH_DOT, ONE_DOT_LEADER, at(0xfe52), at(0xff61)];

/** Corpus tên bất thường cho MỘT đuôi: mỗi lớp N1–N7 góp vài tên. */
function adversarialNames(extension: string): string[] {
  const last = extension.length - 1;
  return [
    `tep.${extension.slice(0, last)}${LRM}${extension.slice(last)}`,
    `tep.${extension}${LRM}`,
    `tep.${extension}${NEL}`,
    `tep.${extension}${LINE_SEPARATOR}`,
    `tep.${extension}.`,
    `tep.${extension} . .`,
    `.${extension}`,
    `.${extension}.`,
    `${"a".repeat(180 - extension.length)}.${extension}`,
    `${"a".repeat(179 - extension.length)}.${extension}${"z".repeat(12)}`,
    `tep${FULLWIDTH_DOT}${extension}`,
    `tep.${fullwidth(extension)}`,
    `tep.${extension}${ACUTE}`,
    `tep.${extension.slice(0, last)}${HIGH_SURROGATE}${extension.slice(last)}`,
    `tep${HIGH_SURROGATE}.${extension}`,
  ];
}

/** Bộ sinh tổ hợp XÁC ĐỊNH (không ngẫu nhiên): ký tự bị loại ở MỌI vị trí, mọi kiểu đuôi tên, quét chỗ cắt. */
function* generatedNames(extension: string): Generator<string> {
  for (const sample of REPLACED_SAMPLES) {
    for (let index = 0; index <= extension.length; index += 1) {
      yield `tep.${extension.slice(0, index)}${sample}${extension.slice(index)}`;
    }
    yield `tep${sample}.${extension}`;
    yield `${sample}tep.${extension}`;
  }
  for (const tail of TAILS) {
    yield `tep.${extension}${tail}`;
    yield `.${extension}${tail}`;
  }
  for (const dot of DOT_LOOKALIKES) {
    yield `tep${dot}${extension}`;
    yield `tep${dot}${fullwidth(extension)}`;
  }
  for (let index = 0; index < extension.length; index += 1) {
    yield `tep.${extension.slice(0, index + 1)}${ACUTE}${extension.slice(index + 1)}`;
    yield `tep.${extension.slice(0, index)}${fullwidth(extension.charAt(index))}${extension.slice(index + 1)}`;
  }
  for (const [unit, unitBytes] of [
    ["a", 1],
    ["ă", 2],
    ["あ", 3],
    ["😀", 4],
  ] as const) {
    for (
      let count = Math.floor(164 / unitBytes);
      count <= Math.floor(184 / unitBytes);
      count += 1
    ) {
      for (let tail = 0; tail <= 13; tail += 1) {
        yield `${unit.repeat(count)}.${extension}${"z".repeat(tail)}`;
        yield `${unit.repeat(count)}.${extension}.${"y".repeat(tail + 6)}`;
      }
    }
  }
}

const CORPUS: readonly string[] = [...TRACKED].flatMap((extension) => adversarialNames(extension));
const GENERATED: readonly string[] = [...TRACKED].flatMap((extension) => [
  ...generatedNames(extension),
]);

/** In một tên với ký tự ngoài ASCII in được ở dạng điểm mã, rút gọn phần lặp. */
function show(name: string): string {
  const text = Array.from(name, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint <= 0x7e
      ? char
      : `<U+${codePoint.toString(16).toUpperCase()}>`;
  }).join("");
  return text.length > 80 ? `${text.slice(0, 12)}…(${name.length} ký tự)…${text.slice(-40)}` : text;
}

/** Đuôi hệ điều hành gán khi LƯU một tên: bỏ dấu chấm / dấu cách cuối, phần sau dấu chấm CUỐI. Viết ĐỘC LẬP với nguồn. */
function savedExtension(name: string): string | null {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === " ")) end -= 1;
  const base = name.slice(0, end);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? null : base.slice(dot + 1).toLowerCase();
}

/** Đuôi mà một phép kiểm ĐƠN GIẢN đọc được trên tên thô: phần sau dấu chấm cuối — không bỏ, không thay gì. */
function plainExtension(rawName: string): string | null {
  const text = rawName.normalize("NFC").trim();
  const dot = text.lastIndexOf(".");
  return dot < 0 ? null : text.slice(dot + 1).toLowerCase();
}

/** Số tên mà ít nhất một dạng phát ra mang đuôi được theo dõi — chống ca xanh vì không tên nào tới nhánh so. */
function countEmittingTracked(names: readonly string[]): number {
  return names.filter((name) => {
    const { unicode, ascii } = emittedNames(name);
    return [unicode, ascii].some((emitted) => TRACKED.has(savedExtension(emitted) ?? ""));
  }).length;
}

describe("tên phát ra — NP: ca thuộc tính (corpus + bộ sinh tổ hợp xác định)", () => {
  it("corpus ≥ 60 tên, bộ sinh ≥ 5.000 tên; có tên giữ đuôi được theo dõi và có tên bị vô hiệu đuôi", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(60);
    expect(GENERATED.length).toBeGreaterThanOrEqual(5000);
    const all = [...CORPUS, ...GENERATED];
    const emitting = countEmittingTracked(all);
    expect(emitting).toBeGreaterThan(100);
    expect(all.length - emitting).toBeGreaterThan(1000);
  });

  it.each([
    ["corpus", CORPUS],
    ["bộ sinh", GENERATED],
  ])(
    "%s — đuôi được theo dõi CHỈ xuất hiện ở tên phát ra khi tên thô đã mang đúng đuôi đó (không dạng nào sinh đuôi mới)",
    (_label, names) => {
      const violations: string[] = [];
      for (const name of names) {
        const { unicode, ascii } = emittedNames(name);
        for (const [form, emitted] of [
          ["filename*", unicode],
          ["filename=", ascii],
        ] as const) {
          const extension = savedExtension(emitted);
          if (extension !== null && TRACKED.has(extension) && extension !== plainExtension(name)) {
            violations.push(`${show(name)} ⇒ ${form} mang đuôi "${extension}"`);
          }
        }
      }
      expect(violations.slice(0, 5)).toEqual([]);
    },
  );

  it.each([
    ["corpus", CORPUS],
    ["bộ sinh", GENERATED],
  ])(
    "%s — đuôi của MỖI dạng phát ra thuộc servedFileNameExtensions(tên); `filename*` giải mã ra đúng servedFileName(tên)",
    (_label, names) => {
      const violations: string[] = [];
      for (const name of names) {
        const { unicode, ascii } = emittedNames(name);
        const checked = servedFileNameExtensions(name);
        if (unicode !== servedFileName(name))
          violations.push(`${show(name)} ⇒ filename* lệch tên chuẩn`);
        for (const [form, emitted] of [
          ["filename*", unicode],
          ["filename=", ascii],
        ] as const) {
          const extension = savedExtension(emitted);
          if (extension !== null && !checked.includes(extension)) {
            violations.push(`${show(name)} ⇒ ${form} mang đuôi "${extension}" ngoài tập đã kiểm`);
          }
        }
      }
      expect(violations.slice(0, 5)).toEqual([]);
    },
  );

  it.each([
    ["corpus", CORPUS],
    ["bộ sinh", GENERATED],
  ])(
    "%s — tên chuẩn: ≤ 180 byte, không kết thúc bằng dấu chấm / khoảng trắng, bất động, không đổi sau khi qua lưu trữ; header ASCII",
    (_label, names) => {
      const violations: string[] = [];
      for (const name of names) {
        const served = servedFileName(name);
        const stored = Buffer.from(name, "utf8").toString("utf8");
        if (Buffer.byteLength(served, "utf8") > 180)
          violations.push(`${show(name)} ⇒ dài quá 180 byte`);
        if (/[.\s]$/.test(served))
          violations.push(`${show(name)} ⇒ kết thúc bằng dấu chấm / khoảng trắng`);
        if (servedFileName(served) !== served) violations.push(`${show(name)} ⇒ không bất động`);
        if (servedFileName(stored) !== served)
          violations.push(`${show(name)} ⇒ đổi sau khi qua lưu trữ`);
        if (!PRINTABLE_ASCII.test(buildAttachmentDisposition(name))) {
          violations.push(`${show(name)} ⇒ header ngoài ASCII in được`);
        }
      }
      expect(violations.slice(0, 5)).toEqual([]);
    },
  );
});
