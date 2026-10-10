import { Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import { validate } from "nestjs-zod";
import { z } from "zod";

/**
 * S16-SOCIAL-QA-1 (QA1-BUG-2) — lớp chặn ký tự U+0000 ở BIÊN đầu vào của SOCIAL.
 *
 * U+0000 là ký tự duy nhất Postgres không lưu được trong cột văn bản (`22021`). Schema ở
 * `packages/contracts` không cấm nó, nên chuỗi mang ký tự này đi tới câu SQL rồi rơi vào nhánh 500
 * của bộ lọc lỗi chung. Lớp này từ chối sớm, bằng ĐÚNG hình dạng lỗi validation của kho:
 * `ZodValidationException` để `AllExceptionsFilter` dựng 400 `VALIDATION-ERR-001` + `details[]` như
 * khi Zod từ chối. Không tự dựng exception: luật là một schema Zod, chạy qua `validate` của nestjs-zod.
 *
 * Gắn ở CẤP CLASS của mọi controller SOCIAL, đứng TRƯỚC `ZodValidationPipe` (pipe cấp class chạy
 * trước pipe cấp method / tham số), và vẫn SAU guard — thứ tự 401 → 403 → 400 không đổi. Quét cả
 * thân lẫn query, mọi độ sâu, nên trường / route thêm sau tự được phủ mà không phải nhớ khai gì.
 * Phép kiểm đủ tĩnh ở `social-input-text.pipe.spec.ts` đỏ khi một controller SOCIAL thiếu lớp này.
 *
 * ⚠️ CHỈ U+0000. Các ký tự điều khiển khác đang là đầu vào hợp lệ; cấm thêm ở đây là đổi hành vi.
 * ⚠️ Tham số đường dẫn KHÔNG quét ở đây: mọi `@Param` của SOCIAL đã qua `ParseUUIDPipe`, và giữ
 * nguyên thân lỗi hiện có của nhánh đó. Điều kiện này được ghim bởi ca «mọi `@Param` của controller
 * SOCIAL qua `ParseUUIDPipe`» trong `social-input-text.pipe.spec.ts` (đọc AST từng decorator, có chốt
 * số site) — KHÔNG phải bởi `param-uuid-ratchet.unit-spec.ts`: ratchet đó chỉ đếm tham số tên `id` /
 * `…Id` trong file `*.controller.ts`, nên không nhìn thấy phần lớn tham số của SOCIAL.
 * ⚠️ Chi phí quét: chỉ chuỗi và object / mảng được đưa vào hàng chờ duyệt (số · boolean · null bị bỏ
 * qua ngay), nên bộ nhớ tạm tỉ lệ với số nút CÓ THỂ chứa chuỗi. Cận trên vẫn là giới hạn cỡ thân của
 * body-parser — nâng giới hạn đó thì xem lại lớp này.
 */

const NUL = String.fromCharCode(0);
/** Số trường tối đa nêu trong `details[]` — thân lỗi không phình theo cỡ request. */
export const SOCIAL_INPUT_TEXT_MAX_ISSUES = 20;
/** Thông điệp CỐ ĐỊNH — không nội suy giá trị đã gửi. */
export const SOCIAL_INPUT_TEXT_MESSAGE = "Chuỗi chứa ký tự không được hỗ trợ (U+0000)";
/** Tên khoá an toàn để nêu trong `field`; khoá khác (do client tự đặt) thay bằng `?`. */
const SAFE_KEY = /^[A-Za-z0-9_]{1,64}$/;

type Path = ReadonlyArray<string | number>;

/** Số đoạn tối đa của một đường dẫn nêu ra — `field` không dài theo độ sâu của request. */
export const SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS = 16;

const safeSegment = (key: string): string => (SAFE_KEY.test(key) ? key : "?");

/** Một nút đang chờ duyệt; đường dẫn giữ dạng CHUỖI LIÊN KẾT về gốc, chỉ dựng thành mảng khi cần báo. */
interface Pending {
  readonly value: unknown;
  readonly parent: Pending | null;
  readonly segment: string | number | null;
  readonly depth: number;
}

/** Chỉ chuỗi và object / mảng mới có thể mang U+0000 — kiểu khác không đáng một nút chờ duyệt. */
const canHoldText = (value: unknown): boolean =>
  typeof value === "string" || (typeof value === "object" && value !== null);

/** Dựng đường dẫn từ gốc tới `node`, giữ tối đa `SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS` đoạn ĐẦU. */
function pathOf(node: Pending, base: Path): Path {
  const room = Math.max(0, SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS - base.length);
  const segments: Array<string | number> = [];
  for (let cur: Pending | null = node; cur !== null && cur.segment !== null; cur = cur.parent) {
    if (cur.depth <= room) segments.push(cur.segment);
  }
  return [...base, ...segments.reverse()].slice(0, SOCIAL_INPUT_TEXT_MAX_PATH_SEGMENTS);
}

/**
 * Đường dẫn của mọi chuỗi (giá trị HOẶC tên khoá) chứa U+0000 trong `root`, tối đa `limit` mục.
 *
 * Duyệt bằng ngăn xếp tường minh, không đệ quy, và KHÔNG chép đường dẫn ở mỗi nút: độ sâu của thân
 * JSON do client chọn — đệ quy thì tràn ngăn xếp (500, đúng thứ lớp này sinh ra để tránh), còn chép
 * mảng đường dẫn ở mỗi tầng thì chi phí tăng theo bình phương độ sâu.
 */
export function findNulPaths(
  root: unknown,
  base: Path = [],
  limit: number = SOCIAL_INPUT_TEXT_MAX_ISSUES,
): Path[] {
  const found: Path[] = [];
  const stack: Pending[] = [{ value: root, parent: null, segment: null, depth: 0 }];
  while (stack.length > 0 && found.length < limit) {
    const node = stack.pop() as Pending;
    const { value } = node;
    if (typeof value === "string") {
      if (value.includes(NUL)) found.push(pathOf(node, base));
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const depth = node.depth + 1;
    if (Array.isArray(value)) {
      // Đẩy ngược để lấy ra theo thứ tự chỉ số tăng dần (thứ tự `details[]` ổn định).
      for (let i = value.length - 1; i >= 0; i -= 1) {
        const item = value[i] as unknown;
        if (canHoldText(item)) stack.push({ value: item, parent: node, segment: i, depth });
      }
      continue;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [key, child] = entries[i] as [string, unknown];
      // Khoá mang U+0000: báo như một chuỗi con rồi thôi — không đi tiếp vào giá trị của nó.
      const next = key.includes(NUL) ? NUL : child;
      if (canHoldText(next)) {
        stack.push({ value: next, parent: node, segment: safeSegment(key), depth });
      }
    }
  }
  return found;
}

/**
 * Schema Zod «không chuỗi nào chứa U+0000» cho một giá trị bất kỳ; `base` = đoạn đường dẫn đứng
 * trước (tên trường khi decorator trao riêng một trường).
 */
export function socialInputTextSchema(base: Path = []): z.ZodType<unknown> {
  return z.unknown().superRefine((value, ctx) => {
    for (const path of findNulPaths(value, base)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: SOCIAL_INPUT_TEXT_MESSAGE,
      });
    }
  });
}

/** Schema cho trường hợp thường gặp (decorator trao CẢ thân / query): dựng MỘT lần, dùng lại. */
const ROOT_SCHEMA = socialInputTextSchema();

/** Schema pipe dùng cho một tham số: hằng gốc khi không có tên trường, dựng mới khi có. */
export function socialInputTextSchemaFor(field: string | undefined): z.ZodType<unknown> {
  // `@Body("x")` / `@Query("x")` trao riêng một trường ⇒ đường dẫn bắt đầu từ tên trường đó.
  return field ? socialInputTextSchema([safeSegment(field)]) : ROOT_SCHEMA;
}

@Injectable()
export class SocialInputTextPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== "body" && metadata.type !== "query") return value;
    // `validate` của nestjs-zod tự ném `ZodValidationException` — cùng đường với `ZodValidationPipe`.
    validate(value, socialInputTextSchemaFor(metadata.data));
    return value;
  }
}
