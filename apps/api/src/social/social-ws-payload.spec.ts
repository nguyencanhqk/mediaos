import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  wsFeedCompanyPostCreatedEventSchema,
  wsFeedGroupPostCreatedEventSchema,
  type FeedPostDto,
} from "@mediaos/contracts";
import { buildWsPostCreatedEvent } from "./social-ws-payload";

/**
 * S16-SOCIAL-BE-2C — nguồn payload `feed:post.created` (plan §4.7, §5 P1–P5).
 *
 * Hàm THUẦN quyết định HAI thứ: (1) bài nào được phát (chỉ `published` + `company`/`group` có id), và
 * (2) NHÃN `audience`/`groupId` của payload — emitter định tuyến theo nhãn đó (bất biến 7). Nhãn lấy từ
 * HÀNG DB, không từ hằng: code BE-1 đè `audience: "company"` tại nguồn; giữ hằng đó cho nhánh group là
 * dán nhãn bài nhóm KÍN thành bài công ty ⇒ emitter định tuyến đúng-theo-payload ra room CẢ CÔNG TY
 * (mutant M18).
 */

const G = "61000000-0000-4000-8000-000000000001";
const POST = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const keysOf = (s: { shape: Record<string, unknown> }): string[] => Object.keys(s.shape).sort();

