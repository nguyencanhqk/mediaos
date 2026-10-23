/**
 * S16-SOCIAL-QA-1 (L5) — BẢNG «mỗi khoá lỗi SOCIAL ⇒ ca nào đo nó» (plan `docs/plans/S16-SOCIAL-QA-1.md`
 * Bảng 2 + D6).
 *
 * Kiểu `Record<SocialErrorKey, …>`: thêm một khoá vào bảng mã của contracts mà quên khai ở đây là lỗi
 * TYPECHECK, không phải một dòng bị bỏ sót lặng lẽ.
 *
 * Mỗi mục chỉ là CHUỖI: tên file int-spec + một đoạn của tên ca. File này nằm ở `test/helpers/` — ngoài
 * bề mặt mà census tĩnh quét — và không nhắc hằng mã nào, nên chữ trong bảng không thể tự làm xanh census.
 * Ca neo ở `test/integration/s16-social-qa1-error-codes.int-spec.ts` mới là thứ kiểm: file tồn tại, chứa
 * đúng tên ca, và chứa tham chiếu hằng mã của khoá đó.
 */
import type { SocialErrorKey } from "@mediaos/contracts";

/** Ca HTTP assert `error.code` bằng hằng mã của khoá. */
export interface Qa1HttpCodeCase {
  kind: "http";
  /** Tên file trong `apps/api/test/integration/`. */
  file: string;
  /** Một đoạn NGUYÊN VĂN của tên ca trong file đó. */
  anchor: string;
}

/**
 * Khoá được ném trong service nhưng KHÔNG ra tới dây qua HTTP (biên validate chặn trước, hoặc là chân
 * fail-closed). `file` / `anchor` trỏ ca ghim hành vi THẬT ở biên; vắng = không có đường HTTP nào để ghim.
 */
export interface Qa1UnreachableCodeCase {
  kind: "http-unreachable";
  why: string;
  file?: string;
  anchor?: string;
}

/** Khoá giữ chỗ, không chỗ nào ném. */
export interface Qa1NeverThrownCodeCase {
  kind: "never-thrown";
  why: string;
}

export type Qa1CodeCase = Qa1HttpCodeCase | Qa1UnreachableCodeCase | Qa1NeverThrownCodeCase;

const WIRE = "social-grouperr1-wire-codes.int-spec.ts";
const QA1 = "s16-social-qa1-error-codes.int-spec.ts";
const DOOR = "social-be1c-file-door.int-spec.ts";
const POLLS = "social-be2b1-polls.int-spec.ts";
const IDEAS = "social-be2b2-ideas.int-spec.ts";
const KUDOS = "social-be2b2-kudos.int-spec.ts";
const ACTIONS = "social-be3a-report-actions.int-spec.ts";
const BADGES = "social-be3a-kudos-badges.int-spec.ts";

const http = (file: string, anchor: string): Qa1HttpCodeCase => ({ kind: "http", file, anchor });

