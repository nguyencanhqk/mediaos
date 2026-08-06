import type { ApiResponse } from "./types";

/**
 * Goi API tu phia trinh duyet.
 * Luon doc JSON ke ca khi HTTP loi, vi server tra thong bao tieng Viet
 * trong truong `error` - do moi la thu can hien cho nguoi dung.
 */

export class ApiError extends Error {}

async function unwrap<T>(response: Response): Promise<T> {
  let body: ApiResponse<T> | null = null;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Máy chủ trả về phản hồi không đọc được (HTTP ${response.status})`);
  }

  if (!body.success || body.data === null) {
    throw new ApiError(body.error ?? `Yêu cầu thất bại (HTTP ${response.status})`);
  }
  return body.data;
}

export async function apiGet<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return unwrap<T>(response);
}

export async function apiUpload<T>(url: string, form: FormData): Promise<T> {
  return unwrap<T>(await fetch(url, { method: "POST", body: form }));
}