/** DTO REST đầy đủ — decorate bằng TÁC GIẢ (đúng thứ `create()` có trong tay lúc phát). */
function restDto(over: Partial<FeedPostDto> = {}): FeedPostDto {
  return {
    id: POST,
    type: "poll",
    audience: "company",
    orgUnitId: null,
    groupId: null,
    author: { employeeId: null, fullName: "Tác giả", avatarUrl: null },
    body: "nội dung",
    tags: ["a"],
    attachments: [
      {
        fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        kind: "image",
        fileName: "a.png",
        sizeBytes: 10,
        url: "https://signed.example/secret",
      },
    ],
    pinned: false,
    commentsLocked: false,
    requiresAck: false,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    myReaction: "like",
    savedByMe: true,
    isMine: true,
    status: "published",
    mentions: [],
    poll: { myVote: ["22222222-2222-4222-8222-222222222222"] } as never,
    editedAt: null,
    publishedAt: "2026-10-02T00:00:00.000Z",
    lastActivityAt: "2026-10-02T00:00:00.000Z",
    createdAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("buildWsPostCreatedEvent (S16-SOCIAL-BE-2C)", () => {
  it("P1 bài company published ⇒ biến thể company, `groupId:null`, khoá ra ĐÚNG bằng option company", () => {
    const ev = buildWsPostCreatedEvent(
      { audience: "company", status: "published", groupId: null },
      restDto(),
    );
    expect(ev).not.toBeNull();
    expect(ev?.audience).toBe("company");
    expect(ev?.groupId).toBeNull();
    expect(wsFeedCompanyPostCreatedEventSchema.safeParse(ev).success).toBe(true);
    expect(Object.keys(ev ?? {}).sort()).toEqual(keysOf(wsFeedCompanyPostCreatedEventSchema));
    expect(JSON.stringify(ev)).not.toContain("signed.example");
  });

  it("🔒 P2 bài group ⇒ nhãn `group` + `groupId` LẤY TỪ HÀNG; parse được bởi option group, KHÔNG bởi option company", () => {
    const ev = buildWsPostCreatedEvent(
      { audience: "group", status: "published", groupId: G },
      restDto({ audience: "group", groupId: G }),
    );
    expect(ev?.audience).toBe("group");
    expect(ev?.groupId).toBe(G);
    expect(wsFeedGroupPostCreatedEventSchema.safeParse(ev).success).toBe(true);
    // Lưới chống dán nhãn sai: payload nhóm KHÔNG được đi lọt option company (⇒ room công ty).
    expect(wsFeedCompanyPostCreatedEventSchema.safeParse(ev).success).toBe(false);
    // Room nhóm KHÔNG nhận payload rộng hơn room công ty: cùng tập khoá đã bóc.
    expect(Object.keys(ev ?? {}).sort()).toEqual(keysOf(wsFeedGroupPostCreatedEventSchema));
    for (const k of ["status", "myReaction", "savedByMe", "isMine", "mentions", "poll"]) {
      expect(ev).not.toHaveProperty(k);
    }
    expect((ev?.attachments ?? [])[0]).not.toHaveProperty("url");
  });

  it("P3 bài org_unit ⇒ null (D21 — KHÔNG có room nào cho org_unit)", () => {
    expect(
      buildWsPostCreatedEvent(
        { audience: "org_unit", status: "published", groupId: null },
        restDto({ audience: "org_unit", orgUnitId: G }),
      ),
    ).toBeNull();
  });

  it("P4 bài KHÔNG published (hidden) ⇒ null", () => {
    expect(
      buildWsPostCreatedEvent({ audience: "company", status: "hidden", groupId: null }, restDto()),
    ).toBeNull();
  });

  /**
   * Hợp nhất S16-SOCIAL-AVATARPRESIGN-1 (D3-b) × BE-2C: `dto` của `create()` mang `author.avatarUrl` là
   * URL ĐÃ KÝ của REST (capability TTL). Nguồn ép `null` cho CẢ HAI biến thể — room nhóm không nhận thứ
   * room công ty không nhận. Neo: tên + `employeeId` GIỮ nguyên (chép tường minh, không mất khoá).
   */
  it.each([
    ["company", { audience: "company", status: "published", groupId: null }, {}],
    [
      "group",
      { audience: "group", status: "published", groupId: G },
      { audience: "group", groupId: G },
    ],
  ] as const)(
    "P6 biến thể %s — `author.avatarUrl` ký trên DTO ⇒ payload `null` (S16-SOCIAL-AVATARPRESIGN-1 D3-b)",
    (_aud, row, over) => {
      const signed = `https://minio.example/a.png?X-Amz-Signature=${"ab".repeat(32)}`;
      const ev = buildWsPostCreatedEvent(
        row,
        restDto({
          ...over,
          author: { employeeId: POST, fullName: "Tác giả", avatarUrl: signed },
        }),
      );
      expect(ev?.audience, "neo: đúng biến thể").toBe(row.audience);
      expect(ev?.author).toEqual({ employeeId: POST, fullName: "Tác giả", avatarUrl: null });
      expect(JSON.stringify(ev)).not.toContain("X-Amz-Signature");
    },
  );

  it("P5 bài group THIẾU groupId ⇒ null (không có đích để định tuyến)", () => {
    expect(
      buildWsPostCreatedEvent(
        { audience: "group", status: "published", groupId: null },
        restDto({ audience: "group" }),
      ),
    ).toBeNull();
  });
});

/** Bỏ comment — luật nói về CODE, không về văn xuôi giải thích luật (khuôn `feed-realtime-structure`). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Mọi module specifier file KÉO VÀO: `from "…"` (kể cả `import type`/`export … from`), side-effect, `import()`, `require()`. */
const importsOf = (file: string): string[] =>
  [
    ...stripComments(readFileSync(join(__dirname, file), "utf8")).matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1] as string);

/**
 * Hợp nhất S16-SOCIAL-AVATARPRESIGN-1 × BE-2C — builder là hàm THUẦN (plan BE-2C §4.7). `wsAuthorOf` từng
 * được import từ `social-avatar-signer.ts` ⇒ module thuần kéo theo Nest DI · drizzle · presign/S3 của
 * signer. Không ca runtime nào thấy cạnh đó (hành vi y hệt) — chỉ quét nguồn mới gác nổi.
 */
describe("S16-SOCIAL-AVATARPRESIGN-1 — `social-ws-payload.ts` là module THUẦN (plan BE-2C §4.7)", () => {
  it("builder chỉ kéo `@mediaos/contracts` + `./social-ws-author` (neo: CÓ dùng lại `wsAuthorOf`); module tác giả không kéo gì ngoài contracts", () => {
    const specs = importsOf("social-ws-payload.ts");
    for (const s of specs) {
      expect(s, "social-ws-payload.ts import ngoài allowlist").toMatch(
        /^(@mediaos\/contracts|\.\/social-ws-author)$/,
      );
    }
    // Neo dương — builder BÀI dùng lại `wsAuthorOf` (không bản chép). Ca này CHỈ ghim đường bài; bình luận
    // (`social-comments.service.ts`) đi qua re-export của `social-avatar-signer.ts`, không được ghim ở đây.
    expect(specs).toContain("./social-ws-author");
    for (const s of importsOf("social-ws-author.ts")) {
      expect(s, "social-ws-author.ts import ngoài contracts").toBe("@mediaos/contracts");
    }
  });
});
