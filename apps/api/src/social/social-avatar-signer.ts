import { Injectable, Logger } from "@nestjs/common";
import type { FeedKudosRecipientDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import {
  AvatarPresignService,
  isUuid,
  type AvatarSubject,
} from "../foundation/files/avatar-presign.service";
import { socialPgErrorOf } from "./social.errors";

/**
 * S16-SOCIAL-AVATARPRESIGN-1 — điểm ký avatar DUY NHẤT của SOCIAL (plan §4.1; owner ký D1–D10 02/10/2026).
 *
 * ┌─ VÌ SAO CÓ LỚP NÀY (KHÔNG GỌI THẲNG `AvatarPresignService`) ──────────────────────────────────────┐
 * │ Cột `employee_profiles.avatar_url` lưu fileId và ĐA-NGƯỜI-GHI (HR · đề xuất đổi hồ sơ của chính  │
 * │ nhân viên). Ký mù = IDOR đọc tệp nội-tenant. `resolveEmployeeAvatars` đã tự vệ (chỉ ký CẶP      │
 * │ `(employeeId, fileId)` có link `ME/avatar` sống); lớp này thêm ba luật RIÊNG của SOCIAL:          │
 * │  1. **Khoá kết quả theo CẶP của chính ref** (`urlOf(ref)`), không theo `employeeId`: một trang có  │
 * │     thể chiếu CÙNG người ở hai điểm với hai vị từ che khác nhau (tác giả bài — không che theo TK; │
 * │     người nhận kudos — K1 che theo TK). Tra theo `employeeId` sẽ để ref không che MỞ KHOÁ ref đã   │
 * │     che (plan F1, M15). Ref có `avatarRaw` null (đã che / chưa có) ⇒ LUÔN `null`.                 │
 * │  2. **D2-b — chỉ fileId được ký.** URL http(s) passthrough của dịch vụ dùng chung bị bỏ ở đây      │
 * │     (beacon ghi IP/UA của MỌI người đọc bảng tin) ⇒ initials. Lưới cuối: giá trị trả về không     │
 * │     khớp `^https?://` ⇒ bỏ + `logger.error` (bản đổi của dịch vụ không lặng lẽ đẩy scheme lạ ra FE).│
 * │  3. **`tx` BẮT BUỘC** — không overload tự mở `withTenant` (lồng = treo PgBouncer, plan M7).        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ D10 — LỖI CÂU CỔNG: `signTx` NÉM · `signInSavepointTx` NUỐT TRONG SAVEPOINT ──────────────────────┐
 * │ `signTx` KHÔNG bắt lỗi: trong tx không SAVEPOINT, một câu lỗi làm hỏng cả tx — `catch` ở đó khiến │
 * │ COMMIT thành ROLLBACK IM LẶNG, route trả 200 mà mất ghi (plan M21). `signInSavepointTx` CHỈ cho tx │
 * │ có GHI (`029`): bọc `tx.transaction` (SAVEPOINT — cùng kết nối, 0 `begin` thêm, plan M19); lỗi ⇒ │
 * │ `rollback to savepoint`, ảnh về initials + `logger.warn`, quyết định kiểm duyệt vẫn commit.        │
 * │ 🔴 Cấm `try/catch` quanh `signTx` — đó là đúng bản vá ngây thơ M21 (mutant của T-029-SP).          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CHE ẢNH ⊆ CHE TÊN — LUẬT CHO MỌI ĐIỂM SELECT (plan §1.1, 12 điểm; R12) ───────────────────────────┐
 * │ Ký biến một fileId trơ thành ảnh THẬT ⇒ ở mọi điểm, vị từ che ảnh phải chặt BẰNG hoặc HƠN vị từ   │
 * │ che tên. Che xảy ra TRONG SQL (`CASE WHEN live …` của K1 · `CASE WHEN nameLive …` của D9 ở `026`  │
 * │ và `022`-chưa-đọc) hoặc TRƯỚC khi dựng refs (D13-a: reporter ẩn không vào lô) — người đã bị che   │
 * │ không phát sinh URL và fileId của họ không vào tham số câu cổng. Thêm một điểm SELECT avatar mới:  │
 * │ đặt cột thô dưới khoá `…AvatarRaw` (spec cấu trúc S1 đếm), và che ảnh theo đúng vị từ che tên.    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Lệch đọc giữa hai tx của cùng request (vd tác giả đọc ở tx `listFeed`, người nhận kudos ở tx
 * `decorate`, người đó đổi ảnh giữa chừng) ⇒ hai ref cùng người khác raw: chỉ raw xuất hiện ĐẦU TIÊN
 * được ký (dịch vụ khoá theo `employeeId`), ref còn lại ⇒ `null` — fail-soft, tất định, đúng một request.
 */

/** Một điểm chiếu: chủ hàng + giá trị THÔ `employee_profiles.avatar_url` (null = đã che / chưa có). */
export interface SocialAvatarRef {
  readonly employeeId: string | null;
  readonly avatarRaw: string | null;
}

/** URL ĐÃ KÝ cho ĐÚNG cặp `(employeeId, avatarRaw)` của ref — cửa DUY NHẤT để avatar lên DTO. */
export interface SignedAvatars {
  urlOf(ref: SocialAvatarRef): string | null;
}

/** Không avatar nào được ký — mọi ref ⇒ `null` (chữ cái đầu). */
export const NO_AVATARS: SignedAvatars = Object.freeze({ urlOf: () => null });

/** Lưới cuối trên ĐẦU RA của dịch vụ — giữ `http` vì endpoint MinIO của dev/lane là `http://`. */
const SIGNED_URL_RE = /^https?:\/\//;

const pairKey = (employeeId: string, raw: string): string => `${employeeId}:${raw}`;

/** MỘT subject mỗi `employeeId` = raw fileId xuất hiện ĐẦU TIÊN; bỏ ref null và mọi raw không UUID (D2-b). */
function chooseSubjects(refs: Iterable<SocialAvatarRef>): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const ref of refs) {
    if (!ref.employeeId || !ref.avatarRaw || !isUuid(ref.avatarRaw)) continue;
    if (!chosen.has(ref.employeeId)) chosen.set(ref.employeeId, ref.avatarRaw);
  }
  return chosen;
}

