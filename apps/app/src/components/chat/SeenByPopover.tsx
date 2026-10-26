/**
 * S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — THÂN bảng «Đã xem · Chưa xem» của một tin CỦA TÔI.
 *
 * Cùng một thân cho hai lớp nổi (`Popover` trên máy có chuột, `Sheet` khi cảm ứng — `SeenByAvatars`
 * chọn); thân không biết mình nằm trong lớp nào.
 *
 * Ba luật giữ ở đây:
 *   - Roster chưa `ready` ⇒ chỉ một dòng trạng thái, KHÔNG tab, KHÔNG tên nào. Danh sách dựng từ roster
 *     rỗng/cũ là danh sách SAI («Chưa xem (0)» khi thật ra chưa biết) — tệ hơn không có gì.
 *   - Không thời điểm đọc, không số liệu nào ngoài hai con đếm của đúng tin này (§3.2-6).
 *   - «Nhắn riêng» chỉ trên dòng «Chưa xem», chỉ khi `useCanOpenDirect()` (khung mở phòng + cặp
 *     `create:chat-room`) — thiếu thì bảng chỉ đọc. `useOpenDirect` (react-query) chỉ được gọi trong nhánh
 *     có quyền, để bong bóng ở nơi không có `QueryClientProvider` vẫn vẽ được.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react";
import { Avatar, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@mediaos/ui";
import { useCanOpenDirect } from "./chat-room-opener";
import type { SeenByViewer } from "./SeenByAvatars";
import type { SeenByRosterStatus } from "./seen-by-status";
import { useOpenDirect } from "./use-open-direct";

type SeenTab = "seen" | "unseen";

interface SeenByPanelProps {
  seen: readonly SeenByViewer[];
  unseen: readonly SeenByViewer[];
  status: SeenByRosterStatus;
  /** Đóng lớp nổi chứa thân này (trước khi mở DM — đừng để bảng treo trên phòng mới). */
  onRequestClose: () => void;
}

export function SeenByPanel({
  seen,
  unseen,
  status,
  onRequestClose,
}: SeenByPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  // Chưa ai xem ⇒ mở thẳng tab «Chưa xem»: đó là câu hỏi người gửi đang hỏi.
  const [tab, setTab] = useState<SeenTab>(() => (seen.length > 0 ? "seen" : "unseen"));
  const canOpenDirect = useCanOpenDirect();

  if (status !== "ready") {
    return (
      <div
        data-testid="chat-seen-panel"
        role={status === "error" ? "alert" : "status"}
        className="w-64 max-w-full px-1 py-2 text-sm text-muted-foreground"
      >
        {status === "error" ? t("seenBy.error") : t("seenBy.loading")}
      </div>
    );
  }

  return (
    <div data-testid="chat-seen-panel" className="w-64 max-w-full">
      <Tabs value={tab} onValueChange={(v) => setTab(v === "unseen" ? "unseen" : "seen")}>
        <TabsList className="flex-nowrap">
          <TabsTrigger value="seen" className="flex-1 px-2">
            {t("seenBy.seenTab", { count: seen.length })}
          </TabsTrigger>
          <TabsTrigger value="unseen" className="flex-1 px-2">
            {t("seenBy.unseenTab", { count: unseen.length })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="seen">
          <PeopleList people={seen} rowTestId="chat-seen-row" empty={t("seenBy.nobodySeen")} />
        </TabsContent>
        <TabsContent value="unseen">
          {canOpenDirect ? (
            <UnseenWithDirect people={unseen} onRequestClose={onRequestClose} />
          ) : (
            <PeopleList
              people={unseen}
              rowTestId="chat-unseen-row"
              empty={t("seenBy.everyoneSeen")}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface PeopleListProps {
  people: readonly SeenByViewer[];
  rowTestId: string;
  empty: string;
  /** Hành động cuối dòng (chỉ «Chưa xem» có). */
  renderAction?: (viewer: SeenByViewer, name: string) => React.ReactNode;
}

function PeopleList({
  people,
  rowTestId,
  empty,
  renderAction,
}: PeopleListProps): React.ReactElement {
  const { t } = useTranslation("chat");
  if (people.length === 0) {
    return <p className="px-1 py-3 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    // Phòng 50 người: danh sách tự cuộn trong bảng, không đẩy bảng dài khỏi khung nhìn.
    <ul className="max-h-64 overflow-y-auto py-1">
      {people.map((viewer) => {
        const name = viewer.name ?? t("message.unknownSender");
        return (
          <li
            key={viewer.userId}
            data-testid={rowTestId}
            className="flex items-center gap-2 px-1 py-1.5"
          >
            <Avatar
              name={viewer.name}
              src={viewer.avatarUrl}
              size="sm"
              aria-hidden="true"
              className="h-6 w-6 shrink-0 text-[10px]"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
            {renderAction?.(viewer, name)}
          </li>
        );
      })}
    </ul>
  );
}

function UnseenWithDirect({
  people,
  onRequestClose,
}: {
  people: readonly SeenByViewer[];
  onRequestClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  const { openDirect, pendingPeerId } = useOpenDirect();
  return (
    <PeopleList
      people={people}
      rowTestId="chat-unseen-row"
      empty={t("seenBy.everyoneSeen")}
      renderAction={(viewer, name) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          aria-label={t("direct.actionFor", { name })}
          disabled={pendingPeerId === viewer.userId}
          onClick={() => {
            onRequestClose();
            openDirect(viewer.userId);
          }}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {t("direct.action")}
        </Button>
      )}
    />
  );
}
