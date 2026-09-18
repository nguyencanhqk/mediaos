import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { PayslipDto } from "@mediaos/contracts";
import { Badge, Button, Dialog } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "../constants";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import { displayUserRef, type PayrollPeopleLookup } from "../use-payroll-people";

/**
 * S15-PAYROLL-FE-6 — «Thêm người vào đợt chi trả» (PAYROLL-API-069 `addUserIds`, PAY-SCREEN-013).
 *
 * ── VÌ SAO NGUỒN LÀ PHIẾU LƯƠNG (029), KHÔNG PHẢI DANH BẠ NHÂN SỰ ────────────────────────────────
 * BE chỉ nhận người **có phiếu trong CHÍNH kỳ của đợt**; id ngoài tập đó ⇒ 404
 * (`payroll-payment-batches.service.ts:505`). Lấy người từ API HR là mời người dùng chọn rồi ăn 404 —
 * và `payroll-officer` không giữ cặp nào của API-03 nên còn không gọi được.
 *
 * 🔴 **029 GHI `audit_logs` MỖI LƯỢT GỌI** (`{action:'read', objectType:'payslip', view:'list'}` —
 * `payroll-payslips.service.ts:198-204`). Vì thế component này được cha render **CÓ ĐIỀU KIỆN** (chỉ
 * khi hộp thoại mở): hộp thoại đóng ⇒ hook không chạy ⇒ không có hàng audit «đã xem danh sách phiếu»
 * cho một lượt mở không hề xảy ra. Mỗi lượt MỞ hộp thoại = 1 hàng audit đọc phiếu — đó là hành vi
 * ĐÚNG, không phải rò.
 *
 * Cờ `enabled` bên dưới là lớp gác THỨ HAI, tự đứng được: component tự hỏi `useCanExact` chứ không
 * tin vào việc cha có unmount hay không. Cha đổi sang kiểu GIỮ-MOUNTED (panel gập bằng CSS chẳng hạn)
 * là unmount hết còn bảo vệ gì — lúc đó chỉ cờ này giữ cho bất biến audit đứng vững.
 *
 * ⚠️ **Không render `net`** (DTO có khoá tiền khi người gọi giữ cặp chở-tiền): đây là màn CHỌN NGƯỜI,
 * không phải màn tiền — thêm cột tiền ở đây là mở một mặt đọc tiền mới không ai yêu cầu.
 *
 * ⚠️ **Gửi TỪNG NGƯỜI một lượt PATCH** (`allSettled`, khuôn `EmployeeMultiPickerDialog`): 409
 * `payee-no-bank-account` và `payee-already-in-batch` là **ALL-OR-NOTHING cả lượt** ở BE
 * (`:502-513`) ⇒ gộp cả nhóm vào một mảng thì MỘT người xấu chặn tất cả mà không ai biết là ai.
 * Người lỗi giữ lại trong lựa chọn kèm lý do; người đã vào thì cha invalidate ngay.
 *
 * ⚠️ Danh sách «đã có dòng trong đợt» chỉ biết tới TRANG DÒNG hiện tại của cha (cờ `hasLine` là nội bộ
 * BE, không có trong DTO phiếu) ⇒ lọc trước là **tiện nghi**, không phải cổng. Người đã ở đợt KHÁC vẫn
 * lọt qua picker và BE nói bằng 409 `payee-already-in-batch` — chữ lỗi đó đã có sẵn.
 */
