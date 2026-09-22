import { ConflictException, Injectable } from "@nestjs/common";
import type {
  FeedAckPageDto,
  FeedAckResultDto,
  FeedNewsPageDto,
  ListNewsQueryDto,
  ListPostAcksQueryDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { SocialAccessService } from "./social-access.service";
import { encodeFeedCursor, decodeFeedCursor, fingerprintFeedFilter } from "./social-feed-cursor";
import { SocialNewsRepository, type AckPersonRow } from "./social-news.repository";
import { SocialPostsService } from "./social-posts.service";
import { SocialPostsRepository, type PostRow } from "./social-posts.repository";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-1B — `SOCIAL-API-020..022` (tin tức · xác nhận đã đọc · ai đã/chưa đọc).
 *
 * `020` và `022` là hai câu hỏi rất khác nhau về mức nhạy cảm dù cùng nói về tin tức:
 *   • `020` đọc BÀI trong phạm vi của chính actor — `view:feed`.
 *   • `022` chiếu DANH TÍNH của mọi người trong audience (nửa «chưa đọc» gồm cả người chưa làm gì) —
 *     `manage:feed-news`. Xem docblock `unackedEmployeesFor`.
 */
@Injectable()
export class SocialNewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialNewsRepository,
    private readonly posts: SocialPostsRepository,
    private readonly postsService: SocialPostsService,
  ) {}

  /**
   * `SOCIAL-API-020` — `GET /social/news`.
   *
   * `sort='active'` CỐ ĐỊNH + ghim lên đầu (API-19 §5.1): màn tin tức hỏi «có gì mới cần đọc», và
   * cho phép `sort=latest` ở đây sẽ đẩy bài ghim xuống giữa dòng.
   */
  async list(user: SocialRequestUser, query: ListNewsQueryDto): Promise<FeedNewsPageDto> {
    const actor = await this.access.resolveActor(user, "newsList");

    // Dấu vân RIÊNG cho dòng tin tức: tập hàng khác hẳn `/social/feed`, nên một con trỏ của feed dùng
    // nhầm ở đây phải thành 400 chứ không phải một trang sai im lặng.
    const fingerprint = fingerprintFeedFilter([
      "news",
      actor.actorUserId,
      String(actor.canManagePosts),
      [...actor.orgUnitIds].sort().join(","),
      query.unackedOnly ? "unacked" : "all",
    ]);

    // ┌─ VÌ SAO PHẦN «TRANG TRÍ» NẰM NGOÀI `withTenant` ────────────────────────────────────────────┐
    // │ `decorateForViewer` → `SocialPostsService.decorate` MỞ `withTenant` RIÊNG (:487) và gọi tiếp │
    // │ `attachments.decorateMany` (mở cái thứ ba + ký URL S3). `DatabaseService.withTenant` =       │
    // │ `db.transaction` thuần, KHÔNG reentrancy ⇒ mỗi lượt xin một connection MỚI từ pool. Gọi nó   │
    // │ khi tx ngoài còn mở là `withTenant` lồng nhau — thứ mà docblock của `SocialPostsService`     │
    // │ (:57-59, BE-1) ghi rõ là **TREO trên PgBouncer transaction-mode chứ không báo lỗi**: N       │
    // │ request đồng thời giữ connection tx ngoài và cùng chờ connection thứ hai ⇒ khoá chết pool    │
    // │ (`db/index.ts` không đặt `connectionTimeoutMillis` ⇒ chờ VÔ HẠN). Cả 4 call-site của BE-1 và │
    // │ `search`/`profilePosts` của chính BE-1B đều decorate SAU khi tx đóng — chỉ chỗ này lồng.     │
    // └─────────────────────────────────────────────────────────────────────────────────────────────┘
    const loaded = await this.db.withTenant(actor.companyId, async (tx) => {
      if (query.countOnly) {
        // Chế độ HUY HIỆU: chỉ con số. `data` rỗng + `nextCursor` null là câu trả lời ĐẦY ĐỦ, không
        // phải một trang rỗng — `unackedCount` mang giá trị, và `null` ở nhánh kia nghĩa "không hỏi".
        const unackedCount = await this.repo.countUnackedFor(
          tx,
          actor,
          this.access.visiblePostCondition(actor),
        );
        return { countOnly: true as const, unackedCount };
      }

      const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;
      const rows = await this.posts.listFeed(tx, actor, {
        sort: "active",
        limit: query.limit,
        cursor,
        type: "news",
      });

      const page = rows.slice(0, query.limit);
      const acked = await this.repo.ackedPostIds(
        tx,
        actor.companyId,
        actor.actorUserId,
        page.map((r) => r.id),
      );

      // `unackedOnly` lọc SAU khi lấy trang — và đó là một ĐÁNH ĐỔI CÓ Ý THỨC, ghi rõ vì nó vi phạm
      // luật «lọc trong SQL» của BE-1 một cách có kiểm soát: bộ lọc này phụ thuộc `feed_post_acks`
      // của CHÍNH actor, và nhét nó vào câu keyset làm trang trả về ít hơn `limit` một cách ngẫu
      // nhiên. FE dùng `unackedOnly` cho WIDGET (số đếm + vài dòng đầu), không cho cuộn vô hạn; con
      // số chính xác lấy từ `countOnly` (đếm TRONG SQL). Khi FE cần cuộn theo bộ lọc này, chuyển nó
      // thành vị từ `NOT EXISTS` trong `listFeed` — nợ ghi ở `S16-SOCIAL-BE-2`.
      const filtered = query.unackedOnly
        ? page.filter((r) => r.requiresAck && !acked.has(r.id))
        : page;

      // 🔴 CON TRỎ LẤY TỪ `page`, KHÔNG TỪ `filtered`. `filtered` rỗng (mọi tin trong cửa sổ keyset
      // đều đã ack) ⇒ `last` là `undefined` ⇒ `nextCursor: null` ⇒ theo hợp đồng DTO, FE hiểu là
      // HẾT DANH SÁCH và dừng hẳn — trong khi huy hiệu `countOnly` (đếm TRONG SQL) vẫn hiện số
      // dương. Hai đường của CÙNG một màn hình nói ngược nhau, HTTP 200, không log. Mốc con trỏ
      // phải là cửa sổ keyset THẬT, và cửa sổ đó là `page`.
      const last = page[page.length - 1];
      const hasMore = rows.length > query.limit;

      return {
        countOnly: false as const,
        rows: filtered,
        acked,
        nextCursor: hasMore && last ? encodeFeedCursor(cursorOf(last), fingerprint) : null,
      };
    });

    if (loaded.countOnly) {
      return { data: [], nextCursor: null, unackedCount: loaded.unackedCount };
    }

    // SAU khi tx đóng: `decorate` tự mở kết nối riêng (thẻ/cảm xúc/đã lưu) và ký URL đính kèm.
    const decorated = await this.postsService.decorateForViewer(actor, loaded.rows);

    return {
      data: decorated.map((d, i) => ({ ...d, ackedByMe: loaded.acked.has(loaded.rows[i]!.id) })),
      nextCursor: loaded.nextCursor,
      unackedCount: null,
    };
  }

  /**
   * `SOCIAL-API-021` — `POST /social/posts/{id}/ack`.
   *
   * ⚠️ `userId` LUÔN là `actor.id` — route không có DTO body, nên không có đường nào để client tự
   * khai người xác nhận (done_when: «body không nhận trường userId»).
   *
   * 409 `SOCIAL-ERR-011` khi bài không yêu cầu xác nhận: một hàng `feed_post_acks` trên bài thường là
   * rác trong một sổ APPEND-ONLY — không xoá lại được.
   */
  async ack(user: SocialRequestUser, postId: string): Promise<FeedAckResultDto> {
    const actor = await this.access.resolveActor(user, "postAck");

    return this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      if (post.type !== "news" || !post.requiresAck) {
        throw new ConflictException(SOCIAL_ERR.ACK_NOT_APPLICABLE);
      }
      const { firstTime, ackedAt } = await this.repo.ackPost(
        tx,
        actor.companyId,
        postId,
        actor.actorUserId,
      );
      return { postId, ackedAt: ackedAt.toISOString(), firstTime };
    });
  }

  /**
   * `SOCIAL-API-022` — `GET /social/posts/{id}/acks`.
   *
   * Tầng 1 = `manage:feed-news` (bảng hằng), tầng 2 = `resolveActor(user, "postAcksList")`. Actor
   * thường bị 403 Ở TẦNG 1 và KHÔNG chạm tới truy vấn nào — ca `C6` assert đúng điều đó bằng spy.
   */
  async listAcks(
    user: SocialRequestUser,
    postId: string,
    query: ListPostAcksQueryDto,
  ): Promise<FeedAckPageDto> {
    const actor = await this.access.resolveActor(user, "postAcksList");

    return this.db.withTenant(actor.companyId, async (tx) => {
      // Vẫn qua cổng visibility: `manage:feed-news` KHÔNG phải giấy thông hành đọc bài của đơn vị
      // khác — nó chỉ mở nửa «ai đã đọc» của bài mà actor vốn thấy được.
      const post = await this.access.assertPostVisible(tx, actor, postId);

      const { rows, total } =
        query.state === "acked"
          ? await this.repo.ackedPeople(tx, actor.companyId, postId, query)
          : await this.repo.unackedEmployeesFor(
              tx,
              actor.companyId,
              {
                id: postId,
                audience: post.audience,
                orgUnitId: post.orgUnitId,
                groupId: post.groupId,
              },
              query,
            );

      return {
        data: rows.map(toAckPerson),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  }
}

function toAckPerson(r: AckPersonRow) {
  return {
    employeeId: r.employeeId,
    fullName: r.fullName,
    avatarUrl: r.avatarUrl,
    ackedAt: r.ackedAt ? new Date(r.ackedAt).toISOString() : null,
  };
}

/** Mốc keyset của một hàng — `sortAt` do `listFeed` tính (`date_trunc('milliseconds', …)`). */
function cursorOf(row: PostRow) {
  return { sortAt: new Date(row.sortAt), id: row.id };
}
