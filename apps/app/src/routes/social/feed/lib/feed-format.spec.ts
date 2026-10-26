/**
 * S16-SOCIAL-AVATARPRESIGN-1 — `avatarSrc` gọi TRỰC TIẾP (FULL gate lượt 1).
 *
 * Spec bề mặt chỉ thấy vài giá trị (URL ký · fileId · null); luật thật của hàm — neo `^`, scheme chữ
 * thường, chữ ký SigV4 trong query — chỉ được khoá ở đây. Lý do tồn tại của luật: FE tự deploy khi merge
 * còn API PROD deploy tay; trong khe đó API CŨ trả nguyên cột `employee_profiles.avatar_url`, kể cả URL
 * http(s) ngoài (beacon ghi IP/UA người xem — owner D2-b chặn ở server). Chỉ hình dạng presign được vẽ.
 *
 * Chữ ký trong fixture là chuỗi LẶP `ab…` (64 ký tự hex, entropy thấp) — không phải bí mật, không đỏ oan
 * gitleaks (CLAUDE.md §5 «fixture giống-secret»).
 */
import { describe, expect, it } from "vitest";
import { FEED_MAX_IMAGES_PER_POST, type FeedAttachmentDto } from "@mediaos/contracts";
import { IMAGE_GRID_MAX, avatarSrc, buildImageGrid } from "./feed-format";

const SIG = "ab".repeat(32);
const SIGNED_HTTPS = `https://storage.invalid/co/files/f.png?X-Amz-Expires=300&X-Amz-Signature=${SIG}&X-Amz-SignedHeaders=host&x-id=GetObject`;
const SIGNED_HTTP_LAST = `http://localhost:9000/assets/co/files/f.png?X-Amz-Expires=300&X-Amz-Signature=${SIG}`;

describe("avatarSrc — CHỈ URL presign SigV4 thành `src`", () => {
  it.each([
    ["https, chữ ký giữa query", SIGNED_HTTPS],
    ["http (MinIO dev/lane), chữ ký cuối query", SIGNED_HTTP_LAST],
  ])("nhận: %s ⇒ trả NGUYÊN giá trị", (_label, value) => {
    expect(avatarSrc(value)).toBe(value);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["chuỗi rỗng", ""],
    ["fileId thô (API cũ) — URL tương đối", "44444444-4444-4444-8444-444444444444"],
    ["URL https NGOÀI không chữ ký (cột thô API cũ — beacon)", "https://tracker.example/p.gif"],
    ["URL http ngoài không chữ ký", "http://tracker.example/p.gif?w=1"],
    [
      "scheme HOA `HTTPS://` (dịch vụ ký không bao giờ phát)",
      SIGNED_HTTPS.replace("https", "HTTPS"),
    ],
    ["khoảng trắng đầu chuỗi", ` ${SIGNED_HTTPS}`],
    ["khoảng trắng trong chuỗi", SIGNED_HTTPS.replace("co/files", "co /files")],
    ["URL nằm GIỮA chuỗi (mất neo `^`)", `x ${SIGNED_HTTPS}`],
    ["protocol-relative `//host`", SIGNED_HTTPS.replace("https:", "")],
    ["`https:` thiếu `//`", SIGNED_HTTPS.replace("https://", "https:")],
    ["`javascript:`", `javascript:alert(1)//?X-Amz-Signature=${SIG}`],
    ["`data:`", `data:image/png;base64,AAAA?X-Amz-Signature=${SIG}`],
    ["chữ ký sai độ dài", SIGNED_HTTPS.replace(SIG, SIG.slice(2))],
    ["chữ ký chữ HOA (SigV4 luôn hex thường)", SIGNED_HTTPS.replace(SIG, SIG.toUpperCase())],
    [
      "chữ ký chỉ nằm sau `#` (không phải query)",
      `https://tracker.example/p.gif#?X-Amz-Signature=${SIG}`,
    ],
  ])("từ chối: %s ⇒ undefined (chữ cái đầu)", (_label, value) => {
    expect(avatarSrc(value)).toBeUndefined();
  });
});

/**
 * S16-SOCIAL-FE-2D — `buildImageGrid(attachments, max)`: LỌC ảnh vẽ được (`url` http(s)) → rồi mới CẮT theo
 * `max`; «+N» (`overflow`) đếm trên tập ĐÃ LỌC. Mặc định `max = IMAGE_GRID_MAX` (thẻ bảng tin); trang chi tiết
 * truyền trần ảnh mỗi bài của contracts.
 */
describe("buildImageGrid — lọc rồi mới cắt theo `max`", () => {
  const img = (
    n: number,
    url: string | null = `https://cdn.invalid/i${n}.png`,
  ): FeedAttachmentDto => ({
    fileId: `i${n}`,
    kind: "image",
    fileName: `i${n}.png`,
    sizeBytes: 1,
    url,
  });
  const idsOf = (list: readonly FeedAttachmentDto[]) => list.map((a) => a.fileId);
  const six = [1, 2, 3, 4, 5, 6].map((n) => img(n));

  it("mặc định: 6 ảnh ⇒ vẽ 4 ảnh ĐẦU (đúng thứ tự), «+2», 2 cột", () => {
    const grid = buildImageGrid(six);

    expect(IMAGE_GRID_MAX).toBe(4);
    expect(idsOf(grid.shown)).toEqual(["i1", "i2", "i3", "i4"]);
    expect(grid.overflow).toBe(2);
    expect(grid.columns).toBe(2);
  });

  it("`max` = trần ảnh mỗi bài: 6 ảnh ⇒ vẽ ĐỦ 6, không «+N»", () => {
    const grid = buildImageGrid(six, FEED_MAX_IMAGES_PER_POST);

    expect(idsOf(grid.shown)).toEqual(["i1", "i2", "i3", "i4", "i5", "i6"]);
    expect(grid.overflow).toBe(0);
  });

  it("`max` vẫn là TRẦN: nhiều ảnh hơn `max` ⇒ cắt ở `max`, phần dư vào «+N»", () => {
    const many = Array.from({ length: FEED_MAX_IMAGES_PER_POST + 2 }, (_, i) => img(i + 1));
    const grid = buildImageGrid(many, FEED_MAX_IMAGES_PER_POST);

    expect(grid.shown).toHaveLength(FEED_MAX_IMAGES_PER_POST);
    expect(grid.overflow).toBe(2);
  });

  it("DENY: ảnh `url:null` / lược đồ lạ bị lọc TRƯỚC khi cắt — không chiếm ô, không tính vào «+N»", () => {
    const mixed = [
      img(1, null),
      img(2),
      img(3, "javascript:alert(1)"),
      img(4),
      img(5),
      img(6),
      img(7),
    ];

    const feed = buildImageGrid(mixed);
    expect(idsOf(feed.shown)).toEqual(["i2", "i4", "i5", "i6"]);
    expect(feed.overflow).toBe(1);

    const detail = buildImageGrid(mixed, FEED_MAX_IMAGES_PER_POST);
    expect(idsOf(detail.shown)).toEqual(["i2", "i4", "i5", "i6", "i7"]);
    expect(detail.overflow).toBe(0);
  });
});
