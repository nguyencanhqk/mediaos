/**
 * S16-SOCIAL-FE-3B (L4) — màn Thiết lập huy hiệu `SOC-SCREEN-012`: bảng huy hiệu ở góc nhìn quản trị (đọc
 * `SOCIAL-API-056`, CẢ huy hiệu đã tắt) + bốn lượt ghi — tạo (049) / sửa (050) qua `BadgeFormDialog`, «Ngừng
 * dùng» (051, có bước xác nhận) và «Bật lại» (050 `{ isActive: true }`) ngay trên hàng (`useBadgeToggle`).
 *
 * Cổng: màn KHÔNG có cổng riêng. Route gác `view:feed` + `manage:feed-kudos`, và cả bốn route server của màn
 * chung cặp `manage:feed-kudos` (plan M7) — ai vào được màn thì làm được mọi việc trong màn. Server vẫn là cổng
 * cuối (403 ⇒ dải `forbidden`).
 *
 * BỐN LUẬT của màn:
 *  1. Sau MỖI lượt ghi (và mỗi lỗi báo «thứ đang thấy đã cũ») làm mới HAI khoá qua `invalidateBadgeCatalogs`:
 *     nhánh quản trị VÀ `kudos.badges()` — ô chọn huy hiệu của composer vinh danh (plan D13). Lượt SỬA đổi tên
 *     hoặc biểu tượng làm mới thêm mọi bề mặt đang vẽ lời vinh danh (`invalidateBadgeDisplaySurfaces`).
 *  2. Hộp xác nhận «Ngừng dùng» hỏi CẢ cờ đồng bộ của lượt ghi trước khi đóng: «Huỷ» / Esc cùng nhịp với «Ngừng
 *     dùng» thấy `isPending` còn `false`, đóng được là yêu cầu đã lên dây mà người dùng tưởng đã huỷ.
 *  3. Dải kết cục vẽ ở TRANG: hộp thoại đã đóng, còn hàng vừa bấm thì đổi nút (hoặc biến mất) sau lượt đọc lại
 *     (plan B6). Dải thành công LUÔN vẽ; riêng dải lỗi có câu «danh sách đã được làm mới» thì không vẽ khi
 *     lượt đọc đang lỗi (`claimsListRefreshed`) — không nói hai điều trái nhau.
 *  4. Tham số 056 và search kế tiếp CHỈ suy bằng hàm thuần của `badge-route-search`.
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { socialKeys, socialKudosApi } from "@mediaos/web-core";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminErrorNotice } from "../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../admin/lib/admin-errors";
import { DoneNotice } from "../moderation/components/DoneNotice";
import { claimsListRefreshed } from "../moderation/lib/moderation-errors";
import { OUTCOME_FOCUS_CLASS, useOutcomeFocus } from "../moderation/lib/use-outcome-focus";
import { BadgeFormDialog, type BadgeFormOutcome } from "./components/BadgeFormDialog";
import { BadgeList } from "./components/BadgeList";
import {
  invalidateBadgeCatalogs,
  invalidateBadgeDisplaySurfaces,
  isBadgeDisplayChanged,
} from "./lib/badge-invalidation";
import {
  badgeListParams,
  searchForBadgePage,
  validateBadgeRouteSearch,
} from "./lib/badge-route-search";
import {
  useBadgeToggle,
  type BadgeToggleKind,
  type BadgeToggleResult,
  type BadgeToggleVariables,
} from "./lib/use-badge-toggle";

/** Khoá của câu xác nhận ở `social:admin.badges.page.outcome.*`. */
type DoneKind = "created" | "updated" | "deactivated" | "reactivated";

/** Dải «kết cục» của lượt ghi gần nhất. `retry` có ⇔ gửi lại NGUYÊN lượt tắt / bật đó có thể thành công. */
type PageNotice =
  | { kind: "done"; done: DoneKind; name: string }
  | { kind: "failed"; reason: AdminErrorReason; retry: BadgeToggleVariables | null };

/** Hộp thoại tạo / sửa đang mở: `badge: null` = tạo. */
interface FormTarget {
  badge: KudosBadgeAdminDto | null;
}

const DONE_OF_TOGGLE: Readonly<Record<BadgeToggleKind, DoneKind>> = {
  deactivate: "deactivated",
  reactivate: "reactivated",
};
const DONE_OF_FORM_MODE = { create: "created", edit: "updated" } as const;

