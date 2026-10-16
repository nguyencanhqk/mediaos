/**
 * S16-SOCIAL-FE-2D — luật THUẦN của khay đính kèm (plan §4 A3 · ca **C1 · C2** + ánh xạ lỗi A3/A9).
 *
 * Trần phía client chép ĐÚNG trần của server — lệch là chặn nhầm (người dùng không gửi được thứ hợp lệ)
 * hoặc cho lọt rồi ăn lỗi vô danh:
 *  - `> 20 MB/tệp`, `> 10 ảnh`, `> 1 video` ⇒ server 422 `SOCIAL-ERR-007` (`social-attachments.service.ts`);
 *  - `> 11 tệp` ⇒ Zod `createFeedPostSchema` từ chối = **400 VÔ DANH** (đo M10) ⇒ FE PHẢI chặn trước.
 * Chỉ dùng hằng contracts — không số tự gõ.
 */
import { describe, expect, it } from "vitest";
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_IMAGES_PER_POST,
  FOUNDATION_FILE_ERROR_CODES,
  SOCIAL_ERROR_CODES,
} from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import {
  attachmentErrorReason,
  attachmentKindOf,
  attachmentSubmitState,
  attachmentUploadErrorReason,
  planAttachmentAdds,
  type AttachmentItem,
} from "./attachment-draft";

