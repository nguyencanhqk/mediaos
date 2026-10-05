/**
 * S16-SOCIAL-FE-3 (L2) — hành động KÈM khi kết thúc một báo cáo (`SOCIAL-API-029`): ma trận theo loại
 * đích, bảng nhãn, và hàm dựng body. Hộp thoại xử lý báo cáo chỉ ĐỌC file này — không tự suy lựa chọn,
 * nhãn hay hình dạng body.
 *
 * ┌─ NGUỒN CỦA MA TRẬN (plan D7 · M3) ─────────────────────────────────────────────────────────────┐
 * │ `REPORT_ACTION_MATRIX` là BẢN CHÉP của `apps/api/src/social/social-report-actions.ts:20-23`      │
 * │ (`REPORT_ACTION_MATRIX`, quyết định D2 của S16-SOCIAL-BE-3A). Không import được: `apps/api` nằm  │
 * │ ngoài biên của app, và hằng chưa có ở `packages/contracts` (nợ ghi ở plan §8).                   │
 * │ Server vẫn là cổng THẬT: tổ hợp sai ⇒ 422 `SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET`. Bản     │
 * │ chép này chỉ để KHÔNG mời người dùng chọn thứ server sẽ từ chối. Sửa ma trận ở server ⇒ sửa ở    │
 * │ đây + bảng nhãn dưới (TS đỏ nếu quên nhãn) + ca viết tay ở `report-actions.spec.ts`.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Nghĩa của CÙNG một hành động khác nhau theo loại đích (plan M2b · B27):
 *   · `lock_comments` trên báo cáo BÌNH LUẬN khoá bình luận của BÀI CHA, không phải «khoá bình luận này».
 *   · `delete_target` xoá BÀI (đích `post`) hoặc xoá chính BÌNH LUẬN (đích `comment`).
 *   · `hide_post` không có cho đích `comment`: ẩn bài vì một bình luận là phạt tác giả bài cho lỗi của
 *     người khác.
 * ⇒ hai loại đích KHÔNG dùng chung nhãn `lock_comments` / `delete_target`, và chữ ô tick xác nhận xoá
 *   nói rõ xoá CÁI GÌ.
 */
import type { FeedReportActionDto, FeedTargetTypeDto } from "@mediaos/contracts";
import type { ResolveFeedReportBody } from "@mediaos/web-core";

/** «Không kèm hành động» — giá trị mặc định của ô chọn; KHÔNG bao giờ được gửi lên (vắng khoá = `none`). */
export const NO_REPORT_ACTION = "none" satisfies FeedReportActionDto;

/** Hành động hợp lệ theo loại đích, theo THỨ TỰ hiển thị. Chép từ server — xem docblock. */
export const REPORT_ACTION_MATRIX = {
  post: ["none", "hide_post", "lock_comments", "delete_target"],
  comment: ["none", "lock_comments", "delete_target"],
} as const satisfies Record<FeedTargetTypeDto, readonly FeedReportActionDto[]>;

type ActionOf<T extends FeedTargetTypeDto> = (typeof REPORT_ACTION_MATRIX)[T][number];

const LABEL_ROOT = "admin.moderation.action";

/**
 * `loại đích × hành động → khoá i18n` (namespace `social`) của NHÃN lựa chọn. Kiểu ép mỗi loại đích có
 * nhãn cho ĐÚNG các hành động của hàng ma trận — thiếu nhãn hoặc thừa `hide_post` ở `comment` là TS đỏ.
 */
export const REPORT_ACTION_LABEL_KEYS: {
  readonly [T in FeedTargetTypeDto]: Readonly<Record<ActionOf<T>, string>>;
} = {
  post: {
    none: `${LABEL_ROOT}.none`,
    hide_post: `${LABEL_ROOT}.post.hide_post`,
    lock_comments: `${LABEL_ROOT}.post.lock_comments`,
    delete_target: `${LABEL_ROOT}.post.delete_target`,
  },
  comment: {
    none: `${LABEL_ROOT}.none`,
    lock_comments: `${LABEL_ROOT}.comment.lock_comments`,
    delete_target: `${LABEL_ROOT}.comment.delete_target`,
  },
};

