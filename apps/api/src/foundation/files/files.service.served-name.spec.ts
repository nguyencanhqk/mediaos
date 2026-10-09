/**
 * S16-SOCIAL-FILEDISPOSITION-1 — FileService.upload: đuôi của tên SẼ PHÁT RA khi tải về là đuôi đã kiểm lúc
 * đăng ký (unit cạnh nguồn, không DB, không storage thật).
 *
 * File RIÊNG để `files.service.content-type.spec.ts` không vượt trần độ dài. Mỗi ca đăng ký một tên rồi — nếu
 * được nhận — dựng lại `Content-Disposition` từ ĐÚNG hàng đã ghi, qua đúng hàm tầng ký gọi
 * (`resolveServeDirectives`), và đọc đuôi của cả hai dạng tên bằng một hàm viết độc lập với nguồn.
 *
 * Ba kết cục của một tên CÓ dấu chấm:
 *   - đuôi không phải 1–16 chữ cái ASCII / chữ số ⇒ 415 EXTENSION, không ghi hàng;
 *   - đuôi đúng dạng nhưng thuộc tập chặn cứng HOẶC `file.blocked_extensions` của công ty ⇒ 415 BLOCKED;
 *   - còn lại ⇒ nhận; đuôi lưu = đuôi của cả hai dạng tên phát ra.
 * Tên KHÔNG có dấu chấm được nhận như tệp không đuôi.
 *
 * Ký tự đặc biệt trong ca được dựng từ ĐIỂM MÃ (`at(0x…)`) — tệp nguồn không chứa ký tự vô hình.
 */
import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { resolveServeDirectives } from "../../storage/content-serving";
import { FileService } from "./files.service";

const user = {
  id: "22222222-2222-2222-2222-222222222222",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const CODE_BLOCKED = "FOUNDATION-FILE-ERR-BLOCKED";
const CODE_EXTENSION = "FOUNDATION-FILE-ERR-EXTENSION";
const MIME_ZIP = "application/zip";
const MIME_PDF = "application/pdf";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const at = (codePoint: number): string => String.fromCodePoint(codePoint);
const LRM = at(0x200e); // dấu chiều chữ
const EMBED_END = at(0x202c); // kết thúc nhúng chiều chữ
const HIGH_SURROGATE = at(0xd83d); // surrogate lẻ
const FULLWIDTH_DOT = at(0xff0e);
const G_ACUTE = at(0x01f5); // chữ g mang dấu sắc
const Z_ACUTE = at(0x017a); // chữ z mang dấu sắc
const fullwidth = (text: string): string =>
  Array.from(text, (char) => at(char.charCodeAt(0) + 0xfee0)).join("");

/** Đuôi hệ điều hành gán khi LƯU một tên: bỏ dấu chấm / dấu cách cuối, phần sau dấu chấm CUỐI. Độc lập với nguồn. */
function savedExtension(name: string): string | null {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === " ")) end -= 1;
  const base = name.slice(0, end);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? null : base.slice(dot + 1).toLowerCase();
}

/** Đuôi của HAI dạng tên mà URL tải của một hàng sẽ mang: [`filename=`, `filename*`]. */
function servedExtensions(mimeType: string, storedName: string): Array<string | null> {
  const header = resolveServeDirectives(mimeType, storedName).responseContentDisposition ?? "";
  const match = /^attachment; filename="([^"]*)"; filename\*=UTF-8''(.*)$/.exec(header);
  if (match === null) throw new Error(`không phải Content-Disposition dạng attachment: ${header}`);
  return [match[1] ?? "", decodeURIComponent(match[2] ?? "")].map(savedExtension);
}

/** Mã `FOUNDATION-FILE-ERR-*` trong thân một HttpException; lỗi khác ⇒ "unexpected-error". */
function responseCode(err: unknown): string {
  const body = err instanceof HttpException ? err.getResponse() : null;
  return typeof body === "object" && body !== null && "code" in body
    ? String(body.code)
    : "unexpected-error";
}

