/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — route con `/chat/$roomId` trên router THẬT (bộ nhớ lịch sử).
 *
 * Dựng cây giống `router.tsx`: cha `/chat` dựng `ChatRoute`, con `$roomId` không component, cùng
 * `beforeLoad`/`validateSearch` xuất từ `chat-room-link.ts`. `ChatPage` được thay bằng bản ghi props để
 * đo đúng phần cầu URL ↔ trang.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

interface CapturedProps {
  roomId: string | null;
  messageId?: string | null;
  onRoomChange: (roomId: string | null) => void;
}
const captured: { current: CapturedProps | null } = { current: null };

vi.mock("./ChatPage", () => ({
  ChatPage: (props: CapturedProps) => {
    captured.current = props;
    return (
      <div data-testid="chat-page-stub">
        {props.roomId ?? "none"}|{props.messageId ?? "none"}
      </div>
    );
  },
}));

import { ChatRoute } from "./ChatRoute";
import {
  CHAT_ROOM_SEGMENT,
  redirectInvalidChatRoom,
  validateChatRoomSearch,
} from "./chat-room-link";

const R1 = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const R2 = "8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e";
const MSG = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

function buildRouter(initialEntries: string[]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const tasksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks",
    component: () => <div data-testid="tasks-page" />,
  });
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/chat",
    component: ChatRoute,
  });
  const chatRoomRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: CHAT_ROOM_SEGMENT,
    beforeLoad: ({ params }) => redirectInvalidChatRoom(params.roomId),
    validateSearch: validateChatRoomSearch,
  });
  const history = createMemoryHistory({ initialEntries, initialIndex: initialEntries.length - 1 });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tasksRoute, chatRoute.addChildren([chatRoomRoute])]),
    history,
  });
  render(<RouterProvider router={router as never} />);
  return { router, history };
}

afterEach(() => {
  cleanup();
  captured.current = null;
});

describe("/chat/$roomId — route con", () => {
  it("dán `/chat/R` ⇒ trang chat với R xin mở sẵn (không 404)", async () => {
    buildRouter([`/chat/${R1}`]);
    expect((await screen.findByTestId("chat-page-stub")).textContent).toBe(`${R1}|none`);
  });

  it("`/chat` (không phòng) vẫn khớp trang chat", async () => {
    buildRouter(["/chat"]);
    expect((await screen.findByTestId("chat-page-stub")).textContent).toBe("none|none");
  });

  it("`?msg=<uuid>` tới trang; `?msg=` rác bị bỏ, không ném", async () => {
    buildRouter([`/chat/${R1}?msg=${MSG}`]);
    expect((await screen.findByTestId("chat-page-stub")).textContent).toBe(`${R1}|${MSG}`);
    cleanup();
    buildRouter([`/chat/${R1}?msg=abc`]);
    expect((await screen.findByTestId("chat-page-stub")).textContent).toBe(`${R1}|none`);
  });

  it("roomId KHÔNG phải UUID ⇒ replace về /chat trước khi dựng trang (không phòng nào xin mở)", async () => {
    const { router, history } = buildRouter(["/tasks", "/chat/abc"]);
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat"));
    expect((await screen.findByTestId("chat-page-stub")).textContent).toBe("none|none");
    // replace: Back về /tasks, không quay lại `/chat/abc`.
    act(() => history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
  });

  it("chọn phòng trong trang là `replace` (Q5 = A): Back rời /chat về trang trước", async () => {
    const { router, history } = buildRouter(["/tasks", `/chat/${R1}`]);
    await screen.findByTestId("chat-page-stub");

    act(() => captured.current?.onRoomChange(R2));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${R2}`));

    act(() => history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
  });

  it("quay lại danh sách (`onRoomChange(null)`) ⇒ /chat bằng replace", async () => {
    const { router, history } = buildRouter(["/tasks", `/chat/${R1}`]);
    await screen.findByTestId("chat-page-stub");

    act(() => captured.current?.onRoomChange(null));
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat"));

    act(() => history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
  });
});
