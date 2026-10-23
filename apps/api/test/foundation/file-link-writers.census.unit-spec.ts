/**
 * S19-SEC-FILELINKPATHS-1 D-10 — census các đường GHI `file_links` trong `apps/api/src`.
 *
 * Bất biến: mọi đường tạo liên kết cho một tệp do người dùng chọn đi qua cùng một quyết định XEM của người
 * gắn (`FileService.preflightLinkerView` ngoài tx + `FileService.recheckLinkerViewTx` trong tx ghi), hoặc —
 * với đường SOCIAL — qua hàm thuần chung `isOwnerOfUnlinkedFile`. Khoá theo KÝ HIỆU trong mã (không theo tên
 * hàm ghi): một tệp ghi mới, hay một tệp ghi đã biết mà người gọi bỏ lời gọi hàm chung, đều đỏ tới khi được
 * phân loại ở bảng dưới.
 *
 * Bốn luật quét (đã bỏ comment, bỏ `*.spec.ts`):
 *   (i)   tệp có `.insert(fileLinks)` hoặc `INSERT INTO file_links` ⇒ phải nằm trong bảng;
 *   (ii)  tệp import `FileLinkRepository` VÀ gọi `.insertTx(` ⇒ phải nằm trong bảng;
 *   (iii) `.update(fileLinks)` mà `.set({…})` mang `deletedAt: null`, `fileId` hoặc `entityId` (hồi sinh /
 *         trỏ lại liên kết) ⇒ đỏ, không có miễn trừ;
 *   (iv)  tệp gọi `.<hàm ghi>(` của một tệp ghi (bảng `WRITE_METHODS`) ⇒ phải là tệp gọi đã phân loại của tệp ghi
 *         đó — một service mới tiêm repo/service ghi rồi gọi thẳng hàm ghi (không import `FileLinkRepository`,
 *         không có `.insert(fileLinks)`) đỏ ở đây, không lọt qua (i)/(ii).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

const PREFLIGHT = "preflightLinkerView(";
const RECHECK = "recheckLinkerViewTx(";
const OWNER_UNLINKED = "isOwnerOfUnlinkedFile(";

/** Tệp ghi → tệp gọi phải chứa đủ các ký hiệu. `null` = miễn có chủ đích (lý do ghi cạnh). */
const WRITERS: Record<string, { caller: string; symbols: readonly string[] } | null> = {
  "foundation/files/file-link.repository.ts": {
    caller: "foundation/files/files.service.ts",
    symbols: [RECHECK],
  },
  "foundation/files/files.service.ts": {
    caller: "foundation/files/files.service.ts",
    symbols: [RECHECK],
  },
  "chat/chat-attachments.repository.ts": {
    caller: "chat/chat-messages.service.ts",
    symbols: [PREFLIGHT, RECHECK],
  },
  "chat/chat-room-avatar.service.ts": {
    caller: "chat/chat-room-avatar.service.ts",
    symbols: [PREFLIGHT, RECHECK],
  },
  "employees/hr-employee-avatar.service.ts": {
    caller: "employees/hr-employee-avatar.service.ts",
    symbols: [PREFLIGHT, RECHECK],
  },
  "social/social-attachments.service.ts": {
    caller: "social/social-attachments.service.ts",
    symbols: [OWNER_UNLINKED],
  },
  // D-9: tạo hàng `files` MỚI cùng tx với liên kết (chủ = người gọi, tệp tạm) — không có tệp người dùng chọn.
  "foundation/files/server-file.repository.ts": null,
};

/**
 * Luật (iv): hàm ghi `file_links` của từng tệp ghi. Người gọi hợp lệ của một tên = các `caller` ở `WRITERS` của
 * những tệp ghi khai báo tên đó. `insertTx` của `FileLinkRepository` trùng tên với repo khác ⇒ do luật (ii) giữ.
 */
