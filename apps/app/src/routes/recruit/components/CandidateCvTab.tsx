import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCan } from "@mediaos/web-core";
import { Button, EmptyState, Skeleton } from "@mediaos/ui";
import { candidateFileApi } from "../candidate-file-api";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

const FILE_QUERY_KEY = (candidateId: string) => ["recruit", "candidateFiles", candidateId] as const;

/**
 * REC-SCREEN-003 — tab CV/tài liệu, đi qua Foundation Files GENERIC (xem `candidate-file-api.ts` cho
 * lý do + nợ seed grant). Gate bằng cặp THẬT BE kiểm ở route (`foundation-file`), KHÔNG phải cặp
 * `candidate` — hai cặp KHÁC NHAU, xem docblock file api.
 */
export function CandidateCvTab({ candidateId }: { candidateId: string }) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canView = useCan("view", "foundation-file");
  const canUpload = useCan("upload", "foundation-file");
  const canDownload = useCan("download", "foundation-file");

  const filesQuery = useQuery({
    queryKey: FILE_QUERY_KEY(candidateId),
    queryFn: () => candidateFileApi.listCandidateFiles(candidateId),
    enabled: canView,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => candidateFileApi.uploadCandidateFile(candidateId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FILE_QUERY_KEY(candidateId) });
    },
  });

  const [downloadError, setDownloadError] = useState<string | null>(null);

  /**
   * Mở tab TRẮNG NGAY TRONG click handler (đồng bộ, trước `await`) rồi điều hướng nó sau khi có URL —
   * mở `window.open` SAU await bị Safari/Chrome popup-blocker chặn (chỉ coi lệnh gọi trong cùng tick sự
   * kiện click là "user gesture") — mục 6 review-gate.
   */
  const download = async (fileId: string) => {
    setDownloadError(null);
    const w = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await candidateFileApi.getDownloadUrl(fileId);
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
      {downloadError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {downloadError}
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
            <li key={f.id} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate">{f.originalName}</span>
              {canDownload && (
                <Button variant="outline" size="sm" onClick={() => void download(f.id)}>
                  {t("cv.download")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t("cv.gapNote")}</p>
    </div>
  );
}