/** Mã HTTP + câu trả cho client của một HttpException; lỗi khác ⇒ mã 0, câu rỗng. */
function responseDetail(err: unknown): { status: number; message: string } {
  if (!(err instanceof HttpException)) return { status: 0, message: "" };
  const body = err.getResponse();
  const message =
    typeof body === "object" && body !== null && "message" in body ? String(body.message) : "";
  return { status: err.getStatus(), message };
}

/** FileService với mọi cộng tác viên là `vi.fn`; `withTenant` chạy callback với một tx giả. */
function makeService(blockedExtensions: string[]) {
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const fileRepo = { insertTx: vi.fn(async (row: Record<string, unknown>) => row) };
  const recorder = { record: vi.fn(async () => undefined) };
  const settings = {
    resolveMany: vi.fn(async () => [
      { key: "file.allowed_mime_types", value: [MIME_ZIP, MIME_PDF, MIME_XLSX], found: true },
      { key: "file.max_upload_size_mb", value: 25, found: true },
      { key: "file.blocked_extensions", value: blockedExtensions, found: true },
    ]),
  };
  const storage = {
    signedUrl: vi.fn(async () => ({
      url: "https://signed.example/put",
      expiresAt: new Date("2026-10-08T00:05:00Z"),
    })),
  };
  const service = new FileService(
    db as never,
    fileRepo as never,
    {} as never,
    recorder as never,
    recorder as never,
    {} as never,
    settings as never,
    storage as never,
  );
  return { service, fileRepo, storage };
}

/** Đăng ký một tên; nếu được nhận thì đọc đuôi sẽ phát ra từ ĐÚNG hàng đã ghi. */
async function registerName(originalName: string, declaredMimeType: string, blocked: string[]) {
  const { service, fileRepo, storage } = makeService(blocked);
  const outcome = await service
    .upload(user, { originalName, declaredMimeType, sizeBytes: 1024, visibility: "Private" })
    .then(() => "accepted", responseCode);
  const stored = fileRepo.insertTx.mock.calls[0]?.[0] as
    | { originalName: string; fileExtension: string | null }
    | undefined;
  const served = stored ? servedExtensions(declaredMimeType, stored.originalName) : [];
  return { outcome, stored, served, signCalls: storage.signedUrl.mock.calls.length };
}

describe("FileService.upload — đuôi chặn cứng (blocked_extensions của công ty RỖNG)", () => {
  it.each([
    ["tên bắt đầu bằng dấu chấm", ".svg"],
    ["tên bắt đầu bằng dấu chấm (đuôi khác)", ".html"],
    ["ký tự bị loại nằm NGOÀI đuôi", `tep${LRM}.svg`],
    ["khoảng trắng thuần ở cuối", "tep.svg  "],
    ["tên dài, đuôi ngắn được giữ khi cắt", `${"a".repeat(300)}.svg`],
    ["ký tự toàn chiều rộng ở thân", `tep${FULLWIDTH_DOT}.svg`],
    ["surrogate lẻ ở thân", `tep${HIGH_SURROGATE}.svg`],
  ])("TỪ CHỐI — %s ⇒ 415 BLOCKED, không ghi hàng, không ký", async (_label, originalName) => {
    const attempt = await registerName(originalName, MIME_ZIP, []);

    expect(attempt.outcome).toBe(CODE_BLOCKED);
    expect(attempt.stored).toBeUndefined();
    expect(attempt.signCalls).toBe(0);
  });

  it.each([
    ["ký tự bị loại TRONG đuôi", `tep.sv${LRM}g`],
    ["ký tự bị loại ngay SAU đuôi", `tep.svg${LRM}`],
    ["ký tự bị loại trong đuôi (đuôi khác)", `trang.ht${EMBED_END}ml`],
    ["dấu chấm cuối", "tep.svg."],
    ["dấu chấm xen khoảng trắng ở cuối", "tep.svg. ."],
    ["chỗ cắt độ dài rơi ngay sau một đuôi ngắn", `${"a".repeat(176)}.svg${"z".repeat(9)}`],
    ["chữ cái toàn chiều rộng ở đuôi", `tep.${fullwidth("svg")}`],
    ["chữ cái toàn chiều rộng ở đuôi (đuôi khác)", `tep.${fullwidth("svgx")}`],
    ["chữ cuối của đuôi mang dấu", `tep.sv${G_ACUTE}`],
    ["surrogate lẻ trong đuôi", `tep.sv${HIGH_SURROGATE}g`],
  ])("TỪ CHỐI — %s ⇒ 415 EXTENSION, không ghi hàng, không ký", async (_label, originalName) => {
    const attempt = await registerName(originalName, MIME_ZIP, []);

    expect(attempt.outcome).toBe(CODE_EXTENSION);
    expect(attempt.stored).toBeUndefined();
    expect(attempt.signCalls).toBe(0);
  });

  it("CHO PHÉP — dấu chấm toàn chiều rộng ⇒ tên không có dấu chấm, nhận như tệp không đuôi", async () => {
    const attempt = await registerName(`tep${FULLWIDTH_DOT}svg`, MIME_ZIP, []);

    expect(attempt.outcome).toBe("accepted");
    expect(attempt.served).toEqual([null, null]);
    expect(attempt.stored?.fileExtension).toBeNull();
  });
});

