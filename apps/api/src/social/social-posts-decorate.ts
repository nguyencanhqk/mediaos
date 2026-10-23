import type { Logger } from "@nestjs/common";
import type { FeedPostDto } from "@mediaos/contracts";
import type { DatabaseService } from "../db/db.service";
import type { SocialAttachmentsService } from "./social-attachments.service";
import type { SocialAvatarSigner } from "./social-avatar-signer";
import { loadMentionsForTargets, mentionsFor } from "./social-mentions";
import { avatarRefsOfPage, blocksFor, loadPostBlocksTx } from "./social-post-blocks";
import type {
  PostRow,
  SocialActorProjectionRepository,
  SocialPostsRepository,
} from "./social-posts.repository";
import { toFeedPostDto } from "./social.mapper";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-POSTSSPLIT-1 — lối dựng thẻ bài (Row → DTO) tách khỏi `social-posts.service.ts` (vượt
 * trần 800 dòng). Thân hàm GIỮ NGUYÊN từng câu; service gọi qua `SocialPostsService.decorate` (private)
 * và `decorateForViewer` / `toPageForViewer` (public, đường tái dùng của `020/023/025`).
 *
 * ⚠️ Điều kiện tồn tại không đổi khi dời tệp: `rows` PHẢI đến từ một câu ĐÃ mang `visiblePostCondition`
 * (`listFeed`/`findVisible`). Hàm này KHÔNG tự kiểm tầm nhìn — nó chỉ gắn tag/cảm xúc/đã lưu/mention/
 * khối/avatar/đính kèm cho hàng caller VỐN ĐÃ đọc được. Đừng gọi nó với hàng lấy theo id rời của caller.
 *
 * ⚠️ KHÔNG gọi hàm này từ TRONG callback `withTenant`: nó tự mở `withTenant` (đọc lô) rồi ký đính kèm
 * NGOÀI tx (kết nối riêng) — tx lồng tx TREO IM LẶNG trên PgBouncer transaction-mode.
 */

/**
 * Cộng tác viên của lối dựng thẻ bài — ĐÚNG những method thân hàm chạm, không hơn (spec giả lập thì
 * thiếu một cộng tác viên là TS đỏ, không phải `undefined is not a function` lúc chạy).
 */
export interface SocialPostsDecorateDeps {
  readonly db: Pick<DatabaseService, "withTenant">;
  readonly repo: Pick<SocialPostsRepository, "tagsFor">;
  readonly projections: Pick<SocialActorProjectionRepository, "myReactions" | "savedPostIds">;
  readonly attachments: Pick<SocialAttachmentsService, "decorateMany">;
  readonly avatarSigner: Pick<SocialAvatarSigner, "signTx">;
  /** Logger CỦA service gọi — giữ nguyên ngữ cảnh `[SocialPostsService]` trong log. */
  readonly logger: Pick<Logger, "error">;
}

/** Row → DTO cho một LÔ: tag + projection theo actor (1 tx đọc) rồi đính kèm ĐÃ KÝ (ngoài tx). */
export async function decoratePosts(
  deps: SocialPostsDecorateDeps,
  viewer: SocialViewerContext,
  rows: PostRow[],
): Promise<FeedPostDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // `mentions` (S16-SOCIAL-BE-1D D7): CÙNG tx, ≤3 câu cho cả lô; audience lấy từ `PostRow` sẵn có.
  // `rows` đã qua cổng đọc bài (điều kiện của `decorate`) — bộ nạp KHÔNG tự kiểm tầm nhìn.
  const { tags, myReactions, saved, mentions, blocks, avatars } = await deps.db.withTenant(
    viewer.companyId,
    async (tx) => {
      const loaded = {
        tags: await deps.repo.tagsFor(tx, viewer.companyId, ids),
        myReactions: await deps.projections.myReactions(
          tx,
          viewer.companyId,
          viewer.actorUserId,
          "post",
          ids,
        ),
        saved: await deps.projections.savedPostIds(tx, viewer.companyId, viewer.actorUserId, ids),
        mentions: await loadMentionsForTargets(
          tx,
          viewer.companyId,
          "post",
          rows.map((r) => ({
            id: r.id,
            audience: r.audience,
            orgUnitId: r.orgUnitId,
            groupId: r.groupId,
          })),
        ),
        // S16-SOCIAL-BE-2D D3: khối kudos/poll/idea — CÙNG tx, ≤4 câu/lô, chỉ bảng của loại có mặt.
        blocks: await loadPostBlocksTx(tx, viewer.companyId, viewer.actorUserId, rows),
      };
      // S16-SOCIAL-AVATARPRESIGN-1: tác giả + người nhận kudos của CẢ lô — MỘT câu cổng, CÙNG tx.
      const refs = avatarRefsOfPage(rows, loaded.blocks);
      return { ...loaded, avatars: await deps.avatarSigner.signTx(tx, viewer.companyId, refs) };
    },
  );
  for (const o of blocks.orphans) {
    deps.logger.error(
      `S16-SOCIAL-BE-2D: bài ${o.postId} type=${o.type} KHÔNG nạp được khối (thiếu hàng con hoặc dữ liệu hỏng) — khối vắng`,
    );
  }
  for (const k of blocks.emptyKudos) {
    deps.logger.error(
      `S16-SOCIAL-BE-2D: bài ${k.postId} vinh danh ${k.kudosId} KHÔNG còn người nhận nào`,
    );
  }
  for (const b of blocks.brokenBadges) {
    deps.logger.error(
      `S16-SOCIAL-BE-2D: kudos ${b.kudosId} trỏ huy hiệu ${String(b.badgeId)} không ra code/name — bỏ huy hiệu`,
    );
  }
  // NGOÀI tx — ký URL tự mở kết nối riêng (xem docblock `SocialAttachmentsService`).
  const attachments = await deps.attachments.decorateMany(viewer, "post", ids);

  return rows.map((row) =>
    toFeedPostDto(row, viewer, {
      tags: tags.get(row.id) ?? [],
      attachments: attachments.get(row.id) ?? [],
      myReaction: myReactions.get(row.id) ?? null,
      savedByMe: saved.has(row.id),
      mentions: mentionsFor(mentions, row.id),
      ...blocksFor(blocks, row),
      avatars,
    }),
  );
}