/** Tệp với `size` tuỳ ý mà không cấp phát thật 20 MB. */
function fileOf(name: string, type: string, size = 3): File {
  const f = new File(["abc"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}
const image = (name = "a.png", size = 3) => fileOf(name, "image/png", size);
const video = (name = "v.mp4") => fileOf(name, "video/mp4");
const pdf = (name = "d.pdf") => fileOf(name, "application/pdf");
/** `toEqual` coi mọi `File` là bằng nhau (không có thuộc tính riêng đếm được) ⇒ so TÊN khi cần biết ĐÚNG tệp nào. */
const namesOf = (files: readonly File[]): string[] => files.map((f) => f.name);

let seq = 0;
function item(over: Partial<AttachmentItem>): AttachmentItem {
  seq += 1;
  return {
    id: `local-${seq}`,
    file: pdf(),
    name: "d.pdf",
    sizeBytes: 3,
    kind: "file",
    status: "done",
    fileId: null,
    previewUrl: null,
    error: null,
    ...over,
  };
}

describe("C1 — planAttachmentAdds: trần client = trần server", () => {
  it("11 ảnh ⇒ nhận ĐÚNG 10, ảnh thứ 11 bị từ chối `tooManyImages`", () => {
    const files = Array.from({ length: 11 }, (_, i) => image(`a${i}.png`));
    const plan = planAttachmentAdds([], files);
    expect(plan.accepted).toHaveLength(FEED_MAX_IMAGES_PER_POST);
    expect(plan.rejected).toEqual([{ name: "a10.png", reason: "tooManyImages" }]);
  });

  it("đã có 1 video ⇒ video thứ hai bị từ chối `tooManyVideos`", () => {
    const plan = planAttachmentAdds([item({ kind: "video" })], [video("v2.mp4")]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toEqual([{ name: "v2.mp4", reason: "tooManyVideos" }]);
  });

  it("biên 20 MB: `20MB + 1` ⇒ `tooLarge`; ĐÚNG 20 MB ⇒ nhận", () => {
    const over = image("lon.png", FEED_MAX_ATTACHMENT_BYTES + 1);
    const exact = image("vua.png", FEED_MAX_ATTACHMENT_BYTES);
    const plan = planAttachmentAdds([], [over, exact]);
    expect(namesOf(plan.accepted)).toEqual(["vua.png"]);
    expect(plan.rejected).toEqual([{ name: "lon.png", reason: "tooLarge" }]);
  });

  it("10 ảnh + 1 video + 1 pdf ⇒ pdf vượt trần TỔNG 11 ⇒ `tooManyFiles` (Zod sẽ 400 vô danh)", () => {
    const files = [
      ...Array.from({ length: 10 }, (_, i) => image(`a${i}.png`)),
      video(),
      pdf("thua.pdf"),
    ];
    const plan = planAttachmentAdds([], files);
    expect(plan.accepted).toHaveLength(11);
    expect(plan.rejected).toEqual([{ name: "thua.pdf", reason: "tooManyFiles" }]);
  });

  it("ô LỖI không tính vào trần (người dùng sẽ gỡ/thử lại nó) — 9 ảnh tốt + 1 ảnh lỗi ⇒ thêm được 1", () => {
    const items = [
      ...Array.from({ length: 9 }, () => item({ kind: "image" })),
      item({ kind: "image", status: "error", error: "uploadFailed" }),
    ];
    const plan = planAttachmentAdds(items, [image("moi.png")]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });

  it("MIME viết HOA vẫn là ảnh (mirror `kindOf` BE: hạ chữ thường trước khi so tiền tố)", () => {
    expect(attachmentKindOf("IMAGE/PNG")).toBe("image");
    expect(attachmentKindOf("Video/MP4")).toBe("video");
    expect(attachmentKindOf("")).toBe("file");
    const files = Array.from({ length: 11 }, (_, i) => fileOf(`A${i}.PNG`, "IMAGE/PNG"));
    expect(planAttachmentAdds([], files).rejected).toEqual([
      { name: "A10.PNG", reason: "tooManyImages" },
    ]);
  });
});

/**
 * Plan §13.3 V2 — tệp RỖNG. Server không nhận tệp cỡ 0 và trả CÙNG mã với «vượt dung lượng»; để lọt tới đó thì ô tệp
 * báo «vượt dung lượng» cho một tệp 0 byte. Client vì vậy chặn trước, với lý do riêng.
 */
describe("V2 — planAttachmentAdds: tệp RỖNG (0 byte) bị chặn TRƯỚC khi tải, lý do riêng `empty`", () => {
  it("DENY: tệp 0 byte ⇒ `empty`, KHÔNG vào hàng tải", () => {
    const plan = planAttachmentAdds([], [fileOf("rong.pdf", "application/pdf", 0)]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toEqual([{ name: "rong.pdf", reason: "empty" }]);
  });

  it("ALLOW (biên): tệp 1 byte đi tiếp", () => {
    const oneByte = fileOf("mot-byte.pdf", "application/pdf", 1);
    const plan = planAttachmentAdds([], [oneByte]);
    expect(namesOf(plan.accepted)).toEqual(["mot-byte.pdf"]);
    expect(plan.rejected).toEqual([]);
  });

  it("tệp rỗng KHÔNG chiếm chỗ của trần: 10 ảnh thật + 1 ảnh rỗng ⇒ 10 nhận, 1 `empty` — dù ảnh rỗng đứng đầu hay cuối lượt chọn", () => {
    const real = Array.from({ length: FEED_MAX_IMAGES_PER_POST }, (_, i) => image(`a${i}.png`));
    const blank = image("rong.png", 0);

    // Đứng ĐẦU: nếu nó giữ một chỗ của trần 10 ảnh thì ảnh thật cuối cùng bị `tooManyImages`.
    const blankFirst = planAttachmentAdds([], [blank, ...real]);
    expect(namesOf(blankFirst.accepted)).toEqual(namesOf(real));
    expect(blankFirst.rejected).toEqual([{ name: "rong.png", reason: "empty" }]);

    // Đứng CUỐI (ảnh thứ 11): lý do vẫn là `empty` — nói về chính tệp, không phải về trần.
    const blankLast = planAttachmentAdds([], [...real, blank]);
    expect(namesOf(blankLast.accepted)).toEqual(namesOf(real));
    expect(blankLast.rejected).toEqual([{ name: "rong.png", reason: "empty" }]);
  });
});

describe("C2 — attachmentSubmitState: chỉ gửi được khi MỌI ô đã xong", () => {
  it("có ô đang tải / xếp hàng ⇒ chưa gửi được, lý do `uploading`", () => {
    expect(attachmentSubmitState([item({ status: "uploading" })]).ready).toBe(false);
    expect(attachmentSubmitState([item({ status: "queued" })])).toEqual({
      ready: false,
      reason: "uploading",
    });
  });

  it("có ô lỗi (không ô nào đang tải) ⇒ `hasErrors`", () => {
    expect(
      attachmentSubmitState([item({ status: "done", fileId: "f1" }), item({ status: "error" })]),
    ).toEqual({ ready: false, reason: "hasErrors" });
  });

  it("mọi ô xong ⇒ `ids` theo THỨ TỰ CHỌN (khoá idempotency phụ thuộc thứ tự — đo M12)", () => {
    const state = attachmentSubmitState([
      item({ status: "done", fileId: "f2" }),
      item({ status: "done", fileId: "f1" }),
    ]);
    expect(state).toEqual({ ready: true, ids: ["f2", "f1"] });
  });

  it("khay rỗng ⇒ gửi được, `ids` rỗng", () => {
    expect(attachmentSubmitState([])).toEqual({ ready: true, ids: [] });
  });
});

describe("A3 — lý do lỗi TẢI theo `ApiError.code` (không theo câu chữ)", () => {
  const C = FOUNDATION_FILE_ERROR_CODES;
  const S = SOCIAL_ERROR_CODES;

  it.each([
    [C.MIME, 415, "unsupportedType"],
    [C.EXTENSION, 415, "unsupportedType"],
    [C.BLOCKED, 415, "unsupportedType"],
    [C.SIZE, 413, "tooLargeServer"],
    [S.FILE_TARGET_POST_DENIED, 403, "attachDenied"],
    [S.FILE_TARGET_COMMENT_DENIED, 403, "attachDenied"],
    [C.CONFIRM_MISMATCH, 422, "uploadFailed"],
  ] as const)("%s ⇒ %s", (code, status, reason) => {
    expect(attachmentUploadErrorReason(new ApiError(status, code, "x"))).toBe(reason);
  });

  it("lỗi không phải `ApiError` (PUT hỏng, mạng) ⇒ `uploadFailed`", () => {
    expect(attachmentUploadErrorReason(new Error("Tải tệp lên storage thất bại (HTTP 403)."))).toBe(
      "uploadFailed",
    );
  });

  it("403 tầng-1 (PermissionGuard, mã KHÔNG phải SOCIAL) ⇒ `uploadFailed`, không đoán theo status", () => {
    expect(attachmentUploadErrorReason(new ApiError(403, "AUTH-ERR-FORBIDDEN", "x"))).toBe(
      "uploadFailed",
    );
  });
});

describe("A9 — lý do lỗi ĐĂNG bài/bình luận có tệp", () => {
  it("`SOCIAL-ERR-007` (trần HOẶC tệp không hợp lệ — cùng một mã, D6) ⇒ `attachmentRejected`", () => {
    expect(attachmentErrorReason(new ApiError(422, SOCIAL_ERROR_CODES.ATTACHMENT_LIMIT, "x"))).toBe(
      "attachmentRejected",
    );
  });

  it("`SOCIAL-ERR-FILE-TARGET-*-DENIED` ⇒ `attachDenied`; mã khác ⇒ `null` (caller rơi về câu chung)", () => {
    expect(
      attachmentErrorReason(new ApiError(403, SOCIAL_ERROR_CODES.FILE_TARGET_POST_DENIED, "x")),
    ).toBe("attachDenied");
    expect(attachmentErrorReason(new ApiError(404, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND, "x"))).toBe(
      null,
    );
    expect(attachmentErrorReason(new Error("x"))).toBe(null);
  });
});
