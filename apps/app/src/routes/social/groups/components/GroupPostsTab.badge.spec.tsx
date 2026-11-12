/**
 * S16-SOCIAL-FEGROUPBADGE-1 — badge «N bài mới» theo nhóm ở tab Bài viết + widget «Nhóm của tôi».
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import i18n from "@/i18n";
import {
  GROUP_ID,
  makeGroup,
  page,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../../feed/social-test-doubles";
import { MyGroupsWidget } from "../../feed/components/MyGroupsWidget";
import type { GroupCapabilities } from "../lib/group-capabilities";
import { GroupPostsTab } from "./GroupPostsTab";

type Handler = (payload: unknown) => void;
const handlers = new Set<Handler>();
const listFeed = vi.fn();
const fakeSocket = {
  on: (_e: string, fn: Handler) => void handlers.add(fn),
  off: (_e: string, fn: Handler) => void handlers.delete(fn),
};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: () => fakeSocket,
    socialApi: { ...actual.socialApi, listFeed: (...a: unknown[]) => listFeed(...a) },
  };
});
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <a href="#x" onClick={onClick}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
  };
});
vi.mock("@/layouts/portal/PortalRightRail", () => ({
  PortalWidgetBlock: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const t = i18n.getFixedT("vi", "social");
const emit = (payload: unknown) => handlers.forEach((fn) => fn(payload));
const wsPost = (groupId: string, audience = "group") => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  audience,
  orgUnitId: null,
  groupId: audience === "group" ? groupId : null,
  author: { employeeId: null, fullName: "An", avatarUrl: null },
  body: "chào",
  tags: [],
  attachments: [],
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 0,
  commentCount: 0,
  viewCount: 0,
  editedAt: null,
  publishedAt: "2026-09-23T03:00:00.000Z",
  lastActivityAt: "2026-09-23T03:00:00.000Z",
  createdAt: "2026-09-23T03:00:00.000Z",
});

const caps = {
  canReadPosts: true,
  canPost: false,
  isManageViewer: false,
  canJoin: false,
} as GroupCapabilities;

beforeEach(() => {
  handlers.clear();
  setCaps({ "view:feed": true });
  listFeed.mockResolvedValue(page([]));
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("GroupPostsTab — badge theo nhóm", () => {
  it("bài nhóm B không làm badge nhóm A tăng; bài nhóm A tăng; bài công ty không tăng", async () => {
    renderWithProviders(<GroupPostsTab group={makeGroup()} caps={caps} />);
    await waitFor(() => expect(handlers.size).toBe(1));
    act(() => {
      emit(wsPost(OTHER_ID));
      emit(wsPost(GROUP_ID, "company"));
    });
    expect(screen.queryByTestId("new-posts-badge")).toBeNull();
    act(() => emit(wsPost(GROUP_ID)));
    expect(screen.getByTestId("new-posts-badge").textContent).toContain(
      t("newPosts.badge", { count: 1 }),
    );
    expect(WS_EVENTS.FEED_POST_CREATED).toBeTruthy();
  });

  it("bấm badge ⇒ refetch feed nhóm đó (groupId) và badge biến mất", async () => {
    renderWithProviders(<GroupPostsTab group={makeGroup()} caps={caps} />);
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(1));
    act(() => emit(wsPost(GROUP_ID)));
    fireEvent.click(screen.getByTestId("new-posts-badge"));
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(2));
    expect(listFeed).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: GROUP_ID }));
    expect(screen.queryByTestId("new-posts-badge")).toBeNull();
  });
});

describe("MyGroupsWidget — badge theo nhóm", () => {
  it("chỉ nhóm có bài mới hiện số; vào nhóm ⇒ xoá số", () => {
    const groups = [makeGroup(), makeGroup({ id: OTHER_ID, name: "Cờ vua" })];
    renderWithProviders(<MyGroupsWidget items={groups} isLoading={false} isError={false} />);
    act(() => {
      emit(wsPost(OTHER_ID));
      emit(wsPost(OTHER_ID));
    });
    expect(screen.queryByTestId(`my-group-new-${GROUP_ID}`)).toBeNull();
    expect(screen.getByTestId(`my-group-new-${OTHER_ID}`).textContent).toBe(
      t("groups.widget.newPosts", { count: 2 }),
    );
    fireEvent.click(screen.getByText("Cờ vua"));
    expect(screen.queryByTestId(`my-group-new-${OTHER_ID}`)).toBeNull();
  });
});
