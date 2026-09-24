import { feedCreatableTypeSchema } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_KUDOS_FLAG_PAIRS,
  SOCIAL_MODERATION_FIELD_PAIRS,
  SOCIAL_POST_TYPE_PAIRS,
} from "./social-route-pairs.const";
import { SOCIAL_POST_TYPE_DENIED } from "./social.errors";

/**
 * S16-SOCIAL-BE-2B-2 · **C-6** — CẤU TRÚC của ba bảng cặp-theo-payload (plan D2b · D22).
 *
 * ┌─ VÌ SAO CẦN SPEC NÀY KHI ĐÃ CÓ `satisfies` ────────────────────────────────────────────────────┐
 * │ `satisfies Record<FeedCreatableTypeDto, …>` bắt được chiều "enum mở mà bảng thiếu khoá". Nó      │
 * │ KHÔNG bắt được ba chiều còn lại, và cả ba đều là lỗ thật:                                       │
 * │                                                                                                 │
 * │  (a) **bảng có khoá LẠ mà enum không có** — `Record<K, V>` không cấm khoá dư trên một object    │
 * │      literal `as const` khi nó vẫn thoả mọi khoá bắt buộc… và một khoá `"pool"` gõ sai sẽ nằm    │
 * │      đó im lặng, không route nào đọc tới;                                                       │
 * │  (b) **non-null bên PAIRS mà null bên DENIED** — `satisfies` chỉ ép ĐỦ KHOÁ, không ép "có cặp   │
 * │      ⇒ có mã lỗi". Lệch chiều này làm `assertCreatablePostType` rơi vào chân fail-closed         │
 * │      `SOCIAL_POST_TYPE_PAIR_DESYNC`: an toàn, nhưng 403 nói SAI lý do;                          │
 * │  (c) **cặp rỗng** — `{action:"", resourceType:""}` thoả kiểu hoàn hảo và `resolveManyOrNull` sẽ  │
 * │      trả `null` cho nó ⇒ route đó 403 với MỌI người, kể cả `company-admin`.                     │
 * │                                                                                                 │
 * │ Và lý do thứ tư, không thuộc tầng kiểu: `SOCIAL_KUDOS_FLAG_PAIRS` là bảng **một dòng**. Không có │
 * │ spec này thì cặp `manage:feed-kudos` của `isOfficial` chỉ được MỘT ca HTTP giữ — xoá dòng        │
 * │ `resolveManyOrNull` khỏi `create()` là mọi census/sổ/ratchet vẫn XANH.                           │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Spec này THAY lưới `done_when` #8 của backlog («mỗi cặp non-null xuất hiện ĐÚNG MỘT LẦN dưới
 * dạng literal trong `social-posts.service.ts`»). Lưới đó **không thoả được**: BE-2B-1 đã dời toàn bộ
 * cặp vào bảng hằng ⇒ phép đếm literal = 0 trong khi assert đòi = 1, tức đỏ vĩnh viễn, và cách "sửa"
 * duy nhất là nhét literal trở lại = dựng nguồn sự thật thứ hai cho cặp quyền. Owner ký **S7**
 * 24/09/2026 (memory `gate-measurement-row-can-be-unsatisfiable`).
 *
 * PHÉP ĐO CỔNG (đã chạy 24/09/2026, khôi phục sau): xoá khoá `kudos` khỏi `SOCIAL_POST_TYPE_DENIED`
 * ⇒ TS đỏ **và** ca "hai bảng cùng TẬP khoá" đỏ. Đổi `feed-kudos` thành `feed-post` trong
 * `SOCIAL_KUDOS_FLAG_PAIRS` ⇒ ca cặp `isOfficial` đỏ (TS thì KHÔNG, vì cả hai đều là `string`).
 */

type PairShape = { action: string; resourceType: string; isSensitive: boolean };

/** Số loại bài tạo được, gõ TAY. Neo dương: bảng rỗng thì mọi so-TẬP dưới đây thành vacuous. */
const EXPECTED_CREATABLE_TYPES = 5;

const nonNullPairs = (table: Record<string, PairShape | null>): Array<[string, PairShape]> =>
  Object.entries(table).filter((e): e is [string, PairShape] => e[1] !== null);

