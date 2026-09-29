import type {
  FeedKudosBlockDto,
  FeedKudosRecipientDto,
  FeedPollResultsDto,
  FeedPostIdeaBlockDto,
} from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { ideaStatusByPostIdsTx } from "./social-ideas.repository";
import { badgeRefOf, kudosBlocksByPostIdsTx, recipientsOfTx } from "./social-kudos.repository";
import { pollResultsByTx } from "./social-polls.repository";

/**
 * S16-SOCIAL-BE-2D D3 — nạp khối `kudos`/`poll`/`idea` cho MỘT LÔ thẻ bài.
 *
 * ┌─ HỢP ĐỒNG ────────────────────────────────────────────────────────────────────────────────────┐
 * │ • Chỉ hỏi bảng của loại CÓ MẶT trên trang: kudos 2 câu (khối + người nhận) · poll 1 · idea 1 ⇒  │
 * │   ≤ 4 câu/trang BẤT KỂ số bài, 0 câu khi trang không có ba loại đó (ca B7' đếm ở tầng driver).   │
 * │ • Gọi trong CÙNG `withTenant` của `decorate` — hàm thuần nhận `tx`, KHÔNG tự mở tenant tx (lồng │
 * │   `withTenant` = treo im lặng trên PgBouncer).                                                 │
 * │ • KHÔNG tự gác tầm nhìn: `rows` phải là hàng ĐÃ qua cổng đọc bài (điều kiện của `decorate`).     │
 * │ • Hàng con MỒ CÔI (loại khớp mà thiếu hàng con — DB cho phép) ⇒ khối VẮNG + nằm trong `orphans` │
 * │   để caller `logger.error`. KHÔNG ném: ném = 500 CẢ trang feed vì một bài hỏng dữ liệu.         │
 * │ • File RIÊNG (không nằm trong `social-posts.service.ts`, đã >800 dòng) và là module riêng để    │
 * │   int-spec `vi.mock` spy được lời gọi CHÉO module.                                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface PostBlocks {
  kudos: Map<string, FeedKudosBlockDto>;
  poll: Map<string, FeedPollResultsDto>;
  idea: Map<string, FeedPostIdeaBlockDto>;
  /** Bài có loại khớp mà KHÔNG có hàng con — caller ghi `logger.error`. */
  orphans: Array<{ postId: string; type: BlockType }>;
  /** Vinh danh trỏ huy hiệu mà JOIN không ra code/name (bất khả theo FK) — caller `logger.error`. */
  brokenBadges: Array<{ kudosId: string; badgeId: string | null }>;
  /**
   * Vinh danh KHÔNG còn hàng người nhận nào (đường ghi đòi ≥1, nhưng DB không ép và app role có DELETE
   * trên `feed_kudos_recipients`) — khối vẫn trả `recipients: []` (FE không ZodError) nhưng caller
   * `logger.error` (FULL gate silent-failure M1: không để «vinh danh 0 người» im lặng).
   */
  emptyKudos: Array<{ postId: string; kudosId: string }>;
}

type BlockType = "kudos" | "poll" | "idea";
const isBlockType = (t: string): t is BlockType => t === "kudos" || t === "poll" || t === "idea";

export async function loadPostBlocksTx(
  tx: TenantTx,
  companyId: string,
  viewerUserId: string,
  rows: ReadonlyArray<{ id: string; type: string }>,
): Promise<PostBlocks> {
  const out: PostBlocks = {
    kudos: new Map(),
    poll: new Map(),
    idea: new Map(),
    orphans: [],
    brokenBadges: [],
    emptyKudos: [],
  };
  const idsOf = (t: BlockType) => rows.filter((r) => r.type === t).map((r) => r.id);
  const kudosPostIds = idsOf("kudos");
  const pollPostIds = idsOf("poll");
  const ideaPostIds = idsOf("idea");

  if (kudosPostIds.length > 0) {
    const blocks = await kudosBlocksByPostIdsTx(tx, companyId, kudosPostIds);
    const recipients = await recipientsOfTx(
      tx,
      companyId,
      blocks.map((b) => b.kudosId),
    );
    const byKudos = new Map<string, FeedKudosRecipientDto[]>();
    for (const r of recipients) {
      // Chép theo DANH SÁCH KHOÁ — `kudosId` (khoá gom) và mọi cột lạ ở tầng dưới không ra dây.
      const item: FeedKudosRecipientDto = {
        employeeId: r.employeeId,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
        isFormerEmployee: r.isFormerEmployee,
      };
      const list = byKudos.get(r.kudosId);
      if (list) list.push(item);
      else byKudos.set(r.kudosId, [item]);
    }
    for (const b of blocks) {
      const { badge, broken } = badgeRefOf(b);
      if (broken) out.brokenBadges.push({ kudosId: b.kudosId, badgeId: b.badgeId });
      const recips = byKudos.get(b.kudosId);
      if (!recips) out.emptyKudos.push({ postId: b.postId, kudosId: b.kudosId });
      out.kudos.set(b.postId, {
        kudosId: b.kudosId,
        message: b.message,
        isOfficial: b.isOfficial,
        badge,
        recipients: recips ?? [],
      });
    }
  }

  if (pollPostIds.length > 0) {
    const polls = await pollResultsByTx(tx, companyId, viewerUserId, { postIds: pollPostIds });
    for (const [postId, p] of polls) out.poll.set(postId, p);
  }

  if (ideaPostIds.length > 0) {
    for (const r of await ideaStatusByPostIdsTx(tx, companyId, ideaPostIds)) {
      out.idea.set(r.postId, { status: r.status });
    }
  }

  for (const r of rows) {
    if (isBlockType(r.type) && !out[r.type].has(r.id)) {
      out.orphans.push({ postId: r.id, type: r.type });
    }
  }
  return out;
}

/** Khối của MỘT bài — chỉ khoá khớp `type` và đã nạp được; còn lại VẮNG (vắng ≠ rỗng). */
export function blocksFor(
  blocks: PostBlocks,
  row: { id: string; type: string },
): { kudos?: FeedKudosBlockDto; poll?: FeedPollResultsDto; idea?: FeedPostIdeaBlockDto } {
  switch (row.type) {
    case "kudos": {
      const kudos = blocks.kudos.get(row.id);
      return kudos ? { kudos } : {};
    }
    case "poll": {
      const poll = blocks.poll.get(row.id);
      return poll ? { poll } : {};
    }
    case "idea": {
      const idea = blocks.idea.get(row.id);
      return idea ? { idea } : {};
    }
    default:
      return {};
  }
}
