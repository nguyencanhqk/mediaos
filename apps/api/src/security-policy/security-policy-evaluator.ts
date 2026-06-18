import { Injectable } from "@nestjs/common";
import type { SecurityTimeWindow } from "../db/schema/security-policy";

/**
 * CS-9 — LOGIC THUẦN quyết định enforce (KHÔNG I/O, KHÔNG DB). Tách riêng để test cô lập ≥95% TRƯỚC khi
 * cắm vào auth (giảm rủi ro hồi quy login). Mọi hàm pure + deterministic (nhận `now` qua tham số để test).
 *
 * QUY TẮC (BẤT BIẾN enforcement):
 *   - exempt: user trong exemptUserIds BỎ QUA IP/giờ (chống tự-khoá admin).
 *   - IP rỗng (enabled + allowlist []): fail-OPEN (coi như TẮT — chưa cấu hình).
 *   - giờ rỗng (enabled + windows []): fail-CLOSED (không cửa sổ hợp lệ = chặn).
 *   - email-domain rỗng/tắt: cho qua.
 */

/** Cấu hình tối thiểu evaluator cần (subset của CompanySecurityPolicy đã chuẩn hoá). */
export interface PolicyEvaluationConfig {
  ipRestrictionEnabled: boolean;
  allowlistCidrs: string[];
  timeRestrictionEnabled: boolean;
  timeWindows: SecurityTimeWindow[];
  exemptUserIds: string[];
}

/** Ngữ cảnh 1 lần cấp token (login/refresh). `now` truyền vào để deterministic (test). */
export interface AccessContext {
  userId: string;
  ip?: string;
  now: Date;
}

/** Kết quả đánh giá — allowed=false kèm lý do máy-đọc (audit/log, KHÔNG lộ ra client ngoài 403 chung). */
export interface PolicyDecision {
  allowed: boolean;
  reason?: "ip_not_allowed" | "outside_time_window";
}

const MINUTES_PER_DAY = 24 * 60;

@Injectable()
export class SecurityPolicyEvaluator {
  /**
   * Quyết định 1 lần cấp token có được phép theo IP + giờ không. exempt user → luôn allow. Cờ tắt /
   * cấu hình rỗng-OPEN → bỏ qua chiều đó. IP rác/thiếu khi IP-restriction bật → CHẶN (fail-closed cho IP
   * KHÔNG parse được — không để bỏ qua bằng cách che giấu IP).
   */
  evaluate(config: PolicyEvaluationConfig, ctx: AccessContext): PolicyDecision {
    // Exempt: bỏ qua MỌI giới hạn IP/giờ (chống tự-khoá; người-đang-cấu-hình được service tự thêm vào list).
    if (config.exemptUserIds.includes(ctx.userId)) return { allowed: true };

    if (this.isIpRestrictionActive(config)) {
      if (!this.isIpAllowed(ctx.ip, config.allowlistCidrs)) {
        return { allowed: false, reason: "ip_not_allowed" };
      }
    }

    if (config.timeRestrictionEnabled) {
      // fail-CLOSED: bật restriction + KHÔNG cửa sổ nào khớp (kể cả windows rỗng) → chặn.
      if (!this.isWithinAnyWindow(config.timeWindows, ctx.now)) {
        return { allowed: false, reason: "outside_time_window" };
      }
    }

    return { allowed: true };
  }

  /** IP-restriction CHỈ active khi bật VÀ có ít nhất 1 CIDR (rỗng = fail-OPEN, coi như chưa cấu hình). */
  isIpRestrictionActive(config: PolicyEvaluationConfig): boolean {
    return config.ipRestrictionEnabled && config.allowlistCidrs.length > 0;
  }

  /**
   * IP có nằm trong BẤT KỲ CIDR allowlist không. IP thiếu/không parse được → false (fail-closed: KHÔNG cho
   * bỏ qua giới hạn bằng cách giấu/giả IP). Hỗ trợ IPv4 và IPv6 (so khớp bit-prefix). CIDR rác bị bỏ qua
   * (đã validate ở contract; ở đây an toàn kép — CIDR không parse được KHÔNG match gì).
   */
  isIpAllowed(ip: string | undefined, cidrs: string[]): boolean {
    if (!ip) return false;
    const ipBytes = this.parseIp(this.normalizeIp(ip));
    if (!ipBytes) return false;
    return cidrs.some((cidr) => this.ipInCidr(ipBytes, cidr));
  }

  /** Thời điểm `now` có rơi vào BẤT KỲ cửa sổ nào không (đa-ngày, hỗ trợ wrap qua nửa đêm). */
  isWithinAnyWindow(windows: SecurityTimeWindow[], now: Date): boolean {
    const day = now.getDay(); // 0=CN…6=T7 (local time của server — note ops: server TZ).
    const minutes = now.getHours() * 60 + now.getMinutes();
    return windows.some((w) => this.isWithinWindow(w, day, minutes));
  }