describe("S16-SOCIAL-BE-2B-2 · C-6 · cấu trúc bảng cặp-theo-payload", () => {
  it("neo dương: enum loại bài tạo được có ĐÚNG 5 giá trị, bảng cặp có ĐÚNG 5 khoá", () => {
    expect(feedCreatableTypeSchema.options.length).toBe(EXPECTED_CREATABLE_TYPES);
    expect(Object.keys(SOCIAL_POST_TYPE_PAIRS).length).toBe(EXPECTED_CREATABLE_TYPES);
    expect(Object.keys(SOCIAL_POST_TYPE_DENIED).length).toBe(EXPECTED_CREATABLE_TYPES);
  });

  it("TẬP khoá: PAIRS = DENIED = feedCreatableTypeSchema.options (cả hai chiều)", () => {
    const enumKeys = [...feedCreatableTypeSchema.options].sort();
    expect(Object.keys(SOCIAL_POST_TYPE_PAIRS).sort()).toEqual(enumKeys);
    expect(Object.keys(SOCIAL_POST_TYPE_DENIED).sort()).toEqual(enumKeys);
  });

  it("neo dương: ≥4 loại có cặp phụ non-null (chỉ `share` được null)", () => {
    const pairs = nonNullPairs(SOCIAL_POST_TYPE_PAIRS);
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    expect(SOCIAL_POST_TYPE_PAIRS.share).toBeNull();
  });

  it("mọi cặp non-null có `action`/`resourceType` KHÔNG rỗng (cặp rỗng ⇒ 403 cho mọi người)", () => {
    for (const [type, pair] of nonNullPairs(SOCIAL_POST_TYPE_PAIRS)) {
      expect(pair.action.trim().length, `${type}.action rỗng`).toBeGreaterThan(0);
      expect(pair.resourceType.trim().length, `${type}.resourceType rỗng`).toBeGreaterThan(0);
      // Mirror catalog `0578`: cả 14 cặp `feed-*` đều `is_sensitive = false`.
      expect(pair.isSensitive, `${type}.isSensitive phải mirror catalog 0578`).toBe(false);
    }
  });

  it("non-null bên PAIRS ⇒ non-null bên DENIED (chiều `satisfies` KHÔNG ép được)", () => {
    for (const [type] of nonNullPairs(SOCIAL_POST_TYPE_PAIRS)) {
      const denied: string | null | undefined =
        SOCIAL_POST_TYPE_DENIED[type as keyof typeof SOCIAL_POST_TYPE_DENIED];
      // `?? null` CÓ CHỦ ĐÍCH: khoá VẮNG HẲN trả `undefined`, và `.not.toBeNull()` trần sẽ cho nó đi
      // qua rồi đỏ ở dòng sau với thông điệp "mã lỗi rỗng" — đúng kết quả, sai lý do. Đo thật ở phép
      // ĐO CỔNG 24/09/2026 (xoá khoá `kudos`).
      expect(denied ?? null, `${type} có cặp quyền nhưng KHÔNG có mã lỗi 403`).not.toBeNull();
      expect((denied ?? "").trim().length, `${type} mã lỗi rỗng`).toBeGreaterThan(0);
    }
    // Và chiều ngược: `share` null cả hai bên — không có mã lỗi chết cho một loại không cần cặp.
    expect(SOCIAL_POST_TYPE_DENIED.share).toBeNull();
  });

  it("mỗi loại có cặp phụ mang mã lỗi RIÊNG (hai loại dùng chung một chuỗi ⇒ 403 nói sai lý do)", () => {
    const messages = nonNullPairs(SOCIAL_POST_TYPE_PAIRS).map(
      ([type]) => SOCIAL_POST_TYPE_DENIED[type as keyof typeof SOCIAL_POST_TYPE_DENIED],
    );
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("D1: `idea`/`kudos` ánh xạ đúng cặp của API-19 §5.1b", () => {
    expect(SOCIAL_POST_TYPE_PAIRS.idea).toEqual({
      action: "create",
      resourceType: "feed-idea",
      isSensitive: false,
    });
    expect(SOCIAL_POST_TYPE_PAIRS.kudos).toEqual({
      action: "create",
      resourceType: "feed-kudos",
      isSensitive: false,
    });
  });

  it("D22: `SOCIAL_KUDOS_FLAG_PAIRS.isOfficial` = `manage:feed-kudos`", () => {
    expect(Object.keys(SOCIAL_KUDOS_FLAG_PAIRS)).toEqual(["isOfficial"]);
    expect(SOCIAL_KUDOS_FLAG_PAIRS.isOfficial).toEqual({
      action: "manage",
      resourceType: "feed-kudos",
      isSensitive: false,
    });
    // 🔴 Cặp của CỜ phải KHÁC cặp của LOẠI bài: `create:feed-kudos` cho phép đăng vinh danh thường,
    // `manage:feed-kudos` mới là dấu công ty. Hai cặp bằng nhau = `isOfficial` miễn phí cho mọi người.
    expect(SOCIAL_KUDOS_FLAG_PAIRS.isOfficial).not.toEqual(SOCIAL_POST_TYPE_PAIRS.kudos);
  });

  it("bảng cặp-theo-TRƯỜNG của `006` không bị WO này chạm (3 trường, cặp giữ nguyên)", () => {
    // Neo hồi quy: `SOCIAL_KUDOS_FLAG_PAIRS` là bảng MỚI, không phải chỗ để dời 3 trường kiểm duyệt.
    expect(Object.keys(SOCIAL_MODERATION_FIELD_PAIRS).sort()).toEqual([
      "commentsLocked",
      "hidden",
      "pinned",
    ]);
  });
});
