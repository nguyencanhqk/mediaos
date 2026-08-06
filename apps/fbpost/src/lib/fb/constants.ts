/** Cac hang so rang buoc do Facebook quy dinh. */

/** Facebook yeu cau thoi diem hen phai cach hien tai it nhat 10 phut. */
export const MIN_SCHEDULE_LEAD_SECONDS = 10 * 60;

/** Cong them 1 phut dem de request khong roi vao ranh gioi 10 phut. */
export const SCHEDULE_SAFETY_BUFFER_SECONDS = 60;

/** Gioi han hen gio toi da cho bai feed/anh/video. */
export const MAX_SCHEDULE_AHEAD_SECONDS = 30 * 24 * 60 * 60;

/** Reels co gioi han chat hon: 29 ngay. */
export const MAX_SCHEDULE_AHEAD_SECONDS_REEL = 29 * 24 * 60 * 60;

/** Kich thuoc moi chunk khi upload video (4 MB). */
export const VIDEO_CHUNK_SIZE = 4 * 1024 * 1024;

/** So lan thu lai toi da cho mot bai truoc khi danh dau that bai han. */
export const MAX_PUBLISH_ATTEMPTS = 3;

export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
];

export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];

/**
 * Quyen toi thieu can co tren Page Access Token.
 *
 * Theo tai lieu hien hanh cua Meta, ba quyen nay du cho ca bai chu, anh,
 * video lan Reels. Quyen `publish_video` cua ban cu khong con nam trong
 * yeu cau nua nen bo di - doi hoi no chi lam phan mem bao thieu quyen oan.
 */
export const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