const WRITE_METHODS: Record<string, readonly string[]> = {
  "chat/chat-attachments.repository.ts": ["insertAttachmentLinks"],
  "chat/chat-room-avatar.service.ts": ["insertAvatarLinkOrThrowTx"],
  "employees/hr-employee-avatar.service.ts": ["insertAvatarLinkOrThrowTx"],
  "foundation/files/files.service.ts": ["insertLinkOrThrow"],
};

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

const rel = (full: string): string => relative(SRC_ROOT, full).split(sep).join("/");

function sources(): Map<string, string> {
  return new Map(
    walk(SRC_ROOT).map((full) => [rel(full), stripComments(readFileSync(full, "utf8"))]),
  );
}

const DIRECT_INSERT = /\.insert\(\s*fileLinks\s*\)|INSERT\s+INTO\s+file_links\b/i;
const IMPORTS_LINK_REPO = /import\s*\{[^}]*\bFileLinkRepository\b[^}]*\}\s*from/;
const CALLS_INSERT_TX = /\.insertTx\s*\(/;
const REVIVE_KEYS = /deletedAt\s*:\s*null|\bfileId\s*[:,}]|\bentityId\s*[:,}]/;

/** Tệp ghi `file_links` theo luật (i) + (ii). */
function linkWriters(src: ReadonlyMap<string, string>): string[] {
  return [...src.entries()]
    .filter(
      ([, text]) =>
        DIRECT_INSERT.test(text) || (IMPORTS_LINK_REPO.test(text) && CALLS_INSERT_TX.test(text)),
    )
    .map(([path]) => path)
    .sort();
}

/** Luật (iii): mỗi `.update(fileLinks)` mà đoạn `.set(…)` (tới `.where(`) đổi khoá trỏ hoặc hồi sinh. */
function revivingUpdates(src: ReadonlyMap<string, string>): string[] {
  const hits: string[] = [];
  for (const [path, text] of src) {
    const re = /\.update\(\s*fileLinks\s*\)/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const tail = text.slice(m.index, m.index + 600);
      const whereAt = tail.indexOf(".where(");
      const setPart = whereAt === -1 ? tail : tail.slice(0, whereAt);
      if (REVIVE_KEYS.test(setPart)) hits.push(path);
    }
  }
  return hits.sort();
}

/** Tên hàm ghi → tập tệp gọi hợp lệ (gộp theo tên: hai tệp ghi có thể trùng tên hàm riêng). */
function allowedCallersByMethod(): Map<string, ReadonlySet<string>> {
  const pairs = Object.entries(WRITE_METHODS).flatMap(([writer, names]) =>
    names.map((name) => [name, WRITERS[writer]?.caller] as const),
  );
  return new Map(
    [...new Set(pairs.map(([name]) => name))].map((name) => [
      name,
      new Set(pairs.flatMap(([n, caller]) => (n === name && caller ? [caller] : []))),
    ]),
  );
}

const callPattern = (name: string): RegExp => new RegExp(`\\.${name}\\s*\\(`);

/** Luật (iv): `<tệp> → <hàm>` cho mỗi tệp gọi một hàm ghi mà không phải tệp gọi đã phân loại. */
function unlistedWriteCallers(src: ReadonlyMap<string, string>): string[] {
  return [...allowedCallersByMethod()]
    .flatMap(([name, allowed]) =>
      [...src.entries()]
        .filter(([path, text]) => callPattern(name).test(text) && !allowed.has(path))
        .map(([path]) => `${path} → ${name}`),
    )
    .sort();
}