@Injectable()
export class SocialAvatarSigner {
  private readonly logger = new Logger(SocialAvatarSigner.name);

  constructor(private readonly presign: AvatarPresignService) {}

  /** Ký trong tx CỦA ROUTE (0 `begin` thêm, ≤1 câu cổng). KHÔNG bắt lỗi câu cổng — xem khối D10. */
  async signTx(
    tx: TenantTx,
    companyId: string,
    refs: Iterable<SocialAvatarRef>,
  ): Promise<SignedAvatars> {
    const chosen = chooseSubjects(refs);
    if (chosen.size === 0) return NO_AVATARS;
    return this.signChosen(tx, companyId, chosen);
  }

  /**
   * CHỈ cho tx có GHI (`029`): ký trong SAVEPOINT. Lỗi bất kỳ ⇒ `NO_AVATARS` + `logger.warn` (companyId
   * + mã PG); tx cha còn sống và commit quyết định kiểm duyệt. Không fileId nào ⇒ không mở SAVEPOINT.
   */
  async signInSavepointTx(
    tx: TenantTx,
    companyId: string,
    refs: Iterable<SocialAvatarRef>,
  ): Promise<SignedAvatars> {
    const chosen = chooseSubjects(refs);
    if (chosen.size === 0) return NO_AVATARS;
    try {
      return await tx.transaction((sp) => this.signChosen(sp, companyId, chosen));
    } catch (err) {
      const code = socialPgErrorOf(err)?.code;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `signInSavepointTx[company=${companyId}]: ký avatar lỗi (pg=${String(code ?? "none")}) — ` +
          `rollback SAVEPOINT, ${chosen.size} avatar về initials, tx ghi vẫn commit. Reason: ${reason}`,
      );
      return NO_AVATARS;
    }
  }

  private async signChosen(
    tx: TenantTx,
    companyId: string,
    chosen: ReadonlyMap<string, string>,
  ): Promise<SignedAvatars> {
    const subjects: AvatarSubject[] = [...chosen].map(([employeeId, avatarUrl]) => ({
      employeeId,
      avatarUrl,
    }));
    const urls = await this.presign.resolveEmployeeAvatars(companyId, subjects, tx);

    const signed = new Map<string, string>();
    for (const [employeeId, raw] of chosen) {
      const url = urls.get(employeeId);
      if (url === undefined) continue; // cặp không xác minh / storage lỗi (dịch vụ đã log) ⇒ initials
      if (!SIGNED_URL_RE.test(url)) {
        this.logger.error(
          `signTx[company=${companyId}]: dịch vụ ký trả URL không http(s) cho nhân viên ${employeeId} — bỏ (initials)`,
        );
        continue;
      }
      signed.set(pairKey(employeeId, raw), url);
    }
    if (signed.size === 0) return NO_AVATARS;
    return {
      urlOf: (ref) =>
        ref.employeeId && ref.avatarRaw
          ? (signed.get(pairKey(ref.employeeId, ref.avatarRaw)) ?? null)
          : null,
    };
  }
}

/**
 * Tác giả trên kênh WS (`feed:post.created` · `feed:comment.created`) — owner D3-b: GIỮ khoá, `avatarUrl`
 * LUÔN `null` (URL ký là capability TTL, không lên room). Chép TƯỜNG MINH từng khoá (không `...author`):
 * khoá mới của DTO REST không tự chảy ra room. Schema WS (`wsFeedAuthorSchema`) là tầng thứ hai.
 */
export function wsAuthorOf(author: { employeeId: string | null; fullName: string | null }): {
  employeeId: string | null;
  fullName: string | null;
  avatarUrl: null;
} {
  return { employeeId: author.employeeId, fullName: author.fullName, avatarUrl: null };
}

/**
 * MỘT luật người nhận vinh danh cho thẻ bài + `047` (BE-2D D4): chép theo DANH SÁCH KHOÁ (khoá gom
 * `kudosId` và mọi cột lạ ở tầng dưới không ra dây), avatar qua `urlOf` của CHÍNH cặp người nhận.
 */
export function kudosRecipientDto(
  r: {
    employeeId: string;
    fullName: string | null;
    avatarRaw: string | null;
    isFormerEmployee: boolean;
  },
  avatars: SignedAvatars,
): FeedKudosRecipientDto {
  return {
    employeeId: r.employeeId,
    fullName: r.fullName,
    avatarUrl: avatars.urlOf({ employeeId: r.employeeId, avatarRaw: r.avatarRaw }),
    isFormerEmployee: r.isFormerEmployee,
  };
}
