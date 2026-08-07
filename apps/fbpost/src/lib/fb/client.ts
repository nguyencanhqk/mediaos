import { getSettings } from "../repo/settings-repo";

/**
 * Lop giao tiep cap thap voi Graph API.
 * Moi loi tra ve tu Facebook duoc dich sang thong bao tieng Viet de nguoi
 * dung cuoi hieu ngay phai lam gi, thay vi doc nguyen van tieng Anh.
 */

const GRAPH_HOST = "https://graph.facebook.com";
const GRAPH_VIDEO_HOST = "https://graph-video.facebook.com";

export interface GraphErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export class FacebookApiError extends Error {
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly traceId: string | undefined;

  constructor(payload: GraphErrorPayload, httpStatus: number) {
    super(buildFriendlyMessage(payload, httpStatus));
    this.name = "FacebookApiError";
    this.code = payload.code;
    this.subcode = payload.error_subcode;
    this.traceId = payload.fbtrace_id;
  }
}

/** Anh xa cac ma loi hay gap sang huong dan khac phuc cu the. */
function buildFriendlyMessage(payload: GraphErrorPayload, httpStatus: number): string {
  const raw = payload.error_user_msg || payload.message || `HTTP ${httpStatus}`;

  // Sai App ID hoac App Secret deu tra ve nhom loi nay khi doi token.
  if (payload.code === 101 || /appsecret|client id|client secret/i.test(raw)) {
    return `App ID hoặc App Secret không đúng. Kiểm tra lại trong App settings → Basic của ứng dụng Facebook. (${raw})`;
  }

  switch (payload.code) {
    case 190:
      return `Token đã hết hạn hoặc không hợp lệ. Vào trang Cài đặt để lấy token mới. (${raw})`;
    case 200:
    case 10:
      return `Token thiếu quyền cần thiết (pages_show_list, pages_read_engagement, pages_manage_posts). Đăng nhập lại ở trang Cài đặt và cấp đủ quyền. (${raw})`;
    case 100:
      return `Tham số gửi lên không hợp lệ. Kiểm tra lại nội dung, media hoặc thời gian hẹn. (${raw})`;
    case 4:
    case 17:
    case 32:
    case 613:
      return `Đã chạm giới hạn số lần gọi API của Facebook. Chờ khoảng 1 giờ rồi thử lại. (${raw})`;
    case 368:
      return `Hành động bị Facebook tạm khoá do vi phạm chính sách nội dung. (${raw})`;
    case 1363030:
    case 1363037:
      return `Video/Reels không đạt yêu cầu định dạng của Facebook. (${raw})`;
    default:
      return raw;
  }
}

export function getGraphVersion(): string {
  return getSettings().graphVersion;
}

export function graphUrl(path: string, version = getGraphVersion()): string {
  return `${GRAPH_HOST}/${version}/${path.replace(/^\//, "")}`;
}

export function graphVideoUrl(path: string, version = getGraphVersion()): string {
  return `${GRAPH_VIDEO_HOST}/${version}/${path.replace(/^\//, "")}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new FacebookApiError({ message: text.slice(0, 500) }, response.status);
    }
    throw new Error(`Facebook trả về dữ liệu không phải JSON: ${text.slice(0, 200)}`);
  }

  const body = parsed as { error?: GraphErrorPayload } | null;
  if (!response.ok || body?.error) {
    throw new FacebookApiError(body?.error ?? { message: text.slice(0, 500) }, response.status);
  }
  return parsed as T;
}

export async function graphGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(graphUrl(path));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  return parseResponse<T>(response);
}

/** POST dang application/x-www-form-urlencoded - dung cho moi request khong kem file. */
export async function graphPost<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options?: { videoHost?: boolean },
): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    body.set(key, String(value));
  }
  const url = options?.videoHost ? graphVideoUrl(path) : graphUrl(path);
  const response = await fetch(url, { method: "POST", body, cache: "no-store" });
  return parseResponse<T>(response);
}

/** POST dang multipart/form-data - dung khi can dinh kem file nhi phan. */
export async function graphPostForm<T>(
  path: string,
  form: FormData,
  options?: { videoHost?: boolean },
): Promise<T> {
  const url = options?.videoHost ? graphVideoUrl(path) : graphUrl(path);
  const response = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  return parseResponse<T>(response);
}

/** Lay permalink cua bai vua tao. Loi o day khong lam hong luong dang bai. */
export async function tryGetPermalink(
  objectId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const result = await graphGet<{ permalink_url?: string }>(objectId, {
      fields: "permalink_url",
      access_token: accessToken,
    });
    return result.permalink_url ?? null;
  } catch {
    return null;
  }
}
