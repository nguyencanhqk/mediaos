/**
 * S16-SOCIAL-FILEDISPOSITION-1 — FileService.upload: đuôi của tên SẼ PHÁT RA khi tải về là đuôi đã qua tập
 * chặn (unit cạnh nguồn, không DB, không storage thật).
 *
 * File RIÊNG để `files.service.content-type.spec.ts` không vượt trần độ dài. Mỗi ca đăng ký một tên rồi — nếu
 * được nhận — dựng lại `Content-Disposition` từ ĐÚNG hàng đã ghi, qua đúng hàm tầng ký gọi
 * (`resolveServeDirectives`), và đọc đuôi của cả hai dạng tên bằng một hàm viết độc lập với nguồn.
 *
 * F8 — với mỗi lớp tên (ký tự bị loại · dấu chấm cuối · cắt độ dài · ký tự tương thích · đuôi có dấu ·
 * surrogate lẻ · tên bắt đầu bằng dấu chấm), cặp TỪ CHỐI ⇄ CHO PHÉP cho đuôi thuộc tập chặn cứng và cho đuôi
 * chỉ có trong `file.blocked_extensions` của công ty:
 *   - tên mà một dạng phát ra còn mang đuôi bị chặn ⇒ 415 BLOCKED, không ghi hàng;
 *   - tên được nhận ⇒ KHÔNG dạng phát ra nào mang đuôi bị chặn (đuôi đã bị vô hiệu bằng `_`).
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

/** Chép TAY tập đuôi chặn cứng — không import từ nguồn. */
const HARD_BLOCKED_EXTENSIONS = "html htm xhtml xht shtml svg svgz xml xsl xslt".split(" ");

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

describe("FileService.upload — F8: đuôi chặn cứng (blocked_extensions của công ty RỖNG)", () => {
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

  it.each<[string, string, string | null]>([
    ["ký tự bị loại TRONG đuôi", `tep.sv${LRM}g`, "sv_g"],
    ["ký tự bị loại ngay SAU đuôi", `tep.svg${LRM}`, "svg_"],
    ["ký tự bị loại trong đuôi (đuôi khác)", `trang.ht${EMBED_END}ml`, "ht_ml"],
    ["dấu chấm cuối", "tep.svg.", "svg_"],
    ["dấu chấm xen khoảng trắng ở cuối", "tep.svg. .", "svg_"],
    ["chỗ cắt độ dài rơi ngay sau một đuôi ngắn", `${"a".repeat(176)}.svg${"z".repeat(9)}`, "sv_"],
    ["dấu chấm toàn chiều rộng", `tep${FULLWIDTH_DOT}svg`, null],
    ["chữ cái toàn chiều rộng ở đuôi", `tep.${fullwidth("svg")}`, fullwidth("svg")],
    ["chữ cuối của đuôi mang dấu", `tep.sv${G_ACUTE}`, `sv${G_ACUTE}`],
    ["surrogate lẻ trong đuôi", `tep.sv${HIGH_SURROGATE}g`, "sv_g"],
  ])(
    "CHO PHÉP, đuôi đã VÔ HIỆU — %s ⇒ nhận; không dạng tên phát ra nào mang đuôi chặn cứng",
    async (_label, originalName, fileExtension) => {
      const attempt = await registerName(originalName, MIME_ZIP, []);

      expect(attempt.outcome).toBe("accepted");
      expect(attempt.served).toHaveLength(2);
      expect(
        attempt.served.filter((extension) => HARD_BLOCKED_EXTENSIONS.includes(extension ?? "")),
      ).toEqual([]);
      expect(attempt.stored?.fileExtension).toBe(fileExtension);
    },
  );
});

describe("FileService.upload — F8: đuôi CHỈ có trong blocked_extensions của công ty", () => {
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

  it.each<[string, string, string | null]>([
    ["ký tự bị loại trong đuôi", `tep.xy${LRM}z`, "xy_z"],
    ["dấu chấm cuối", "tep.xyz.", "xyz_"],
    ["chỗ cắt độ dài rơi ngay sau đuôi", `${"a".repeat(176)}.xyz${"z".repeat(9)}`, "xy_"],
    ["dấu chấm toàn chiều rộng", `tep${FULLWIDTH_DOT}xyz`, null],
    ["chữ cuối của đuôi mang dấu", `tep.xy${Z_ACUTE}`, `xy${Z_ACUTE}`],
  ])(
    "CHO PHÉP, đuôi đã VÔ HIỆU — %s ⇒ nhận; không dạng tên phát ra nào mang đuôi `xyz`",
    async (_label, originalName, fileExtension) => {
      const attempt = await registerName(originalName, MIME_ZIP, ["xyz"]);

      expect(attempt.outcome).toBe("accepted");
      expect(attempt.served).toHaveLength(2);
      expect(attempt.served.filter((extension) => extension === "xyz")).toEqual([]);
      expect(attempt.stored?.fileExtension).toBe(fileExtension);
    },
  );

  it("TỪ CHỐI: đuôi của dạng dự phòng ASCII nằm trong blocked_extensions dù đuôi của dạng Unicode thì không", async () => {
    const attempt = await registerName(`tep.xy${Z_ACUTE}`, MIME_ZIP, ["xy_"]);

    expect(attempt.outcome).toBe(CODE_BLOCKED);
    expect(attempt.stored).toBeUndefined();
  });
});

describe("FileService.upload — F8: tên hợp lệ sát cạnh vẫn được nhận", () => {
  it.each<[string, string, string, string]>([
    ["tên nhiều dấu chấm", "bao.cao.quy-3.v2.pdf", MIME_PDF, "pdf"],
    ["tên tiếng Việt có dấu", "Báo cáo tháng 10 – Đặng Thị Ánh.pdf", MIME_PDF, "pdf"],
    ["tên 300 ký tự", `${"ă".repeat(295)}.xlsx`, MIME_XLSX, "xlsx"],
    ["tên bắt đầu bằng dấu chấm, đuôi thường", ".pdf", MIME_PDF, "pdf"],
    ["surrogate lẻ ở thân, đuôi thường", `tep${HIGH_SURROGATE}.pdf`, MIME_PDF, "pdf"],
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

  it("tên kết thúc bằng dấu chấm + kiểu có bảng đuôi ⇒ 415 EXTENSION (đuôi sẽ phát ra không còn là đuôi của kiểu đã khai)", async () => {
    const attempt = await registerName("tep.pdf.", MIME_PDF, []);

    expect(attempt.outcome).toBe(CODE_EXTENSION);
    expect(attempt.stored).toBeUndefined();
  });
});
