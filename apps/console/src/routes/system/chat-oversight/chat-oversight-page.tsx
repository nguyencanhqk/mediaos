/**
 * S7-CHAT-FE-5 🔒 — CHAT-SCREEN-007: **Quản trị — đọc-vượt membership** (`/system/chat-oversight`).
 *
 * SPEC-15 §3.3 (ngoại lệ DUY NHẤT của ranh giới membership) · §9 · §20 ca 12. Backend: CHAT-API-018a/b/c.
 *
 * Ba trạng thái trong MỘT route: **tra cứu** → **hộp thoại xác nhận** → **phòng chỉ đọc**.
 * Hộp thoại KHÔNG phải trang trí: `018b`/`018c` chỉ được gọi SAU khi người dùng bấm Xác nhận, vì mỗi
 * lời gọi để lại một dòng trong `audit_logs` và một dòng audit phải tương ứng với một quyết định có ý
 * thức — chứ không phải với việc con trỏ chuột đi ngang một dòng bảng.
 *
 * ⚠️ Cổng quyền là `useCanChatOversight()` (= `useCanExact`), xem `lib/chat-oversight-gate.ts`.
 * ⚠️ Màn này CỐ Ý không nằm trong `apps/app`: xem docblock `oversight-room-view.tsx` và
 *    `docs/plans/S7-CHAT-FE-5.md` §2.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Eye, Search, ShieldAlert } from "lucide-react";
import type { ChatOversightRoomSummaryDto, ChatRoomType } from "@mediaos/contracts";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@mediaos/ui";
import { chatOversightApi } from "@mediaos/web-core";
import { useCanChatOversight } from "@/lib/chat-oversight-gate";
import { formatDateTimeShort, roomLabel } from "./chat-oversight-format";
import { OversightRoomView } from "./oversight-room-view";

/** Trần server là 50 (`chatOversightRoomQuerySchema`); lấy 20 cho một màn tra cứu. */
const ROOM_SEARCH_LIMIT = 20;

/** Server 422 khi `q` ngắn hơn — chặn ở client TRƯỚC khi gọi (request hỏng vẫn đốt một dòng audit). */
const MIN_QUERY_LENGTH = 2;

const ROOM_TYPES: readonly ChatRoomType[] = ["direct", "group", "department", "project"];

/**
 * Lần tra cứu ĐÃ GỬI. `runId` tăng mỗi lần bấm Tìm ⇒ mỗi lần bấm là đúng MỘT request = đúng MỘT dòng
 * audit, kể cả khi từ khoá không đổi. Kèm `refetchOnWindowFocus: false`: chuyển tab rồi quay lại KHÔNG
 * được tự sinh thêm dấu vết đọc-vượt mang tên người dùng.
 */
interface SubmittedSearch {
  q: string;
  roomType: ChatRoomType | "";
  runId: number;
}

