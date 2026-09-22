import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type {
  FeedBirthdayListDto,
  FeedPostPageDto,
  FeedTagPageDto,
  ListBirthdaysQueryDto,
  ListProfilePostsQueryDto,
  ListTagsQueryDto,
  SearchFeedQueryDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { SocialAccessService } from "./social-access.service";
import { SocialDiscoveryRepository } from "./social-discovery.repository";
import { decodeFeedCursor, fingerprintFeedFilter } from "./social-feed-cursor";
import { getPreferencesForUsers } from "./social-preferences";
import { SocialPostsRepository } from "./social-posts.repository";
import { SocialPostsService } from "./social-posts.service";
import type { SocialActor, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-1B — `SOCIAL-API-023..026` (tìm kiếm · thẻ · trang cá nhân · sinh nhật).
 *
 * Ba trong bốn route trả THẺ BÀI và vì vậy đi qua ĐÚNG `SocialPostsRepository.listFeed` +
 * `SocialPostsService.toPageForViewer` của BE-1 — không repository bài thứ hai, không bản
 * `visiblePostCondition` thứ hai.
 */
@Injectable()
export class SocialDiscoveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialDiscoveryRepository,
    private readonly posts: SocialPostsRepository,
    private readonly postsService: SocialPostsService,
  ) {}

  /**
   * `SOCIAL-API-023` — `GET /social/search`. **ĐIỂM CHIẾU DANH TÍNH** (tên tác giả trên thẻ bài), đã
   * bound bằng `visiblePostCondition` NGAY TRONG câu.
   */
  async search(user: SocialRequestUser, query: SearchFeedQueryDto): Promise<FeedPostPageDto> {
    const actor = await this.access.resolveActor(user, "search");

    // Từ khoá NẰM TRONG dấu vân: đổi từ khoá giữa hai lần lật trang phải là 400 (tải lại từ đầu),
    // không phải lật tiếp một trang cắt theo tập CŨ.
    const fingerprint = feedScopeFingerprint(actor, ["search", query.q]);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.posts.listFeed(tx, actor, {
        sort: "active",
        limit: query.limit,
        cursor,
        searchText: query.q,
      }),
    );
    return this.postsService.toPageForViewer(actor, rows, query.limit, fingerprint);
  }

  /** `SOCIAL-API-024` — `GET /social/tags`. KHÔNG chiếu danh tính (xem repository). */
  async listTags(user: SocialRequestUser, query: ListTagsQueryDto): Promise<FeedTagPageDto> {
    const actor = await this.access.resolveActor(user, "tagsList");

    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listTags(tx, actor.companyId, {
        // Chuẩn hoá GIỐNG lúc ghi (`parseHashtags`): hạ chữ thường, bỏ `#` đầu. Không chuẩn hoá thì
        // gõ `#Lương` không tìm ra `luong` đã lưu — im lặng trả rỗng.
        q: query.q ? query.q.replace(/^#/, "").toLowerCase() : undefined,
        page: query.page,
        limit: query.limit,
      }),
    );
    return { data: rows, page: query.page, limit: query.limit, total };
  }

  /**
   * `SOCIAL-API-025` — `GET /social/profiles/{employee_id}/posts`.
   *
   * ┌─ C5 — `employee_id` (tham số) → `author_user_id` (cột `listFeed` nhận) ────────────────────────┐
   * │ `listFeed` lọc theo `authorUserId`. Tra `employee_profiles` MỘT LẦN để đổi khoá, thay vì mở     │
   * │ thêm một bộ lọc `authorEmployeeId` song song trên `feed_posts`: hai đường lọc tác giả là hai    │
   * │ thứ để trôi khỏi nhau khi một bài có `author_employee_id` NULL (nhân viên đã rời).              │
   * │                                                                                                 │
   * │ 🔴 **KHÔNG 404 khi `employee_id` lạ.** Nhân viên không tồn tại / thuộc tenant khác ⇒ trả CÙNG   │
   * │ một trang RỖNG như nhân viên có thật nhưng chưa đăng bài nào actor thấy được. Một 404 riêng ở   │
   * │ đây là oracle dò danh bạ: gõ UUID rồi đọc mã trạng thái là học được "người này có tồn tại". Ca  │
   * │ `C5` so hai response BYTE-GIỐNG-NHAU.                                                           │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async profilePosts(
    user: SocialRequestUser,
    employeeId: string,
    query: ListProfilePostsQueryDto,
  ): Promise<FeedPostPageDto> {
    const actor = await this.access.resolveActor(user, "profilePosts");

    const fingerprint = feedScopeFingerprint(actor, ["profile", employeeId]);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;

    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      const authorUserId = await this.resolveEmployeeUserId(tx, actor.companyId, employeeId);
      // Không tra ra ⇒ trang rỗng NGAY, không truy vấn bài. Rẽ nhánh sớm thay vì truyền một UUID
      // "không khớp gì": một UUID bịa vẫn là một tham số đi vào câu SQL, và người đọc sau sẽ phải tự
      // hỏi nó có thể trùng thật không.
      if (!authorUserId) return [];
      return this.posts.listFeed(tx, actor, {
        sort: "active",
        limit: query.limit,
        cursor,
        authorUserId,
      });
    });

    return this.postsService.toPageForViewer(actor, rows, query.limit, fingerprint);
  }

  /**
   * `SOCIAL-API-026` — `GET /social/birthdays`. **ĐIỂM CHIẾU DANH TÍNH + PII.**
   *
   * 🔴 DTO ĐÚNG 5 khoá `{employeeId, fullName, avatar, day, month}` (SPEC-16 §3.5) — không năm, không
   * tuổi, không `date_of_birth`, không `userId`. `userId` chỉ sống trong hàng repository để tra
   * preference, và bị BỎ ở đây.
   *
   * Cờ ẩn đi qua `getPreferencesForUsers` — hàm DUY NHẤT của module đọc preference của NGƯỜI KHÁC
   * (`social-preferences.ts`). Ba trạng thái `true` · `null` · **vắng mặt trong Map** đều là "hiện";
   * CHỈ `false` mới ẩn. Viết `=== false`, KHÔNG `!pref?.showBirthday` (nhánh sau làm widget rỗng cho
   * cả công ty).
   */
  async birthdays(
    user: SocialRequestUser,
    query: ListBirthdaysQueryDto,
  ): Promise<FeedBirthdayListDto> {
    const actor = await this.access.resolveActor(user, "birthdays");

    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      const found = await this.repo.birthdays(tx, actor.companyId, query.range, new Date());
      const prefs = await getPreferencesForUsers(
        tx,
        actor.companyId,
        found.map((r) => r.userId).filter((id): id is string => id != null),
      );
      return found.filter((r) => {
        if (r.userId == null) return true; // Không có tài khoản ⇒ không có preference ⇒ mặc định hiện.
        return prefs.get(r.userId)?.showBirthday !== false;
      });
    });

    return {
      data: rows.map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        avatar: r.avatar,
        day: r.day,
        month: r.month,
      })),
    };
  }

  /** `employee_id` → `user_id` trong CÙNG tenant, nhân viên chưa xoá. `null` = không tra ra (xem C5). */
  private async resolveEmployeeUserId(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.id, employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }
}

/**
 * Dấu vân của một dòng cuộn thuộc BE-1B — MỌI thứ ảnh hưởng tới TẬP kết quả.
 *
 * `canManagePosts` + `orgUnitIds` nằm trong dấu vân vì chúng quyết định tập bài nhìn thấy được: một
 * người vừa bị thu hồi `manage:feed-post` giữa hai lần lật trang phải nhận 400 (tải lại từ đầu), chứ
 * không được lật tiếp một trang cắt theo tập CŨ rộng hơn (cùng lập luận `feedFingerprint` của BE-1).
 */
function feedScopeFingerprint(actor: SocialActor, extra: readonly string[]): string {
  return fingerprintFeedFilter([
    ...extra,
    actor.actorUserId,
    String(actor.canManagePosts),
    [...actor.orgUnitIds].sort().join(","),
  ]);
}