export function PaymentBatchAddPayeesDialog({
  batchId,
  payrollPeriodId,
  existingUserIds,
  people,
  onClose,
  onAdded,
}: {
  batchId: string;
  payrollPeriodId: string;
  /** `userId` đã có dòng sống trong đợt — theo trang dòng cha đang hiển thị (xem docblock). */
  existingUserIds: ReadonlySet<string>;
  people: PayrollPeopleLookup;
  onClose: () => void;
  /** Chạy sau MỖI lượt gửi (kể cả thành công một phần) — cha invalidate để bảng dòng hiện ngay. */
  onAdded: () => void;
}) {
  const { t } = useTranslation("payroll");

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<readonly { userId: string; text: string }[]>([]);

  const listParams = useMemo(
    () => ({ payrollPeriodId, page, per_page: PAYROLL_PAGE_SIZE }),
    [payrollPeriodId, page],
  );
  const canListPayslips = useCanExact(
    PAYROLL_ENGINE_PAIRS.payslipList.action,
    PAYROLL_ENGINE_PAIRS.payslipList.resourceType,
  );
  const payslipsQuery = useQuery({
    queryKey: payrollKeys.payslips.list(listParams),
    queryFn: () => payrollApi.listPayslips(listParams),
    enabled: canListPayslips,
    staleTime: 30_000,
  });

  const payslips: readonly PayslipDto[] = payslipsQuery.data?.data ?? [];
  const total = payslipsQuery.data?.pagination?.total;
  const selectableOnPage = payslips.filter((p) => !existingUserIds.has(p.userId));
  const allPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((p) => selected.has(p.userId));
  const totalPages =
    typeof total === "number" ? Math.max(1, Math.ceil(total / PAYROLL_PAGE_SIZE)) : 1;

  const toggleOne = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of selectableOnPage) {
        if (allPageSelected) next.delete(p.userId);
        else next.add(p.userId);
      }
      return next;
    });

  const mutation = useMutation({
    mutationFn: async (userIds: readonly string[]) => {
      const results = await Promise.allSettled(
        userIds.map((userId) => payrollApi.updatePaymentBatch(batchId, { addUserIds: [userId] })),
      );
      return userIds.flatMap((userId, i) => {
        const r = results[i];
        if (r.status !== "rejected") return [];
        return [{ userId, text: payrollErrorText(t, parsePayrollError(r.reason)) }];
      });
    },
    onSuccess: (failed) => {
      onAdded();
      if (failed.length === 0) {
        onClose();
        return;
      }
      // Người lỗi GIỮ LẠI để người dùng thấy ai hỏng và vì sao; người đã vào biến khỏi lựa chọn.
      setSelected(new Set(failed.map((f) => f.userId)));
      setFailures(failed);
    },
    // `mutationFn` bọc `allSettled` nên theo thiết kế KHÔNG ném; nhưng thiếu nhánh này thì một lỗi
    // đồng bộ ngoài dự kiến (lệch chỉ số `results[i]`/`userIds[i]` do sửa sau này) rơi vào im lặng
    // tuyệt đối — hộp không có dải feedback nào khác. Không nuốt lỗi (CLAUDE.md §5).
    onError: (error) => {
      onAdded();
      setFailures([{ userId: "", text: payrollErrorText(t, parsePayrollError(error)) }]);
    },
  });

  const busy = mutation.isPending;

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={t("paymentBatchAddPayees.title")}
      description={t("paymentBatchAddPayees.description")}
      className="max-w-2xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {t("paymentBatchAddPayees.selectedCount", { count: selected.size })}
          </span>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("paymentBatchDetail.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate(Array.from(selected))}
            disabled={busy || selected.size === 0}
            data-testid="add-payees-confirm"
          >
            {t("paymentBatchAddPayees.submit")}
          </Button>
        </>
      }
    >
      {failures.length > 0 && !busy && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>{t("paymentBatchAddPayees.partialError", { count: failures.length })}</p>
          <ul className="list-disc pl-5">
            {failures.map((f) => (
              <li key={f.userId}>
                {/* `userId` rỗng = nhánh lỗi CẢ LƯỢT (onError), không gắn với người nào. */}
                {f.userId === "" ? f.text : `${displayUserRef(f.userId, people)} — ${f.text}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {payslipsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("paymentBatchAddPayees.loadError")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    disabled={busy || selectableOnPage.length === 0}
                    onChange={togglePage}
                    aria-label={t("paymentBatchAddPayees.selectAllPage")}
                    data-testid="add-payees-select-page"
                  />
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("paymentBatchDetail.columns.employee")}
                </th>
              </tr>
            </thead>
            <tbody>
              {payslipsQuery.isLoading && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("states.loading")}
                  </td>
                </tr>
              )}
              {!payslipsQuery.isLoading &&
                payslips.map((p) => {
                  const already = existingUserIds.has(p.userId);
                  return (
                    <tr
                      key={p.id}
                      className={
                        already
                          ? "border-b border-border opacity-60 last:border-0"
                          : "border-b border-border last:border-0 hover:bg-muted/40"
                      }
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={already || selected.has(p.userId)}
                          disabled={already || busy}
                          onChange={() => toggleOne(p.userId)}
                          aria-label={displayUserRef(p.userId, people)}
                          data-testid={`add-payees-row-${p.userId}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {displayUserRef(p.userId, people)}
                          </span>
                          {already && (
                            <Badge variant="muted">
                              {t("paymentBatchAddPayees.alreadyInBatch")}
                            </Badge>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              {!payslipsQuery.isLoading && payslips.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("paymentBatchAddPayees.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {typeof total === "number" && total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t("paymentBatchAddPayees.totalCount", { count: total })}</span>
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              disabled={page <= 1 || busy || payslipsQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("paymentBatchAddPayees.prevPage")}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span>
              {page}/{totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              disabled={page >= totalPages || busy || payslipsQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t("paymentBatchAddPayees.nextPage")}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        </div>
      )}
    </Dialog>
  );
}
