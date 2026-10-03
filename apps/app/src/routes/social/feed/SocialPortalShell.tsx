/**
 * S16-SOCIAL-FE-1 — vỏ cổng thông tin SOCIAL: `PortalLayout` + rail trái + rail phải + ô tìm kiếm.
 *
 * Mọi màn `/feed*` đi qua đây, nên hai rail **không đổi** khi chuyển màn — đúng nghĩa "cổng thông
 * tin" của UI-07 §34b (khác `ModuleWorkspaceLayout`, nơi chỉ có một sidebar và phần còn lại là trang).
 *
 * Rail phải: Sinh nhật · Tin nổi bật · Bình chọn đang mở (FE-2) · Vinh danh tháng này (FE-2C) · Nhóm
 * của tôi (FE-2B, KHÔNG badge cho tới `S16-SOCIAL-BE-2C`) — thứ tự UI-07.
 *
 * ┌─ 🔴 VỎ NÀY LÀ CỦA SOCIAL, KHÔNG PHẢI CỦA MỌI `MODULE_PORTAL` ────────────────────────────────┐
 * │ Rail phải chở widget Sinh nhật + Tin nổi bật — hai thứ chỉ SOCIAL có. Hôm nay SOCIAL là module │
 * │ DUY NHẤT khai `layout: "MODULE_PORTAL"`, nên `router.tsx` trỏ thẳng nhánh đó vào đây. Khi có   │
 * │ module portal thứ hai, **đừng** để nó mượn rail của SOCIAL: `assertSocialPortal` bên dưới ném  │
 * │ ồn ào thay vì vẽ nhầm rail. Im lặng dùng chung sẽ cho một module khác thấy sinh nhật của cả    │
 * │ công ty — một lỗi phân quyền đội lốt lỗi bố cục.                                               │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  socialApi,
  socialGroupsApi,
  socialKeys,
  socialKudosApi,
  useCan,
  type ModuleCode,
} from "@mediaos/web-core";
import type { FeedBirthdayDto, FeedBirthdayRangeDto } from "@mediaos/contracts";
import { PortalLayout } from "@/layouts/portal/PortalLayout";
import { PortalLeftRail } from "@/layouts/portal/PortalLeftRail";
import { PortalRightRail } from "@/layouts/portal/PortalRightRail";
import { BirthdayWidget } from "./components/BirthdayWidget";
import { HighlightNewsWidget } from "./components/HighlightNewsWidget";
import { OpenPollsWidget } from "./components/OpenPollsWidget";
import { MyGroupsWidget } from "./components/MyGroupsWidget";
import { KudosThisMonthWidget } from "../kudos/components/KudosThisMonthWidget";
import { currentKudosMonth } from "../kudos/lib/kudos-month";
import { FeedSearchBox } from "./components/FeedSearchBox";
import { validateFeedRouteSearch } from "./lib/feed-route-search";

/** Số tin nổi bật lấy về cho rail phải — rail hẹp, danh sách dài chỉ làm nó cuộn vô ích. */
const HIGHLIGHT_LIMIT = 5;
/** S16-SOCIAL-FE-2 — số bình chọn đang mở cho widget rail (cùng lý do với `HIGHLIGHT_LIMIT`). */
const OPEN_POLLS_LIMIT = 5;
/** S16-SOCIAL-FE-2B — số nhóm của tôi trên rail; danh sách đủ ở `/feed/groups?membership=mine`. */
const MY_GROUPS_LIMIT = 5;
/** S16-SOCIAL-FE-2C (owner ký O1) — 5 lượt vinh danh mới nhất của tháng; đủ ở `/feed/kudos`. */
const KUDOS_WIDGET_LIMIT = 5;

interface SocialPortalShellProps {
  moduleCode: ModuleCode;
  children: React.ReactNode;
}

