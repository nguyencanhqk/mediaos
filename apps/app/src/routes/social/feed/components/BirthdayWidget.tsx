/**
 * S16-SOCIAL-FE-1 (plan D12) — widget Sinh nhật ở rail phải (SOCIAL-API-026).
 *
 * ┌─ 🔴 HAI CÁI BẪY CỦA DTO NÀY — cả hai đều làm TRẮNG RAIL PHẢI, không phải lỗi nhỏ ────────────┐
 * │ 1. Khoá là **`avatar`**, KHÔNG phải `avatarUrl` như phần còn lại của module. Gõ nhầm ⇒ giá trị │
 * │    `undefined` im lặng (và nếu khai vào schema FE thì ZodError dù HTTP 200).                   │
 * │ 2. `fullName` và `avatar` đều **nullable**. Khai chúng là bắt buộc ở bất kỳ schema phái sinh   │
 * │    nào ⇒ `parse` ném ⇒ trắng cả rail cho đúng người có đồng nghiệp chưa cập nhật hồ sơ.        │
 * │ Ca **C21** ghim cả hai.                                                                        │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * DTO **chỉ** chở `{employeeId, fullName, avatar, day, month}` — KHÔNG năm sinh, KHÔNG tuổi. Gate chỉ
 * là `view:feed` chứ không cặp HR nào (SOC-DEC-007), nên widget này là **cửa sau tiềm năng vào PII
 * của HR**: đừng thêm bất cứ thứ gì suy ra được ngày sinh đầy đủ vào đây.
 *
 * ⚠️ **«Gửi lời chúc» chỉ MỞ composer với nội dung điền sẵn — KHÔNG tự đăng bài.** SOC-DEC-003 chốt
 * hệ thống không sinh bài tự động; một nút tự POST sẽ tạo đúng loại bài đó.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { FeedBirthdayDto, FeedBirthdayRangeDto } from "@mediaos/contracts";
import { PortalWidgetBlock } from "@/layouts/portal/PortalRightRail";

const RANGES: readonly FeedBirthdayRangeDto[] = ["today", "week", "month"];

interface BirthdayWidgetProps {
  range: FeedBirthdayRangeDto;
  onRangeChange: (range: FeedBirthdayRangeDto) => void;
  items: readonly FeedBirthdayDto[];
  isLoading: boolean;
  isError: boolean;
  /** Mở composer với lời chúc điền sẵn. Component này KHÔNG gọi API tạo bài. */
  onWish: (person: FeedBirthdayDto) => void;
  className?: string;
}

export function BirthdayWidget({
  range,
  onRangeChange,
  items,
  isLoading,
  isError,
  onWish,
  className,
}: BirthdayWidgetProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <PortalWidgetBlock
      title={t("birthday.title")}
      isLoading={isLoading}
      errorText={isError ? t("state.errorBody") : null}
      className={className}
      action={
        <div className="flex gap-1" role="group" aria-label={t("birthday.title")}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              aria-pressed={range === r}
              data-testid={`birthday-range-${r}`}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                range === r
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`birthday.range${r.charAt(0).toUpperCase()}${r.slice(1)}`)}
            </button>
          ))}
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="birthday-empty">
          {t("birthday.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="birthday-list">
          {items.map((person) => {
            // `fullName` nullable — nhãn dự phòng, KHÔNG rơi về `employeeId` (phơi id ra rail phải).
            const name = person.fullName?.trim() || t("birthday.unknownPerson");
            return (
              <li key={person.employeeId} className="flex items-center gap-2">
                {/* Khoá `avatar`, không phải `avatarUrl` — xem bẫy #1 ở đầu file. */}
                <Avatar name={name} src={person.avatar ?? undefined} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {/* Chỉ ngày/tháng — DTO cố ý KHÔNG có năm. */}
                    {t("birthday.onDate", { date: `${person.day}/${person.month}` })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onWish(person)}
                  data-testid="birthday-wish"
                  className="shrink-0 rounded px-2 py-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("birthday.wishButton")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PortalWidgetBlock>
  );
}