export const CODE_CASES: Record<SocialErrorKey, Qa1CodeCase> = {
  // ── Nhóm A — đã có ca theo mã từ trước (W1–W12) ──
  POST_NOT_FOUND: http(WIRE, "W8 — 404 bài lạ"),
  REPLY_DEPTH: http(WIRE, "W7 — 422 trả lời quá 1 cấp"),
  GROUP_NOT_FOUND: http(WIRE, "W1 — 404 nhóm lạ"),
  GROUP_MEMBERSHIP_EXISTS: http(WIRE, "W4 — 409 vào nhóm lần hai"),
  GROUP_ROLE_REQUIRED: http(WIRE, "W2 — 403 vai nhóm không đủ"),
  GROUP_LAST_OWNER: http(WIRE, "W3 — 409 owner cuối rời nhóm"),
  GROUP_NAME_TAKEN: http(WIRE, "W5 — 409 tên nhóm trùng"),
  GROUP_MEMBER_NOT_FOUND: http(WIRE, "W6 — 404 người không phải thành viên"),
  POLL_CREATE_REQUIRED: http(WIRE, "W11 — 403 thiếu `create:feed-poll`"),
  IDEA_APPROVE_REQUIRED: http(WIRE, "W12 — 403 `approve:feed-idea` @Department"),
  CURSOR_INVALID: http(WIRE, "W9 — 400 con trỏ hỏng"),
  PIN_NEWS_ONLY: http(WIRE, "W10 — 422 ghim bài KHÔNG phải tin tức"),

  // ── Nhóm B — ca đang có, nâng tại chỗ lên assert theo mã (QA1-E-U-01…27) ──
  FILE_TARGET_POST_DENIED: http(DOOR, "DENY: `commentOnly` + target=post"),
  FILE_TARGET_COMMENT_DENIED: http(DOOR, "DENY: `postOnly` + target=comment"),
  FILE_NOT_OWNED: http(DOOR, "DENY (IDOR): confirm tệp của NGƯỜI KHÁC"),
  GROUP_MEMBER_STATE_MISMATCH: http(
    "social-be2a-group-members.int-spec.ts",
    "G16 — `{role}` lên hàng `pending`",
  ),
  POLL_CLOSED: http(POLLS, "P-1 — bình chọn đã ĐÓNG"),
  POLL_VOTE_DUPLICATE: http(POLLS, "P-3 — bình chọn MỘT lựa chọn, gửi 2 optionId"),
  POLL_OPTIONS_RANGE: http(POLLS, "P-7 — số lựa chọn ngoài 2..10"),
  POLL_OPTION_NOT_FOUND: http(POLLS, "P-e — optionId của bình chọn KHÁC"),
  POLL_CLOSES_AT_PAST: http(POLLS, "closesAt trong QUÁ KHỨ"),
  IDEA_TRANSITION: http(IDEAS, "FSM: nhảy cóc `submitted → accepted`"),
  IDEA_CREATE_REQUIRED: http(IDEAS, "T-1 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-idea`"),
  IDEA_REJECT_NOTE_REQUIRED: http(IDEAS, "I-3 — `rejected` với note toàn khoảng trắng"),
  KUDOS_CREATE_REQUIRED: http(KUDOS, "T-2 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-kudos`"),
  KUDOS_BADGE_INVALID: http(KUDOS, "K-0 — huy hiệu `is_active=false`"),
  KUDOS_SELF_RECIPIENT: http(KUDOS, "K-1 — người nhận TRÙNG tác giả"),
  KUDOS_RECIPIENT_LIMIT: http(KUDOS, "K-2 — 11 người nhận"),
  KUDOS_RECIPIENT_INVALID: http(KUDOS, "K-2b — `employeeId` không thuộc tenant"),
  KUDOS_OFFICIAL_DENIED: http(KUDOS, "K-3 — `isOfficial:true` thiếu `manage:feed-kudos`"),
  REPORT_ACTION_DENIED: http(ACTIONS, "R1: vai CHỈ manage:feed-report"),
  REPORT_ACTION_INVALID_FOR_TARGET: http(ACTIONS, "R4: báo cáo BÌNH LUẬN + hide_post"),
  REPORT_ACTION_TARGET_UNAVAILABLE: http(ACTIONS, "R2: %s trên bài ĐÃ xoá"),
  REPORT_BUSY: http(ACTIONS, "R9: khoá đích bị giữ quá lock_timeout"),
  REPORT_ALREADY_DECIDED: http(ACTIONS, "R6: hai lượt resolve CÙNG báo cáo đồng thời"),
  KUDOS_BADGE_CODE_TAKEN: http(BADGES, "K3 — code trùng"),
  KUDOS_BADGE_NOT_FOUND: http(BADGES, "K2 — PATCH/DELETE huy hiệu của công ty B"),
  STATS_UNIT_OUT_OF_SCOPE: http(
    "social-be3b-engagement-stats.int-spec.ts",
    "S2: manager hỏi `orgUnitId` ngoài phạm vi",
  ),
  RESTORE_GROUP_DELETED: http(
    "social-be3c-recycle-restore.int-spec.ts",
    "D5: bài thuộc nhóm đã xoá mềm",
  ),

  // ── Nhóm C — ca mới của lát này (QA1-E-01…13) ──
  WRITE_OUT_OF_AUDIENCE: http(QA1, "QA1-E-01 ·"),
  NOT_CONTENT_OWNER: http(QA1, "QA1-E-02 ·"),
  COMMENTS_LOCKED: http(QA1, "QA1-E-03 ·"),
  ATTACHMENT_LIMIT: http(QA1, "QA1-E-04 ·"),
  ATTACHMENT_INVALID: http(QA1, "QA1-E-05 ·"),
  NEWS_MANAGE_REQUIRED: http(QA1, "QA1-E-06 ·"),
  MODERATION_FIELD_DENIED: http(QA1, "QA1-E-07 ·"),
  ACK_NOT_APPLICABLE: http(QA1, "QA1-E-08 ·"),
  REPORT_NOT_FOUND: http(QA1, "QA1-E-09 ·"),
  COMMENT_NOT_FOUND: http(QA1, "QA1-E-10 ·"),
  REPORT_DUPLICATE_OPEN: http(QA1, "QA1-E-11 ·"),
  POLL_WRITE_BUSY: http(QA1, "QA1-E-12 ·"),
  CURSOR_FILTER_MISMATCH: http(QA1, "QA1-E-13 ·"),

  // ── Nhóm D — không ra tới dây qua HTTP ──
  REACTION_EMOJI_INVALID: {
    kind: "http-unreachable",
    why: "schema của thân request từ chối giá trị ngoài bộ cảm xúc trước khi vào service (400 chung)",
    file: QA1,
    anchor: "QA1-E-X1 ·",
  },
  AUDIENCE_KEY_MISSING: {
    kind: "http-unreachable",
    why: "schema tạo bài từ chối audience thiếu khoá trước khi vào service (400 chung)",
    file: QA1,
    anchor: "QA1-E-X2 ·",
  },
  POST_TYPE_PAIR_DESYNC: {
    kind: "http-unreachable",
    why: "chân fail-closed: chỉ ném khi hai bảng hằng theo loại bài lệch nhau — hai bảng đang khớp",
  },

  // ── Nhóm E — không chỗ nào ném ──
  AUDIENCE_GROUP_NOT_AVAILABLE: {
    kind: "never-thrown",
    why: "hằng còn lại sau khi audience nhóm được mở; không chỗ nào ném",
  },
  MENTION_DROPPED_NOT_AN_ERROR: {
    kind: "never-thrown",
    why: "không phải lỗi: request vẫn 201, danh sách bị bỏ trả ở droppedMentions",
  },
};