describe("FileService.upload — đuôi CHỈ có trong blocked_extensions của công ty", () => {
  it.each([
    ["tên thường", "tep.xyz"],
    ["chữ hoa", "TEP.XYZ"],
    ["tên bắt đầu bằng dấu chấm", ".xyz"],
    ["surrogate lẻ ở thân", `tep${HIGH_SURROGATE}.xyz`],
  ])("TỪ CHỐI — %s ⇒ 415 BLOCKED, không ghi hàng", async (_label, originalName) => {
    const attempt = await registerName(originalName, MIME_ZIP, ["xyz"]);

    expect(attempt.outcome).toBe(CODE_BLOCKED);
    expect(attempt.stored).toBeUndefined();
  });

  it.each([
    ["ký tự bị loại trong đuôi", `tep.xy${LRM}z`],
    ["dấu chấm cuối", "tep.xyz."],
    ["chỗ cắt độ dài rơi ngay sau đuôi", `${"a".repeat(176)}.xyz${"z".repeat(9)}`],
    ["chữ cuối của đuôi mang dấu", `tep.xy${Z_ACUTE}`],
  ])("TỪ CHỐI — %s ⇒ 415 EXTENSION, không ghi hàng", async (_label, originalName) => {
    const attempt = await registerName(originalName, MIME_ZIP, ["xyz"]);

    expect(attempt.outcome).toBe(CODE_EXTENSION);
    expect(attempt.stored).toBeUndefined();
  });

  it("TỪ CHỐI: đuôi mang chữ có dấu ⇒ 415 EXTENSION, kể cả khi dạng dự phòng ASCII của nó nằm trong blocked_extensions", async () => {
    const attempt = await registerName(`tep.xy${Z_ACUTE}`, MIME_ZIP, ["xy_"]);

    expect(attempt.outcome).toBe(CODE_EXTENSION);
    expect(attempt.stored).toBeUndefined();
  });

  it("CHO PHÉP — dấu chấm toàn chiều rộng ⇒ tên không có dấu chấm, nhận như tệp không đuôi", async () => {
    const attempt = await registerName(`tep${FULLWIDTH_DOT}xyz`, MIME_ZIP, ["xyz"]);

    expect(attempt.outcome).toBe("accepted");
    expect(attempt.served).toEqual([null, null]);
    expect(attempt.stored?.fileExtension).toBeNull();
  });
});