function noticeOfToggle(result: BadgeToggleResult): PageNotice {
  return result.kind === "done"
    ? { kind: "done", done: DONE_OF_TOGGLE[result.toggle], name: result.badge.name }
    : { kind: "failed", reason: result.reason, retry: result.retry };
}

function noticeOfForm(outcome: BadgeFormOutcome): PageNotice {
  return outcome.kind === "done"
    ? { kind: "done", done: DONE_OF_FORM_MODE[outcome.mode], name: outcome.badge.name }
    : { kind: "failed", reason: outcome.reason, retry: null };
}

/** Luật 3 ở docblock. */
function isNoticeContradictedByReadError(notice: PageNotice, isReadError: boolean): boolean {
  return isReadError && notice.kind === "failed" && claimsListRefreshed(notice.reason);
}

interface PageNoticeBarProps {
  notice: PageNotice;
  onRetry: (variables: BadgeToggleVariables) => void;
  onDismiss: () => void;
}

function PageNoticeBar({ notice, onRetry, onDismiss }: PageNoticeBarProps): React.ReactElement {
  const { t } = useTranslation("social");
  if (notice.kind === "failed") {
    const { retry } = notice;
    return (
      <AdminErrorNotice
        reason={notice.reason}
        onRetry={retry === null ? undefined : () => onRetry(retry)}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <DoneNotice
      message={t(`admin.badges.page.outcome.${notice.done}`, { name: notice.name })}
      onDismiss={onDismiss}
    />
  );
}

interface DeactivateConfirmProps {
  badge: KudosBadgeAdminDto;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeactivateConfirm({
  badge,
  isPending,
  onConfirm,
  onCancel,
}: DeactivateConfirmProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <ConfirmDialog
      open
      title={t("admin.badges.page.deactivateConfirm.title", { name: badge.name })}
      description={t("admin.badges.page.deactivateConfirm.body")}
      confirmLabel={t("admin.badges.page.deactivateConfirm.confirm")}
      cancelLabel={t("admin.badges.page.deactivateConfirm.cancel")}
      busy={isPending}
      busyLabel={t("admin.badges.page.deactivateConfirm.working")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function BadgeSettingsPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Lọc lại bằng CHÍNH `validateSearch` của route: màn không phụ thuộc việc route đã nối validator hay chưa.
  const params = badgeListParams(validateBadgeRouteSearch(useSearch({ strict: false })));

  const [formTarget, setFormTarget] = React.useState<FormTarget | null>(null);
  const [confirming, setConfirming] = React.useState<KudosBadgeAdminDto | null>(null);
  const [notice, setNotice] = React.useState<PageNotice | null>(null);
  // Sau kết cục, thứ đang giữ focus (nút của hàng / nút kích hoạt hộp thoại) sắp bị thay ⇒ focus tới dải kết
  // cục; dải không được vẽ (luật 3) ⇒ tới vùng của màn.
  const outcomeFocus = useOutcomeFocus<HTMLDivElement, HTMLDivElement>();

  const query = useQuery({
    queryKey: socialKeys.kudos.badgesAdmin(params),
    queryFn: () => socialKudosApi.listBadgesAdmin(params),
    // Lật trang: giữ trang cũ (bộ chuyển trang khoá theo `isFetching`) thay vì nháy khung chờ.
    placeholderData: keepPreviousData,
    // Bảng quản trị cũ mà trông như mới là mời tắt / sửa một huy hiệu người khác vừa đổi.
    staleTime: 0,
  });

  /** Luật 1: kết cục nào cho thấy cache đã cũ thì làm mới. */
  const settle = (next: PageNotice, isStale: boolean): void => {
    if (isStale) invalidateBadgeCatalogs(queryClient);
    setNotice(next);
  };

  const toggle = useBadgeToggle((result) => {
    const isStale = result.kind === "done" || result.invalidate;
    setConfirming(null);
    settle(noticeOfToggle(result), isStale);
    // Hàng sắp đổi ⇒ focus rời nút của nó tới dải kết cục. Lỗi KHÔNG làm mới (403 · 400 · 4xx lạ) ⇒ hàng còn
    // nguyên, focus ở lại. Hộp thoại tạo / sửa ĐANG MỞ («Sửa» · «Thêm huy hiệu» không khoá theo lượt tắt / bật)
    // ⇒ KHÔNG kéo: focus đang ở trong modal, kéo ra sau lớp phủ là phím gõ tiếp rơi mất và Tab đi vào bảng
    // phía sau. Dải vẫn vẽ; đóng hộp thoại thì focus về nút đã mở nó.
    if (isStale && formTarget === null) outcomeFocus.requestFocus();
  });

  /** `start` là CỔNG gửi-đúp duy nhất: lượt hai trong cùng nhịp nhận `false`, không có gì lên dây. */
  const startToggle = (variables: BadgeToggleVariables): void => {
    if (toggle.start(variables)) setNotice(null);
  };
  // Luật 2.
  const cancelConfirm = (): void => {
    if (!toggle.isPending && !toggle.isLocked()) setConfirming(null);
  };
  const openForm = (badge: KudosBadgeAdminDto | null): void => {
    setNotice(null);
    setFormTarget({ badge });
  };
  const handleFormOutcome = (outcome: BadgeFormOutcome): void => {
    const opened = formTarget?.badge ?? null;
    setFormTarget(null);
    // So hàng SERVER trả với hàng lúc mở: tên / biểu tượng đổi ⇒ lời vinh danh cũ trên các bề mặt khác đã cũ.
    if (
      outcome.kind === "done" &&
      opened !== null &&
      isBadgeDisplayChanged(opened, outcome.badge)
    ) {
      invalidateBadgeDisplaySurfaces(queryClient);
    }
    settle(noticeOfForm(outcome), outcome.kind === "done" || outcome.invalidate);
    // Nút «Sửa» đã mở hộp thoại có thể không còn sau lượt đọc lại; lỗi không làm mới vẫn cần đọc dải ở trang.
    outcomeFocus.requestFocus();
  };
  // Lỗi GIỮ hộp thoại. Ở chế độ SỬA, lượt ghi không có câu trả lời đọc được có thể ĐÃ đổi tên / biểu tượng:
  // bảng đọc lại hiện giá trị mới thì các bề mặt vẽ lời vinh danh cũng phải đọc lại (không biết trường nào đã
  // ghi ⇒ làm mới thừa còn hơn giữ tên cũ cạnh tên mới).
  const handleFormStale = (): void => {
    invalidateBadgeCatalogs(queryClient);
    if (formTarget !== null && formTarget.badge !== null)
      invalidateBadgeDisplaySurfaces(queryClient);
  };
  const handlePageChange = (page: number): void => {
    setNotice(null);
    // `to: "."` = ở lại CHÍNH route đang mount màn này, thay TOÀN BỘ search (search kế tiếp luôn mang `page`).
    void navigate({ to: ".", search: searchForBadgePage(page) });
  };

  return (
    <div
      ref={outcomeFocus.fallbackRef}
      tabIndex={-1}
      className="flex flex-col gap-4 focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("admin.badges.page.title")}</h1>
        <Button type="button" size="sm" onClick={() => openForm(null)}>
          {t("admin.badges.page.add")}
        </Button>
      </div>

      {notice !== null && !isNoticeContradictedByReadError(notice, query.isError) && (
        <div ref={outcomeFocus.noticeRef} tabIndex={-1} className={OUTCOME_FOCUS_CLASS}>
          <PageNoticeBar notice={notice} onRetry={startToggle} onDismiss={() => setNotice(null)} />
        </div>
      )}

      <BadgeList
        page={query.data}
        isFetching={query.isFetching}
        error={query.isError ? query.error : null}
        isBusy={toggle.isPending}
        onRetry={() => void query.refetch()}
        onPageChange={handlePageChange}
        onEdit={openForm}
        onDeactivate={(badge) => {
          setNotice(null);
          setConfirming(badge);
        }}
        onReactivate={(badge) => startToggle({ kind: "reactivate", badge })}
      />

      {confirming !== null && (
        <DeactivateConfirm
          badge={confirming}
          isPending={toggle.isPending}
          onConfirm={() => startToggle({ kind: "deactivate", badge: confirming })}
          onCancel={cancelConfirm}
        />
      )}

      {formTarget !== null && (
        <BadgeFormDialog
          badge={formTarget.badge}
          onClose={() => setFormTarget(null)}
          onOutcome={handleFormOutcome}
          onStale={handleFormStale}
        />
      )}
    </div>
  );
}
