import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

/**
 * Doc phien trong mot route handler.
 *
 * Middleware da chan moi request khong co phien truoc khi den day, nen ham nay KHONG phai la cong
 * bao ve — no chi de biet NGUOI DANG DANG NHAP LA AI (email) cho nhung cho can phan biet, vi du
 * cong cau hinh kho video.
 *
 * Van kiem lai chu ky thay vi tin vao viec "middleware da cho qua": mot route handler co the bi
 * goi trong ngu canh khac (test, rewrite noi bo) va mot ham tra ve danh tinh KHONG duoc phep tra
 * ve danh tinh chua kiem chung. Chi phi la mot lan verify HMAC.
 */
export async function currentSession(request: NextRequest): Promise<SessionPayload | null> {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}
