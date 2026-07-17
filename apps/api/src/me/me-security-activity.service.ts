import { Injectable } from "@nestjs/common";
import type {
  MeSecurityActivityItem,
  MeSecurityActivityQuery,
  MeSecurityActivitySource,
} from "@mediaos/contracts";
import { ME_SECURITY_ACTIVITY_MAX_DAYS } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import {
  MeSecurityActivityRepository,
  type MeSecurityActivityRow,
} from "./me-security-activity.repository";
import { maskIp, summarizeUserAgent } from "./me-security-activity.util";

/** Trang kết quả + tổng (controller dựng pagination block API-01 §16.1 — mirror AuthLogPage). */
export interface MeSecurityActivityPage {
  data: MeSecurityActivityItem[];
  total: number;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * S5-ME-BE-3 — service Hoạt động bảo mật own-scope (SPEC-09 ME-FUNC-016 §14.2/§17 · §10.6).
 *
 * Own-scope: owner = `user.id` TỪ TOKEN (controller không nhận owner param — §14.4). Đọc qua
 * `withTenant(user.companyId)` (RLS + FORCE). Mask Ở SERVER trước khi ra DTO: IP → maskIp (§10.6),
 * UA → summarizeUserAgent (nhãn allowlist, không raw). CLAMP cửa sổ thời gian về tối đa
 * ME_SECURITY_ACTIVITY_MAX_DAYS (90) ngày gần nhất — from_date xa hơn bị kéo về now−90d; count
 * dùng CÙNG cửa sổ với data (total/has_next nhất quán).
 *
 * FAIL-LOUD CỐ Ý (khác model fail-soft của MeAggregationService): đây là màn BẢO MẬT — lỗi hạ tầng
 * phải nổ 500 envelope chuẩn qua AllExceptionsFilter, KHÔNG nuốt thành list rỗng (degraded-giả làm
 * user tưởng "không có hoạt động lạ" trong khi query fail — nguy hiểm hơn lỗi tường minh).
 */
@Injectable()
export class MeSecurityActivityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MeSecurityActivityRepository,
  ) {}

  async listActivity(
    user: { id: string; companyId: string },
    query: MeSecurityActivityQuery,
  ): Promise<MeSecurityActivityPage> {
    const now = new Date();
    const oldestAllowed = new Date(now.getTime() - ME_SECURITY_ACTIVITY_MAX_DAYS * DAY_MS);
    // Clamp: from không xa hơn 90 ngày; to không vượt hiện tại. to_date < oldestAllowed ⇒ cửa sổ
    // rỗng → 0 kết quả (trung thực — không âm thầm nới cửa sổ).
    const from =
      query.from_date && query.from_date.getTime() > oldestAllowed.getTime()
        ? query.from_date
        : oldestAllowed;
    const to = query.to_date && query.to_date.getTime() < now.getTime() ? query.to_date : now;
    const offset = (query.page - 1) * query.per_page;

    return this.db.withTenant(user.companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findPageTx(tx, user.companyId, user.id, from, to, query.per_page, offset),
        this.repo.countTx(tx, user.companyId, user.id, from, to),
      ]);
      return { data: rows.map((row) => this.toItem(row)), total };
    });
  }

  /** Row → DTO tối giản: mask IP + rút gọn UA Ở ĐÂY (server-side) — raw không bao giờ rời service. */
  private toItem(row: MeSecurityActivityRow): MeSecurityActivityItem {
    return {
      id: row.id,
      source: row.source as MeSecurityActivitySource,
      eventType: row.eventType,
      severity: row.severity,
      device: summarizeUserAgent(row.userAgent),
      ipMasked: maskIp(row.ipAddress),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