export function ChatOversightPage() {
  const { t } = useTranslation("chat-oversight");
  const canOversight = useCanChatOversight();

  const [queryText, setQueryText] = useState("");
  const [roomType, setRoomType] = useState<ChatRoomType | "">("");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);

  /** Phòng đang chờ xác nhận (hộp thoại mở) — CHƯA gọi API nào. */
  const [pendingRoom, setPendingRoom] = useState<ChatOversightRoomSummaryDto | null>(null);
  /** Phòng đã được xác nhận mở ở chế độ chỉ đọc. */
  const [openedRoom, setOpenedRoom] = useState<ChatOversightRoomSummaryDto | null>(null);

  const trimmedQuery = queryText.trim();
  const isQueryTooShort = trimmedQuery.length < MIN_QUERY_LENGTH;

  const search = useQuery({
    queryKey: ["console:chat-oversight:rooms", submitted?.q, submitted?.roomType, submitted?.runId],
    queryFn: () =>
      chatOversightApi.searchRooms({
        q: submitted?.q ?? "",
        limit: ROOM_SEARCH_LIMIT,
        ...(submitted?.roomType ? { roomType: submitted.roomType } : {}),
      }),
    // Cổng đóng ⇒ KHÔNG gọi API. Người không có quyền phải thấy "không có quyền", không phải một lỗi
    // 403 — và không được để lại dòng audit `Denied` chỉ vì mở nhầm URL.
    enabled: canOversight && submitted !== null,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const columns = useMemo<ColumnDef<ChatOversightRoomSummaryDto>[]>(
    () => [
      {
        id: "name",
        header: t("table.room"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{roomLabel(row.original)}</p>
            <p className="text-xs text-muted-foreground">{row.original.roomCode}</p>
          </div>
        ),
      },
      {
        id: "roomType",
        header: t("table.roomType"),
        cell: ({ row }) => (
          <Badge variant="outline">{t(`roomType.${row.original.roomType}`)}</Badge>
        ),
      },
      {
        id: "memberCount",
        header: t("table.memberCount"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.memberCount}</span>
        ),
      },
      {
        id: "lastMessageAt",
        header: t("table.lastMessageAt"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastMessageAt === null
              ? "—"
              : formatDateTimeShort(row.original.lastMessageAt)}
          </span>
        ),
      },
      {
        id: "status",
        header: t("table.status"),
        cell: ({ row }) =>
          row.original.isArchived ? (
            <Badge variant="secondary">{t("room.archived")}</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setPendingRoom(row.original)}>
              <Eye className="mr-1.5 h-4 w-4" />
              {t("actions.openAsAdmin")}
            </Button>
          </div>
        ),
      },
    ],
    [t],
  );

  // ── Cổng quyền (lớp TRANG — lớp nav + lớp route ở nav.ts / router.tsx) ──────────────────────
  if (!canOversight) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ShieldAlert}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const onSubmit = () => {
    if (isQueryTooShort) return;
    setSubmitted((prev) => ({ q: trimmedQuery, roomType, runId: (prev?.runId ?? 0) + 1 }));
  };

  // ── Phòng chỉ đọc ───────────────────────────────────────────────────────────────────────────
  if (openedRoom !== null) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
        <OversightRoomView room={openedRoom} onBack={() => setOpenedRoom(null)} />
      </div>
    );
  }

  // ── Tra cứu ────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader title={t("title")} description={t("subtitle")} icon={Eye} />

      {/* Băng-rôn THƯỜNG TRỰC. SPEC-15 §3.3 đòi công bố ranh giới riêng tư thật, không chôn trong code:
          người dùng phải biết (a) phạm vi gồm cả phòng nhắn riêng, (b) mọi thao tác đều để lại dấu vết. */}
      <div
        role="note"
        className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">{t("banner.title")}</p>
          <p className="text-muted-foreground">{t("banner.description")}</p>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="min-w-[16rem] flex-1 space-y-1">
          <label htmlFor="chat-oversight-q" className="text-sm font-medium text-foreground">
            {t("search.label")}
          </label>
          <Input
            id="chat-oversight-q"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={t("search.placeholder")}
          />
        </div>

        <div className="w-48 space-y-1">
          <label htmlFor="chat-oversight-type" className="text-sm font-medium text-foreground">
            {t("search.roomType")}
          </label>
          <Select
            id="chat-oversight-type"
            value={roomType}
            onChange={(e) => setRoomType(e.target.value as ChatRoomType | "")}
          >
            <option value="">{t("search.allTypes")}</option>
            {ROOM_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`roomType.${type}`)}
              </option>
            ))}
          </Select>
        </div>

        <Button type="submit" disabled={isQueryTooShort || search.isFetching}>
          <Search className="mr-1.5 h-4 w-4" />
          {search.isFetching ? t("common.loading") : t("search.submit")}
        </Button>
      </form>

      {isQueryTooShort && trimmedQuery.length > 0 && (
        <p className="text-sm text-muted-foreground">{t("search.tooShort")}</p>
      )}

      {search.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t("search.error")}
        </p>
      )}

      {/* `truncated` = server đã CẮT bớt kết quả. Im lặng ở đây đọc ra y hệt "đã trả hết" và người dùng
          kết luận sai về phạm vi — endpoint cố ý không phân trang để không ai enumerate được cả công ty. */}
      {search.data?.truncated === true && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-foreground"
        >
          {t("search.truncated", { limit: ROOM_SEARCH_LIMIT })}
        </p>
      )}

      {submitted !== null && (
        <DataTable
          columns={columns}
          data={search.data?.data ?? []}
          isLoading={search.isPending}
          emptyState={
            <EmptyState
              icon={Search}
              title={t("search.emptyTitle")}
              description={t("search.emptyDescription")}
            />
          }
        />
      )}

      {/* Hộp thoại xác nhận — bước BẮT BUỘC của SPEC-15 §9 CHAT-SCREEN-007. */}
      <Dialog
        open={pendingRoom !== null}
        onClose={() => setPendingRoom(null)}
        title={t("confirm.title")}
        description={t("confirm.description")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingRoom(null)}>
              {t("confirm.cancel")}
            </Button>
            <Button
              onClick={() => {
                setOpenedRoom(pendingRoom);
                setPendingRoom(null);
              }}
            >
              {t("confirm.accept")}
            </Button>
          </div>
        }
      >
        {pendingRoom !== null && (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">{roomLabel(pendingRoom)}</p>
            <p className="text-muted-foreground">
              {pendingRoom.roomCode} · {t(`roomType.${pendingRoom.roomType}`)} ·{" "}
              {t("room.members", { count: pendingRoom.memberCount })}
            </p>
            <p className="text-muted-foreground">{t("confirm.auditNotice")}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
