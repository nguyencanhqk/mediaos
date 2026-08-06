import { NextResponse } from "next/server";
import type { ApiResponse } from "./types";
// Import gay hieu ung phu: khoi dong worker hen gio khi route dau tien duoc nap.
import "./worker-boot";

/** Envelope thong nhat cho moi API route. */

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function fail(error: string, status = 400): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ success: false, data: null, error }, { status });
}

/**
 * Chay handler va chuyen moi ngoai le thanh phan hoi JSON co cau truc,
 * thay vi trang loi HTML cua Next.js.
 */
export async function guard<T>(
  fn: () => Promise<NextResponse<ApiResponse<T>>>,
): Promise<NextResponse<ApiResponse<T>> | NextResponse<ApiResponse<never>>> {
  try {
    return await fn();
  } catch (error) {
    console.error("[api]", error);
    return fail(error instanceof Error ? error.message : "Lỗi không xác định", 500);
  }
}
