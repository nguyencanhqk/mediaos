import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-AVATARPRESIGN-1 — ràng buộc CẤU TRÚC của đường avatar SOCIAL (plan §5 «Cấu trúc»).
 *
 * ┌─ VÌ SAO CẦN SPEC TĨNH BÊN CẠNH INT-SPEC ───────────────────────────────────────────────────────┐
 * │ Int-spec gọi 15 route; `010/020/023/025` (danh sách bài) và `016` (sửa bình luận) đi qua CÙNG   │
 * │ lối dựng DTO nên không gọi riêng (plan F8). Thứ giữ cho mọi lối dựng DTO — kể cả lối viết SAU   │
 * │ WO này — không đưa cột thô `employee_profiles.avatar_url` lên dây là HAI luật tên khoá:          │
 * │   S1 — mọi điểm SELECT cột thô đặt nó dưới khoá `…AvatarRaw`/`avatarRaw` (không bao giờ dưới      │
 * │        `avatarUrl`/`avatar`, tên của khoá DTO) ⇒ đổi tên = trình biên dịch liệt kê mọi chỗ dựng; │
 * │   S2 — không dòng nào gán thẳng một `…avatarRaw` vào khoá DTO `avatarUrl`/`avatar`;              │
 * │   S3 — `resolveEmployeeAvatars(` có ĐÚNG MỘT điểm gọi (trong signer), luôn 3 đối số (tx của     │
 * │        caller — lồng `withTenant` = treo PgBouncer); `signInSavepointTx(` chỉ dùng ở `029`.      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Số **12** nâng CÓ CHỦ ĐÍCH (bảng §1.1 của plan): thêm một điểm SELECT avatar mới ⇒ ca đỏ, và người
 * thêm phải đọc §1.1 (che ảnh ⊆ che tên) trước khi nâng số. Khuôn đọc nguồn: `social-poll-flags-structure`.
 */

const SOCIAL_DIR = __dirname;
const SIGNER_FILE = "social-avatar-signer.ts";
const SAVEPOINT_CALLER = "social-reports.service.ts";

/** Số điểm SELECT cột thô của module (plan §1.1 — 12 hàng). */
const RAW_AVATAR_SELECT_POINTS = 12;

/**
 * Bỏ comment — luật nói về CODE, không về văn xuôi giải thích luật (docblock nhắc tên cột sẽ đỏ oan).
 * GIỮ dấu xuống dòng của khối comment để `file:dòng` trong thông điệp đỏ trỏ đúng dòng nguồn.
 */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Mọi file `.ts` (bỏ spec) PHẲNG trong `src/social/` — cùng quy ước với census 2 tầng. */
function socialSources(): { file: string; text: string }[] {
  return readdirSync(SOCIAL_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ file: f, text: stripComments(readFileSync(join(SOCIAL_DIR, f), "utf8")) }));
}

function linesOf(): { where: string; line: string }[] {
  return socialSources().flatMap(({ file, text }) =>
    text.split("\n").map((line, i) => ({ where: `${file}:${i + 1}`, line })),
  );
}

/** Đối số cấp-một của lời gọi bắt đầu tại `openIdx` (vị trí dấu `(`). */
function topLevelArgs(text: string, openIdx: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        if (buf.trim()) args.push(buf.trim());
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  return args;
}

/** Mọi lời GỌI `name(` (bỏ chỗ khai báo `async name(` / `name(` sau từ khoá định nghĩa). */
function callSites(name: string): { file: string; args: string[] }[] {
  const out: { file: string; args: string[] }[] = [];
  const re = new RegExp(`(^|[^\\w])(async\\s+)?${name}\\(`, "g");
  for (const { file, text } of socialSources()) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[2]) continue; // `async name(` = định nghĩa method, không phải lời gọi.
      const open = m.index + m[0].length - 1;
      out.push({ file, args: topLevelArgs(text, open) });
    }
  }
  return out;
}

describe("S16-SOCIAL-AVATARPRESIGN-1 · cấu trúc đường avatar SOCIAL", () => {
  it(`S1 — đúng ${RAW_AVATAR_SELECT_POINTS} dòng SELECT cột thô, mỗi dòng đặt dưới khoá …AvatarRaw`, () => {
    const selects = linesOf().filter((l) =>
      /\b(employeeProfiles|r\w*Emp)\.avatarUrl\b/.test(l.line),
    );
    expect(
      selects.map((s) => s.where),
      "số điểm SELECT `employee_profiles.avatar_url` đổi — đọc plan §1.1 (che ảnh ⊆ che tên) rồi mới nâng số",
    ).toHaveLength(RAW_AVATAR_SELECT_POINTS);
    const badKeys = selects
      .filter((s) => !/\b\w*(AvatarRaw|avatarRaw)\s*:/.test(s.line))
      .map((s) => `${s.where} → ${s.line.trim()}`);
    expect(
      badKeys,
      "cột thô phải nằm dưới khoá `…AvatarRaw` — tên `avatarUrl`/`avatar` là tên khoá DTO (ký qua SocialAvatarSigner.urlOf)",
    ).toEqual([]);
  });

  it("S2 — không dòng nào gán thẳng `…avatarRaw` vào khoá DTO `avatarUrl`/`avatar`", () => {
    const direct = linesOf()
      .filter((l) => /\b(avatarUrl|avatar)\s*:\s*[\w.?]*[aA]vatarRaw\b/.test(l.line))
      .map((l) => `${l.where} → ${l.line.trim()}`);
    expect(
      direct,
      "cột thô đi thẳng lên DTO — dùng `avatars.urlOf({ employeeId, avatarRaw })`",
    ).toEqual([]);
  });

  it("S3 — `resolveEmployeeAvatars(` gọi ĐÚNG 1 lần, trong signer, 3 đối số (tx của caller)", () => {
    const sites = callSites("resolveEmployeeAvatars");
    expect(
      sites.map((s) => s.file),
      "SOCIAL chỉ ký avatar qua SocialAvatarSigner — không lời gọi trực tiếp nào khác",
    ).toEqual([SIGNER_FILE]);
    expect(
      sites[0]!.args.length,
      "thiếu `tx` ⇒ dịch vụ tự mở withTenant LỒNG trong tx của route (treo PgBouncer — plan M7)",
    ).toBe(3);
  });

  it("S3 — `signInSavepointTx(` chỉ được gọi ở `029` (tx có ghi)", () => {
    const callers = [...new Set(callSites("signInSavepointTx").map((s) => s.file))];
    expect(callers).toEqual([SAVEPOINT_CALLER]);
  });
});