/** Khoá i18n của chữ Ô TICK xác nhận trước khi gửi `delete_target`, theo loại đích. */
export const REPORT_DELETE_CONFIRM_KEYS: Readonly<Record<FeedTargetTypeDto, string>> = {
  post: "admin.moderation.deleteConfirm.post",
  comment: "admin.moderation.deleteConfirm.comment",
};

export interface ReportActionOption {
  action: FeedReportActionDto;
  /** Khoá i18n trong namespace `social` — `t(option.labelKey)`. */
  labelKey: string;
}

/** Các lựa chọn của ô «Hành động kèm» cho một loại đích: đúng hàng ma trận, đúng thứ tự, kèm nhãn. */
export function reportActionOptions(targetType: FeedTargetTypeDto): readonly ReportActionOption[] {
  const actions: readonly FeedReportActionDto[] = REPORT_ACTION_MATRIX[targetType];
  const labels: Readonly<Partial<Record<FeedReportActionDto, string>>> =
    REPORT_ACTION_LABEL_KEYS[targetType];
  return actions.flatMap((action) => {
    const labelKey = labels[action];
    return labelKey === undefined ? [] : [{ action, labelKey }];
  });
}

/**
 * Hành động đòi tick xác nhận trước khi gửi (plan D10): chỉ `delete_target` — chưa có màn khôi phục.
 * `hide_post` / `lock_comments` hoàn tác được nên không đòi.
 */
export function reportActionNeedsConfirm(action: FeedReportActionDto): boolean {
  return action === "delete_target";
}

/** Quyết định của người kiểm duyệt: «Giải quyết» (`resolved`) hoặc «Bỏ qua» (`dismissed`). */
export type ReportDecision = ResolveFeedReportBody["status"];

/** Nháp của hộp thoại tại thời điểm bấm «Xác nhận». */
export interface ResolveDraft {
  decision: ReportDecision;
  /** Giá trị ô «Hành động kèm» — có thể còn sót từ trước khi người dùng đổi sang «Bỏ qua». */
  action: FeedReportActionDto;
  /** Ghi chú xử lý, nguyên văn ô nhập (chưa trim). */
  note: string;
  /** `useCan("manage", "feed-post")` — cặp THÊM mà mọi hành động kèm đòi ở tầng 2 của 029. */
  canManagePosts: boolean;
}

/**
 * Body của `029`. Luật BỎ khoá (mỗi luật một lý do thật, không phải gọn cho đẹp):
 *  · `action` chỉ có mặt khi «Giải quyết» VÀ người gửi có `manage:feed-post` VÀ hành động ≠ «không».
 *    — «Bỏ qua» + `action` ≠ none bị refine của hợp đồng từ chối (400), kể cả khi `action` chỉ là giá
 *      trị còn sót trong state từ lúc trước khi đổi quyết định.
 *    — Thiếu `manage:feed-post` mà gửi `action` là 403 `REPORT-ACTION-DENIED` cho một ô người đó không
 *      hề nhìn thấy.
 *    — «không» ⇒ bỏ khoá: vắng = `none` ở server, và API trước BE-3A (`.strict()`, chưa biết `action`)
 *      vẫn nhận.
 *  · `resolutionNote` rỗng/toàn khoảng trắng ⇒ bỏ khoá; có chữ ⇒ gửi bản đã trim (server cũng trim).
 */
export function buildResolveBody(draft: ResolveDraft): ResolveFeedReportBody {
  const note = draft.note.trim();
  const hasAction =
    draft.decision === "resolved" && draft.canManagePosts && draft.action !== NO_REPORT_ACTION;
  return {
    status: draft.decision,
    ...(note.length > 0 ? { resolutionNote: note } : {}),
    ...(hasAction ? { action: draft.action } : {}),
  };
}