export function SocialPortalShell({
  moduleCode,
  children,
}: SocialPortalShellProps): React.ReactElement {
  const navigate = useNavigate();
  const canViewFeed = useCan("view", "feed");
  const [birthdayRange, setBirthdayRange] = React.useState<FeedBirthdayRangeDto>("today");

  if (moduleCode !== "SOCIAL") {
    // Fail-LOUD, không fail-soft: xem hộp cảnh báo ở đầu file.
    throw new Error(
      `[social] SocialPortalShell chỉ dùng cho module SOCIAL, nhận được "${moduleCode}". ` +
        "Module MODULE_PORTAL thứ hai phải có vỏ riêng, không mượn rail của SOCIAL.",
    );
  }

  /**
   * ⚠️ `enabled: canViewFeed` trên CẢ HAI query.
   *
   * Server đã 403 người không có `view:feed`, nên gọi vẫn "an toàn" — nhưng mỗi lần gọi là một dòng
   * 403 trong log và một lần rail phải nhấp nháy trạng thái lỗi. Cổng ở đây là để KHÔNG hỏi câu mà ta
   * đã biết câu trả lời.
   */
  const birthdaysQuery = useQuery({
    queryKey: socialKeys.birthdays({ range: birthdayRange }),
    queryFn: () => socialApi.listBirthdays({ range: birthdayRange }),
    enabled: canViewFeed,
  });

  const highlightQuery = useQuery({
    queryKey: socialKeys.news.list({ highlight: true, limit: HIGHLIGHT_LIMIT }),
    queryFn: () => socialApi.listNews({ limit: HIGHLIGHT_LIMIT }),
    enabled: canViewFeed,
  });

  /** S16-SOCIAL-FE-2 (plan D9) — cùng cổng `enabled: canViewFeed` với hai query trên. */
  const openPollsParams = { status: "open" as const, limit: OPEN_POLLS_LIMIT };
  const openPollsQuery = useQuery({
    queryKey: socialKeys.polls.list(openPollsParams),
    queryFn: () => socialApi.listPolls(openPollsParams),
    enabled: canViewFeed,
  });

  /**
   * S16-SOCIAL-FE-2B (plan D14) — `membership:'mine'` PHẢI truyền rõ: mặc định của `030` là `all`
   * (public ∪ nhóm có hàng) ⇒ bỏ trống là liệt kê SAI danh sách. Cùng cổng `enabled: canViewFeed`.
   */
  const myGroupsParams = { membership: "mine" as const, limit: MY_GROUPS_LIMIT };
  const myGroupsQuery = useQuery({
    queryKey: socialKeys.groups.list(myGroupsParams),
    queryFn: () => socialGroupsApi.list(myGroupsParams),
    enabled: canViewFeed,
  });

  /**
   * S16-SOCIAL-FE-2C (plan D12) — `month` TƯỜNG MINH theo giờ công ty: `047` vắng `month` là «gần đây»,
   * không phải «tháng này». Tính lại mỗi render (qua nửa đêm cuối tháng tự sang khoá tháng mới).
   */
  const kudosParams = { month: currentKudosMonth(), limit: KUDOS_WIDGET_LIMIT };
  const kudosQuery = useQuery({
    queryKey: socialKeys.kudos.list(kudosParams),
    queryFn: () => socialKudosApi.list(kudosParams),
    enabled: canViewFeed,
  });

  /**
   * «Gửi lời chúc» — D12/SOC-DEC-003: chỉ MỞ composer với nội dung điền sẵn, **không tự đăng bài**.
   *
   * Truyền qua URL (`?wish=`) chứ không qua context/state toàn cục: widget nằm ở rail, composer nằm ở
   * màn Bảng tin, và người dùng có thể đang đứng ở màn khác. URL là kênh duy nhất vừa điều hướng vừa
   * mang dữ liệu mà không cần hai component biết nhau.
   */
  const onWish = (person: FeedBirthdayDto): void => {
    void navigate({
      to: "/feed",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        wish: person.fullName ?? "",
      }),
    });
  };

  /**
   * Từ khoá HIỆN TẠI, đọc từ URL — URL là nguồn sự thật (đúng như docblock prop của `FeedSearchBox`
   * đã hứa). Trước đây chỗ này truyền hằng `""`, và cái giá KHÔNG phải là "ô trông hơi trống":
   *   · mở link chia sẻ `/feed?q=nghỉ+lễ` ⇒ danh sách đã lọc nhưng ô tìm kiếm RỖNG, người dùng
   *     không biết mình đang xem kết quả lọc;
   *   · nút ✕ chỉ render khi `draft.length > 0` ⇒ **không còn đường nào trên UI để xoá bộ lọc**,
   *     `onClearSearch` thành code không tới được;
   *   · `useEffect` đồng bộ URL→ô trong `FeedSearchBox` thành no-op vì `value` không bao giờ đổi.
   *
   * `strict: false` vì shell render dưới NHIỀU route `/feed*`, không chỉ `/feed` — route con không
   * khai `q` thì `useSearch` strict sẽ ném.
   *
   * 🔴 Và cũng vì thế mà `search.q` ở đây có thể là giá trị THÔ: route `/feed/news`, `/feed/saved`…
   * KHÔNG có `validateSearch`, parser JSON của router biến `?q=2026` thành SỐ, và số đó từng đi thẳng
   * vào ô tìm kiếm ⇒ Enter gọi `draft.trim()` trên một số ⇒ NÉM (S16-SOCIAL-FESEARCHBOUNDS-1). Lọc qua
   * CHÍNH bộ lọc của `/feed` — đích mà ô này điều hướng tới — để ô hiện đúng từ khoá `/feed` sẽ tìm.
   */
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const currentQuery = validateFeedRouteSearch(search).q ?? "";

  const onSearch = (q: string): void => {
    void navigate({ to: "/feed", search: (prev: Record<string, unknown>) => ({ ...prev, q }) });
  };

  const onClearSearch = (): void => {
    void navigate({
      to: "/feed",
      search: (prev: Record<string, unknown>) => {
        const { q: _q, ...rest } = prev;
        return rest;
      },
    });
  };

  return (
    <PortalLayout
      leftRail={<PortalLeftRail moduleCode="SOCIAL" />}
      searchSlot={
        <FeedSearchBox value={currentQuery} onSubmit={onSearch} onClear={onClearSearch} />
      }
      rightRail={
        <PortalRightRail>
          <BirthdayWidget
            range={birthdayRange}
            onRangeChange={setBirthdayRange}
            items={birthdaysQuery.data?.data ?? []}
            isLoading={birthdaysQuery.isLoading}
            isError={birthdaysQuery.isError}
            onWish={onWish}
          />
          <HighlightNewsWidget
            // Chỉ tin ĐÃ GHIM mới là "nổi bật"; `020` trả tin ghim lên đầu nên lọc tại chỗ là đủ,
            // không cần thêm một endpoint riêng cho việc suy được từ dữ liệu đã có.
            items={(highlightQuery.data?.data ?? []).filter((n) => n.pinned)}
            isLoading={highlightQuery.isLoading}
            isError={highlightQuery.isError}
          />
          <OpenPollsWidget
            items={openPollsQuery.data?.data ?? []}
            isLoading={openPollsQuery.isLoading}
            isError={openPollsQuery.isError}
          />
          <KudosThisMonthWidget
            items={kudosQuery.data?.data ?? []}
            isLoading={kudosQuery.isLoading}
            isError={kudosQuery.isError}
          />
          <MyGroupsWidget
            items={myGroupsQuery.data?.data ?? []}
            isLoading={myGroupsQuery.isLoading}
            isError={myGroupsQuery.isError}
          />
        </PortalRightRail>
      }
    >
      {children}
    </PortalLayout>
  );
}
