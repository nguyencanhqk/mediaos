import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCanExact } from "@mediaos/web-core";
import { Button, EmptyState, Skeleton } from "@mediaos/ui";
import { candidateFileApi } from "../candidate-file-api";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

const FILE_QUERY_KEY = (candidateId: string) => ["recruit", "candidateFiles", candidateId] as const;

/**
 * REC-SCREEN-003 — tab CV/tài liệu, đi qua bề mặt RECRUIT riêng (`candidate-file-api.ts`).
 *
 * ⚠️ Gate bằng `useCanExact`, KHÔNG `useCan`: cả hai cặp đều `is_sensitive=true`
 * (`view:candidate` mig 0560 · `upload:candidate-file` mig 0569) nên chúng KHÔNG bao giờ được suy ra
 * từ wildcard trong `/auth/me` capabilities — `useCan` (vốn chấp nhận wildcard) sẽ hiện nút cho người
 * mà server chắc chắn từ chối (memory `sensitive-pair-widget-needs-usecanexact`).
 *
 * ĐỌC (danh sách + tải) gác bằng CÙNG cặp gác màn hồ sơ ứng viên — `view:candidate`. GHI (tải lên)
 * gác bằng cặp ghi-tệp riêng, nên `hr` (không có `create`/`update:candidate`) vẫn đính được CV mà
 * KHÔNG bị bỏ mask PII toàn role.
 */
export function CandidateCvTab({ candidateId }: { candidateId: string }) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canView = useCanExact("view", "candidate");
  const canUpload = useCanExact("upload", "candidate-file");

  const filesQuery = useQuery({
    queryKey: FILE_QUERY_KEY(candidateId),
    queryFn: () => candidateFileApi.listCandidateFiles(candidateId),
    enabled: canView,
  });

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * ⚠️ `onError` KHÔNG phải chi tiết UX — nó là điều kiện để luồng này quan sát được.
   *
   * Chuỗi tải lên có BỐN chặng (035 → PUT bytes → 036 → 037) và chặng cuối có một nhánh từ chối
   * **bình thường, dự kiến**: gắn lại một tệp đã từng link trả **403** (vế 5 của
   * `RecruitCandidateFileResolver.canLinkFile`, chống bypass thu hồi). Không có `onError` thì
   * `isPending` chỉ lật về `false`, nút quay lại chữ "Tải CV lên", và người dùng **không có cách nào
   * biết CV chưa đính** — không lỗi, không log, không dấu vết. Dùng chung khuôn hiển thị với
   * `downloadError` bên dưới.
   */
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      setUploadError(null);
      return candidateFileApi.uploadCandidateFile(candidateId, file);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FILE_QUERY_KEY(candidateId) });
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setUploadError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  /**
   * Mở tab TRẮNG NGAY TRONG click handler (đồng bộ, trước `await`) rồi điều hướng nó sau khi có URL —
   * mở `window.open` SAU await bị Safari/Chrome popup-blocker chặn (chỉ coi lệnh gọi trong cùng tick sự
   * kiện click là "user gesture") — mục 6 review-gate.
   */
  const download = async (fileId: string) => {
    setDownloadError(null);
    const w = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await candidateFileApi.getDownloadUrl(candidateId, fileId);
      if (w) w.location.href = url;
    } catch (err) {
      w?.close();
      const info = parseRecruitError(err);
      setDownloadError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    }
  };

  if (!canView) {
    return <EmptyState title={t("cv.noPermission")} />;
  }

  return (
    <div className="space-y-3">
      {(downloadError ?? uploadError) && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {downloadError ?? uploadError}
        </p>
      )}
      {canUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadMutation.isPending ? t("cv.uploading") : t("cv.upload")}
          </Button>
        </>
      )}

      {filesQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (filesQuery.data ?? []).length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("cv.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(filesQuery.data ?? []).map((f) => (
            <li key={f.fileId} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate">{f.originalName}</span>
              {/* Tải = CÙNG cặp `view:candidate` với danh sách (`read-path-gate-pair-must-match-
                  download-pair`) — đã kiểm ở `canView` phía trên, không có cờ thứ hai để lệch. */}
              <Button variant="outline" size="sm" onClick={() => void download(f.fileId)}>
                {t("cv.download")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
