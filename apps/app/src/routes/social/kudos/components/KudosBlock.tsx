/**
 * S16-SOCIAL-FE-2C — khối vinh danh (plan D8): trên thẻ bài `type='kudos'` (`post.kudos`) và trên từng
 * dòng màn 009 (`047` = cùng khối + `postId` + `createdAt`).
 *
 * Trình bày THUẦN — không `useQuery`: `047` không lọc theo `postId`, dữ liệu duy nhất là khối BE-2D chở
 * trên DTO bài. Khối VẮNG (006 · WS · API cũ · hàng mồ côi) ⇒ caller không render khối này (thẻ suy biến
 * an toàn — ca C27).
 *
 * ┌─ 🔴 AVATAR: CHỈ CHỮ CÁI ĐẦU, KHÔNG BAO GIỜ `src` ────────────────────────────────────────────────┐
 * │ `recipients[].avatarUrl` là cột THÔ `employee_profiles.avatar_url` — thường là fileId, có thể là  │
 * │ chuỗi tuỳ ý (cột đa-người-ghi). Làm `src` ⇒ ảnh vỡ hoặc tải ảnh từ host lạ. `Avatar` chỉ vẽ `<img>`│
 * │ khi có `src`, nên KHÔNG truyền `src` là đủ. Bật lại khi `S16-SOCIAL-AVATARPRESIGN-1` ký URL.       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Người nhận: `fullName ?? "Đồng nghiệp"` (null ⇔ hồ sơ/TK đã xoá mềm HOẶC không có TK — cờ theo
 * `status`); nhãn «Đã nghỉ việc» CHỈ theo `isFormerEmployee`; tên là link hồ sơ khi có `fullName`.
 * `message` là CHỮ THUẦN (không qua `PostBody`): hashtag chỉ lập chỉ mục từ `body`, link `#tag` trong
 * lời nhắn sẽ trỏ vào bộ lọc KHÔNG chứa bài này.
 */
import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { FeedKudosBlockDto, FeedKudosRecipientDto } from "@mediaos/contracts";
import { KudosBadgeIcon } from "./KudosBadgeIcon";

interface KudosBlockProps {
  block: FeedKudosBlockDto;
  className?: string;
}

export function KudosBlock({ block, className }: KudosBlockProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <section
      data-testid="kudos-block"
      className={cn("rounded-md border border-border bg-accent/30 p-3", className)}
    >
      <header className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        <KudosBadgeIcon icon={block.badge?.icon ?? null} className="text-primary" />
        <span data-testid="kudos-badge-name">{block.badge?.name ?? t("kudos.label")}</span>
        {block.isOfficial && (
          <span
            data-testid="kudos-official"
            title={t("kudos.officialTitle")}
            className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"
          >
            {t("kudos.official")}
          </span>
        )}
      </header>

      {block.recipients.length > 0 && (
        <ul aria-label={t("kudos.recipientsAria")} className="mt-2 flex flex-wrap gap-2">
          {block.recipients.map((r) => (
            <li key={r.employeeId}>
              <KudosRecipient recipient={r} />
            </li>
          ))}
        </ul>
      )}

      {block.message && (
        <p
          data-testid="kudos-message"
          className="mt-2 whitespace-pre-line break-words text-sm text-foreground"
        >
          {block.message}
        </p>
      )}
    </section>
  );
}

function KudosRecipient({ recipient }: { recipient: FeedKudosRecipientDto }): React.ReactElement {
  const { t } = useTranslation("social");
  const name = recipient.fullName ?? t("kudos.unknownRecipient");
  const nameClass = "text-sm text-foreground";

  return (
    <span
      data-testid="kudos-recipient"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2"
    >
      {/* Không `src` — xem hộp 🔴 đầu file. */}
      <Avatar name={name} size="sm" />
      {recipient.fullName !== null ? (
        <Link
          to="/feed/profiles/$employeeId"
          params={{ employeeId: recipient.employeeId }}
          className={cn(
            nameClass,
            "rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {name}
        </Link>
      ) : (
        <span className={nameClass}>{name}</span>
      )}
      {recipient.isFormerEmployee && (
        <span
          data-testid="kudos-former"
          className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
        >
          {t("kudos.formerEmployee")}
        </span>
      )}
    </span>
  );
}