  /**
   * 1 cửa sổ. start<end: [start,end) cùng ngày `w.day`. start>end: cửa sổ qua nửa đêm — phần [start,24:00)
   * thuộc `w.day`, phần [00:00,end) thuộc ngày KẾ (w.day+1)%7. start===end đã bị contract loại (cửa sổ rỗng).
   */
  private isWithinWindow(w: SecurityTimeWindow, day: number, minutes: number): boolean {
    const start = this.hhmmToMinutes(w.start);
    const end = this.hhmmToMinutes(w.end);
    if (start === null || end === null || start === end) return false;

    if (start < end) {
      return day === w.day && minutes >= start && minutes < end;
    }
    // Wrap qua nửa đêm.
    if (day === w.day && minutes >= start && minutes < MINUTES_PER_DAY) return true;
    if (day === (w.day + 1) % 7 && minutes >= 0 && minutes < end) return true;
    return false;
  }

  private hhmmToMinutes(hhmm: string): number | null {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  /** Bỏ tiền tố IPv4-mapped-IPv6 (`::ffff:`) + bỏ zone-id (`%eth0`) để so khớp đúng. */
  private normalizeIp(ip: string): string {
    let out = ip.trim();
    const pct = out.indexOf("%");
    if (pct >= 0) out = out.slice(0, pct);
    const mapped = out.toLowerCase().startsWith("::ffff:") ? out.slice(7) : out;
    return mapped;
  }

  /** Parse IPv4 hoặc IPv6 → mảng byte (4 cho v4, 16 cho v6). Trả null nếu rác. */
  private parseIp(ip: string): number[] | null {
    if (ip.includes(":")) return this.parseIpv6(ip);
    if (ip.includes(".")) return this.parseIpv4(ip);
    return null;
  }

  private parseIpv4(ip: string): number[] | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const bytes: number[] = [];
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const n = Number(p);
      if (n > 255) return null;
      bytes.push(n);
    }
    return bytes;
  }

  private parseIpv6(ip: string): number[] | null {
    // Tách "::" (chỉ 1 lần). Mỗi nửa gồm các nhóm hex 16-bit.
    const halves = ip.split("::");
    if (halves.length > 2) return null;

    const toGroups = (s: string): number[] | null => {
      if (s === "") return [];
      const groups: number[] = [];
      for (const g of s.split(":")) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        groups.push(parseInt(g, 16));
      }
      return groups;
    };

    const head = toGroups(halves[0]);
    const tail = halves.length === 2 ? toGroups(halves[1]) : [];
    if (head === null || tail === null) return null;

    let groups: number[];
    if (halves.length === 2) {
      const missing = 8 - head.length - tail.length;
      if (missing < 0) return null;
      groups = [...head, ...Array(missing).fill(0), ...tail];
    } else {
      groups = head;
    }
    if (groups.length !== 8) return null;

    const bytes: number[] = [];
    for (const g of groups) {
      bytes.push((g >> 8) & 0xff, g & 0xff);
    }
    return bytes;
  }

  /** IP (đã parse thành byte) có nằm trong CIDR không. Family (v4/v6) phải khớp. */
  private ipInCidr(ipBytes: number[], cidr: string): boolean {
    const slash = cidr.indexOf("/");
    if (slash < 0) return false;
    const netStr = cidr.slice(0, slash).trim();
    const prefix = Number(cidr.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0) return false;

    const netBytes = this.parseIp(this.normalizeIp(netStr));
    if (!netBytes) return false;
    if (netBytes.length !== ipBytes.length) return false; // khác family → không match.
    if (prefix > netBytes.length * 8) return false;

    let bitsLeft = prefix;
    for (let i = 0; i < netBytes.length && bitsLeft > 0; i++) {
      const take = Math.min(8, bitsLeft);
      const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
      if ((ipBytes[i] & mask) !== (netBytes[i] & mask)) return false;
      bitsLeft -= take;
    }
    return true;
  }

  /**
   * email-domain check ở tạo tài khoản. enabled + allowlist không rỗng ⇒ email PHẢI thuộc 1 domain
   * (khớp chính domain HOẶC subdomain: user@a.company.com khớp "company.com"). Tắt/rỗng ⇒ allow.
   * Email rác (không có '@'/domain) khi restriction bật ⇒ CHẶN (fail-closed).
   */
  isEmailDomainAllowed(
    email: string,
    config: { emailDomainRestrictionEnabled: boolean; allowedEmailDomains: string[] },
  ): boolean {
    if (!config.emailDomainRestrictionEnabled) return true;
    if (config.allowedEmailDomains.length === 0) return true; // rỗng = chưa cấu hình → cho qua (fail-OPEN).
    const at = email.lastIndexOf("@");
    if (at < 0) return false;
    const domain = email.slice(at + 1).toLowerCase().trim();
    if (!domain) return false;
    return config.allowedEmailDomains.some((allowed) => {
      const a = allowed.toLowerCase().trim();
      return domain === a || domain.endsWith(`.${a}`);
    });
  }
}