describe("S19-SEC-FILELINKPATHS-1 D-10 — đường ghi file_links đi qua quyết định chung", () => {
  const src = sources();

  it("neo dương: quét thấy tệp nguồn và thấy ít nhất các tệp ghi đã biết", () => {
    expect(src.size).toBeGreaterThan(100);
    expect(linkWriters(src)).toContain("foundation/files/file-link.repository.ts");
  });

  it("(i)+(ii) mọi tệp ghi file_links đều đã phân loại", () => {
    const unknown = linkWriters(src).filter((p) => !(p in WRITERS));
    expect(
      unknown,
      "tệp ghi file_links chưa phân loại — đi qua hàm chung rồi thêm vào bảng",
    ).toEqual([]);
  });

  it("bảng không giữ tệp ma: mỗi mục còn là tệp ghi thật", () => {
    const writers = new Set(linkWriters(src));
    const stale = Object.keys(WRITERS).filter((p) => !writers.has(p));
    expect(stale, "mục bảng không còn ghi file_links — gỡ khỏi bảng").toEqual([]);
  });

  it.each(Object.entries(WRITERS).filter(([, v]) => v !== null))(
    "%s — tệp gọi chứa đủ ký hiệu của quyết định chung",
    (_writer, rule) => {
      const text = src.get(rule!.caller) ?? "";
      expect(text.length, `tệp gọi ${rule!.caller} phải tồn tại`).toBeGreaterThan(0);
      const missing = rule!.symbols.filter((s) => !text.includes(s));
      expect(missing, `${rule!.caller} thiếu lời gọi hàm chung`).toEqual([]);
    },
  );

  it("(iii) không đường nào hồi sinh hay trỏ lại một liên kết bằng UPDATE", () => {
    expect(revivingUpdates(src)).toEqual([]);
  });

  it("(iv) mọi tệp gọi hàm ghi của một tệp ghi đều là tệp gọi đã phân loại", () => {
    expect(
      unlistedWriteCallers(src),
      "tệp gọi hàm ghi file_links chưa phân loại — đi qua hàm chung rồi thêm vào WRITERS",
    ).toEqual([]);
  });

  it("(iv) bảng hàm ghi không giữ tên ma: tệp ghi khai báo hàm, và mỗi hàm có ít nhất một tệp gọi", () => {
    for (const [writer, names] of Object.entries(WRITE_METHODS)) {
      const text = src.get(writer) ?? "";
      for (const name of names) {
        const declared = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "m").test(text);
        expect(declared, `${writer} phải khai báo ${name}`).toBe(true);
        const callers = [...src.entries()].filter(([, t]) => callPattern(name).test(t));
        expect(callers.length, `${name} phải có tệp gọi`).toBeGreaterThan(0);
      }
    }
    expect(allowedCallersByMethod().get("insertAttachmentLinks")).toEqual(
      new Set(["chat/chat-messages.service.ts"]),
    );
  });

  it("cổng (iv) đo bằng vi phạm thật: tệp gọi thứ hai của hàm ghi công khai ⇒ (iv) bắt, (i)/(ii) không", () => {
    const fake = new Map(src);
    fake.set(
      "zz/fake-forward.service.ts",
      "const created = await this.attachmentRepo.insertAttachmentLinks(tx, { fileIds });",
    );
    expect(linkWriters(fake)).not.toContain("zz/fake-forward.service.ts");
    expect(unlistedWriteCallers(fake)).toEqual([
      "zz/fake-forward.service.ts → insertAttachmentLinks",
    ]);
  });

  it("cổng đo bằng vi phạm thật: tệp ghi giả + UPDATE hồi sinh ⇒ cả hai luật bắt", () => {
    const fake = new Map(src);
    fake.set(
      "zz/fake-writer.ts",
      "await tx.insert(fileLinks).values(v);\nawait tx.update(fileLinks).set({ deletedAt: null }).where(x);",
    );
    fake.set(
      "zz/fake-repo-caller.ts",
      'import { FileLinkRepository } from "../foundation/files/file-link.repository";\nawait this.linkRepo.insertTx(v, tx);',
    );
    const unknown = linkWriters(fake).filter((p) => !(p in WRITERS));
    expect(unknown).toEqual(["zz/fake-repo-caller.ts", "zz/fake-writer.ts"]);
    expect(revivingUpdates(fake)).toContain("zz/fake-writer.ts");
  });
});