describe("FileService.upload — đuôi phải là 1–16 chữ cái ASCII / chữ số (kiểu khai ngoài bảng đuôi ↔ MIME)", () => {
  const COMPANY_BLOCKED = ["xyz", "xis"];
  const codePointLabel = (codePoint: number): string =>
    `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const END_MARK = at(0x180e);
  const LONG_S = at(0x017f);
  const DOTLESS_I = at(0x0131);
  const ZERO_WIDTH_SPACE = at(0x200b);
  const RESERVED_PUNCTUATION = [":", "*", "?", '"', "<", ">", "|"];
  const INVISIBLE_FORMAT = [0x200b, 0x200d, 0x2060, 0x00ad, 0x061c];

  /** [nhãn, tên] — mỗi lớp một đuôi thuộc tập chặn cứng (`svg`) và một đuôi chỉ có trong tập của công ty. */
  const MARK_IN_EXTENSION: Array<[string, string]> = [
    ["lớp 1 — U+180E sau đuôi chặn cứng", `tep.svg${END_MARK}`],
    ["lớp 1 — U+180E sau đuôi của tập công ty", `tep.xyz${END_MARK}`],
    ["lớp 1 — U+180E sau một đuôi thường", `tep.zip${END_MARK}`],
    ...RESERVED_PUNCTUATION.flatMap(
      (mark): Array<[string, string]> => [
        [`lớp 2 — dấu ${mark} sau đuôi chặn cứng`, `tep.svg${mark}`],
        [`lớp 2 — dấu ${mark} sau đuôi của tập công ty`, `tep.xyz${mark}`],
      ],
    ),
    ["lớp 2 — dấu câu sau một đuôi thường", "tep.zip?"],
    ["lớp 3 — U+017F trong đuôi chặn cứng", `tep.${LONG_S}vg`],
    ["lớp 3 — U+017F trong đuôi của tập công ty", `tep.xi${LONG_S}`],
    // Tập chặn cứng không có đuôi nào chứa chữ `i` ⇒ U+0131 chỉ thử được với tập của công ty.
    ["lớp 3 — U+0131 trong đuôi của tập công ty", `tep.x${DOTLESS_I}s`],
    ["lớp 3 — U+017F trong một đuôi thường", `tep.${LONG_S}vgx`],
    ...INVISIBLE_FORMAT.flatMap(
      (codePoint): Array<[string, string]> => [
        [`lớp 4 — ${codePointLabel(codePoint)} giữa đuôi chặn cứng`, `tep.sv${at(codePoint)}g`],
        [
          `lớp 4 — ${codePointLabel(codePoint)} giữa đuôi của tập công ty`,
          `tep.xy${at(codePoint)}z`,
        ],
      ],
    ),
    ["lớp 4 — ký tự định dạng giữa một đuôi thường", `tep.zi${ZERO_WIDTH_SPACE}p`],
    ["dấu câu giữa đuôi", "tep.svg?x"],
    ["khoảng trắng + ngoặc sau đuôi", "tep.xyz (1)"],
    ["dấu câu giữa một đuôi thường", "tep.sv?gx"],
  ];

  /** [nhãn, tên] — đoạn đứng sau dấu chấm CUỐI không phải một đuôi. */
  const LAST_SEGMENT_NOT_AN_EXTENSION: Array<[string, string]> = [
    ["đoạn cuối chỉ một dấu câu", "tep.svg.?"],
    ["đoạn cuối chỉ U+180E", `tep.svg.${END_MARK}`],
    ["đoạn cuối chỉ U+200B", `tep.svg.${ZERO_WIDTH_SPACE}`],
    ["đoạn cuối chỉ một dấu câu (tên mang đuôi của tập công ty)", "tep.xyz.?"],
    ["đoạn cuối là một dấu câu, lặp hai lần", "tep.svg.?.?"],
    ["đoạn cuối là khoảng trắng rồi dấu câu", "tep.svg. ?"],
    ["đoạn cuối là dấu câu rồi chữ", "tep.svg.?x"],
    ["đoạn cuối là khoảng trắng rồi chữ", "tep.svg. ban cuoi"],
    ["tên dạng câu, phần sau dấu chấm không phải đuôi", "Ghi chu. Ban cuoi"],
    ["đuôi có gạch dưới", "tep.x_t"],
    ["đuôi dài 17 ký tự", `tep.${"a".repeat(17)}`],
  ];

  it.each([...MARK_IN_EXTENSION, ...LAST_SEGMENT_NOT_AN_EXTENSION])(
    "TỪ CHỐI — %s ⇒ 415 EXTENSION, không ghi hàng, không ký",
    async (_label, originalName) => {
      const attempt = await registerName(originalName, MIME_ZIP, COMPANY_BLOCKED);

      expect(attempt.outcome).toBe(CODE_EXTENSION);
      expect(attempt.stored).toBeUndefined();
      expect(attempt.signCalls).toBe(0);
    },
  );

  it.each<[string, string, string | null]>([
    ["tên tiếng Việt có dấu, đuôi thường", "Hồ sơ dự thầu – Đặng Thị Ánh.zip", "zip"],
    ["dấu chấm giữa câu, phần sau là chữ số", "Bien ban hop 12.10", "10"],
    ["nhiều dấu chấm ở thân", "Bien ban hop 12.10.zip", "zip"],
    ["hai đuôi", "a.tar.gz", "gz"],
    ["số trong ngoặc ở thân", "anh (1).png", "png"],
    ["chữ hoa", "ANH.PNG", "png"],
    ["tên không có dấu chấm", "tep-khong-duoi", null],
    ["ký tự định dạng ở THÂN, đuôi thường", `te${ZERO_WIDTH_SPACE}p.zip`, "zip"],
    ["dấu câu ở THÂN, đuôi thường", "te?p.zip", "zip"],
    ["đuôi dài 16 ký tự", `tep.${"a".repeat(16)}`, "a".repeat(16)],
  ])(
    "CHO PHÉP — %s ⇒ nhận; đuôi lưu = đuôi của cả hai dạng tên phát ra; tên gốc lưu NGUYÊN",
    async (_label, originalName, fileExtension) => {
      const attempt = await registerName(originalName, MIME_ZIP, COMPANY_BLOCKED);

      expect(attempt.outcome).toBe("accepted");
      expect(attempt.served).toEqual([fileExtension, fileExtension]);
      expect(attempt.stored?.fileExtension).toBe(fileExtension);
      expect(attempt.stored?.originalName).toBe(originalName);
      expect(attempt.signCalls).toBe(1);
    },
  );

  it("câu trả 415 của đuôi không hợp lệ là câu cố định — không chép lại tên hay đuôi đã gửi", async () => {
    const { service } = makeService([]);

    const detail = await service
      .upload(user, {
        originalName: "tep.x_t",
        declaredMimeType: MIME_ZIP,
        sizeBytes: 1024,
        visibility: "Private",
      })
      .then(() => ({ status: 0, message: "accepted" }), responseDetail);

    expect(detail.status).toBe(415);
    expect(detail.message).toContain(`${CODE_EXTENSION}: phần mở rộng của tên tệp không hợp lệ`);
    expect(detail.message).not.toContain("x_t");
    expect(detail.message).not.toContain("tep");
  });
});

describe("FileService.upload — tên hợp lệ sát cạnh vẫn được nhận", () => {
  it.each<[string, string, string, string]>([
    ["tên nhiều dấu chấm", "bao.cao.quy-3.v2.pdf", MIME_PDF, "pdf"],
    ["tên tiếng Việt có dấu", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf", MIME_PDF, "pdf"],
    ["tên 300 ký tự", `${"ă".repeat(295)}.xlsx`, MIME_XLSX, "xlsx"],
    ["tên bắt đầu bằng dấu chấm, đuôi thường", ".pdf", MIME_PDF, "pdf"],
    ["surrogate lẻ ở thân, đuôi thường", `tep${HIGH_SURROGATE}.pdf`, MIME_PDF, "pdf"],
    ["đuôi viết hoa", "BIEN-BAN.PDF", MIME_PDF, "pdf"],
  ])(
    "CHO PHÉP — %s ⇒ nhận; đuôi lưu = đuôi của cả hai dạng tên phát ra; tên gốc lưu NGUYÊN",
    async (_label, originalName, declaredMimeType, fileExtension) => {
      const attempt = await registerName(originalName, declaredMimeType, ["xyz"]);

      expect(attempt.outcome).toBe("accepted");
      expect(attempt.served).toEqual([fileExtension, fileExtension]);
      expect(attempt.stored?.fileExtension).toBe(fileExtension);
      expect(attempt.stored?.originalName).toBe(originalName);
      expect(attempt.signCalls).toBe(1);
    },
  );

  it("tên kết thúc bằng dấu chấm sau một đuôi ⇒ 415 EXTENSION (đuôi sẽ phát ra không còn là đuôi của kiểu đã khai)", async () => {
    const attempt = await registerName("tep.pdf.", MIME_PDF, []);

    expect(attempt.outcome).toBe(CODE_EXTENSION);
    expect(attempt.stored).toBeUndefined();
  });
});
