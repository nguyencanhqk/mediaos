/**
 * S7-CHAT-FE-4 — I/O của màn tìm kiếm tin nhắn (CHAT-SCREEN-005 · CHAT-API-015 · SPEC-15 §13.7).
 *
 * Hook riêng chứ không nhét vào component vì ở đây có ba thứ đua nhau: chống dội, con trỏ keyset và
 * response về KHÔNG theo thứ tự gửi. Trộn chúng với JSX là cách chắc chắn nhất để kết quả của câu "báo"
 * ghi đè kết quả của câu "báo cáo" mà không ai tái hiện được.
 *
 * ⚠️ KHÔNG dùng react-query: mỗi lần gõ là một khoá cache mới, tức cache đầy rác trong 5 phút cho những
 * câu người dùng gõ dở (`"b"`, `"bá"`, `"báo"`…), và trang thứ hai phải NỐI vào trang trước chứ không
 * phải một entry khác. State cục bộ + một `requestId` tăng dần là đủ và đọc được.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chatApi } from "@mediaos/web-core";
import type { ChatSearchResultDto } from "@mediaos/contracts";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS, SEARCH_PAGE_SIZE } from "@/routes/chat/constants";

export interface MessageSearchState {
  /** Câu đã áp dụng (sau chống dội) — dùng cho thông điệp "không có kết quả cho …". */
  appliedQuery: string;
  results: readonly ChatSearchResultDto[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  hasMore: boolean;
  /** Câu quá ngắn ⇒ UI nhắc tại chỗ. Trạng thái này KHÔNG sinh lời gọi API nào. */
  isTooShort: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** `q` sau `trim` + NFC — đúng khuôn `chatSearchQuerySchema` để client và server đếm ký tự giống nhau. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().normalize("NFC");
}

/**
 * @param rawQuery câu người dùng đang gõ (chưa chuẩn hoá).
 * @param roomId   bó theo MỘT phòng (`null` = mọi phòng mình là thành viên).
 */
export function useMessageSearch(rawQuery: string, roomId: string | null): MessageSearchState {
  const [appliedQuery, setAppliedQuery] = useState("");
  const [results, setResults] = useState<readonly ChatSearchResultDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasError, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const query = normalizeSearchQuery(rawQuery);
  const isTooShort = query.length > 0 && query.length < SEARCH_MIN_CHARS;
  const isSearchable = query.length >= SEARCH_MIN_CHARS;

  /**
   * Mọi response phải chứng minh mình thuộc lần tìm MỚI NHẤT trước khi được ghi vào state.
   *
   * Không có chốt này thì: gõ "báo" (chậm) rồi "báo cáo" (nhanh) ⇒ response của "báo" về SAU và ghi đè
   * kết quả đúng. Người dùng thấy danh sách không khớp ô nhập, gõ lại thì hết — không tái hiện được.
   */
  const requestIdRef = useRef(0);

  // ── Lần tìm đầu (chống dội) ────────────────────────────────────────────────
  useEffect(() => {
    if (!isSearchable) {
      // Xoá kết quả cũ NGAY: giữ lại là hiển thị kết quả của câu người dùng vừa xoá đi.
      requestIdRef.current += 1;
      setResults([]);
      setNextCursor(null);
      setAppliedQuery("");
      setLoading(false);
      setLoadingMore(false);
      setError(false);
      return;
    }

    const timer = setTimeout(() => {
      const requestId = (requestIdRef.current += 1);
      setLoading(true);
      setError(false);
      void chatApi
        .search({
          q: query,
          limit: SEARCH_PAGE_SIZE,
          ...(roomId !== null ? { roomId } : {}),
        })
        .then((page) => {
          if (requestId !== requestIdRef.current) return; // đã có lần tìm mới hơn
          setResults(page.data);
          setNextCursor(page.nextCursor);
          setAppliedQuery(query);
        })
        .catch((err: unknown) => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setNextCursor(null);
          setAppliedQuery(query);
          setError(true);
          console.error("[chat] tìm kiếm tin nhắn thất bại:", err);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isSearchable, query, roomId, retryToken]);

  // ── Trang kế (con trỏ keyset) ──────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (nextCursor === null || isLoading || isLoadingMore || !isSearchable) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    void chatApi
      .search({
        q: query,
        limit: SEARCH_PAGE_SIZE,
        cursor: nextCursor,
        ...(roomId !== null ? { roomId } : {}),
      })
      .then((page) => {
        // Người dùng gõ tiếp trong lúc trang 2 đang bay ⇒ VỨT trang này. Nối nó vào danh sách của câu
        // mới là trộn kết quả hai câu khác nhau — sai theo kiểu trông vẫn hợp lý.
        if (requestId !== requestIdRef.current) return;
        setResults((prev) => [...prev, ...page.data]);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setError(true);
        console.error("[chat] tải thêm kết quả tìm kiếm thất bại:", err);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingMore(false);
      });
  }, [isLoading, isLoadingMore, isSearchable, nextCursor, query, roomId]);

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);

  return {
    appliedQuery,
    results,
    isLoading,
    isLoadingMore,
    hasError,
    hasMore: nextCursor !== null,
    isTooShort,
    loadMore,
    retry,
  };
}
