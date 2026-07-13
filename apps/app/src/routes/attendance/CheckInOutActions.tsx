/**
 * CheckInOutActions — nút Check-in / Check-out + disabled reason.
 * S3-FE-ATT-1:
 *   - Hiển thị nút dựa trên quyền (useCan check-in/check-out:attendance).
 *   - Enabled/disabled theo allowedActions từ server (authoritative — bao gồm leave block).
 *   - Khi mutation thành công/thất bại hiển thị inline feedback.
 *   - KHÔNG hard-code logic leave/rule — server quyết định, client render.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, LogOut, AlertCircle, CheckCircle } from "lucide-react";
import type { AttendanceTodayV2Dto } from "@mediaos/contracts";
import { useCan, showApiErrorToast } from "@mediaos/web-core";
import { Button, Card, CardContent } from "@mediaos/ui";
import { ATT_ENGINE_PAIRS } from "./constants";
import { useCheckIn } from "./hooks/useCheckIn";
import { useCheckOut } from "./hooks/useCheckOut";

// ── Inline feedback ────────────────────────────────────────────────────────────

interface FeedbackBannerProps {
  type: "success" | "error";
  message: string;
}

function FeedbackBanner({ type, message }: FeedbackBannerProps) {
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
        type === "success" ? "bg-success-muted text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {type === "success" ? (
        <CheckCircle className="h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}

// ── Disabled reason ────────────────────────────────────────────────────────────

function DisabledReasonNote({ reason, label }: { reason: string; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <span className="font-medium">{label} </span>
        {reason}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface CheckInOutActionsProps {
  data: AttendanceTodayV2Dto;
}

type FeedbackState = { type: "success" | "error"; message: string } | null;

export function CheckInOutActions({ data }: CheckInOutActionsProps) {
  const { t } = useTranslation("attendance");

  // Permission gates — server là cổng thật; useCan quyết định có HIỂN THỊ nút không.
  const canCheckIn = useCan(
    ATT_ENGINE_PAIRS.CHECK_IN.action,
    ATT_ENGINE_PAIRS.CHECK_IN.resourceType,
  );
  const canCheckOut = useCan(
    ATT_ENGINE_PAIRS.CHECK_OUT.action,
    ATT_ENGINE_PAIRS.CHECK_OUT.resourceType,
  );

  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();

  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const { allowedActions, disabledReason, periodLocked } = data;

  // Nếu kỳ công khoá hoặc không có quyền nào → không render panel
  if (!canCheckIn && !canCheckOut) return null;

  // Nút disabled khi: server chặn (allowedActions) hoặc kỳ công khoá hoặc đang xử lý mutation.
  const isBusy = checkInMutation.isPending || checkOutMutation.isPending;

  const checkInDisabled = !allowedActions.canCheckIn || periodLocked || isBusy;

  const checkOutDisabled = !allowedActions.canCheckOut || periodLocked || isBusy;

  // Server-provided reason để giải thích tại sao không thể check-in/out.
  const reasonToShow =
    !allowedActions.canCheckIn && !allowedActions.canCheckOut ? disabledReason : null;

  async function handleCheckIn() {
    setFeedback(null);
    try {
      await checkInMutation.mutateAsync({
        method: "web",
        clientTime: new Date().toISOString(),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setFeedback({ type: "success", message: t("today.actions.successCheckIn") });
    } catch (err) {
      showApiErrorToast(err);
      setFeedback({ type: "error", message: t("today.actions.errorCheckIn") });
    }
  }

  async function handleCheckOut() {
    setFeedback(null);
    try {
      await checkOutMutation.mutateAsync({
        method: "web",
        clientTime: new Date().toISOString(),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setFeedback({ type: "success", message: t("today.actions.successCheckOut") });
    } catch (err) {
      showApiErrorToast(err);
      setFeedback({ type: "error", message: t("today.actions.errorCheckOut") });
    }
  }

  return (
    <Card data-testid="checkinout-actions">
      <CardContent className="space-y-4 pt-6">
        {/* Disabled reason (khi cả 2 bị block — vd: nghỉ phép cả ngày) */}
        {reasonToShow && (
          <DisabledReasonNote
            reason={reasonToShow}
            label={t("today.actions.disabledReason.label")}
          />
        )}

        {/* Period locked notice */}
        {periodLocked && (
          <DisabledReasonNote
            reason={t("today.periodLocked")}
            label={t("today.actions.disabledReason.label")}
          />
        )}

        {/* Feedback banner */}
        {feedback && <FeedbackBanner type={feedback.type} message={feedback.message} />}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          {canCheckIn && (
            <Button
              size="lg"
              disabled={checkInDisabled}
              onClick={() => void handleCheckIn()}
              data-testid="btn-check-in"
              aria-label={t("today.actions.checkIn")}
              className="flex-1 sm:flex-none"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {isBusy && checkInMutation.isPending
                ? t("today.actions.checking")
                : t("today.actions.checkIn")}
            </Button>
          )}

          {canCheckOut && (
            <Button
              size="lg"
              variant="outline"
              disabled={checkOutDisabled}
              onClick={() => void handleCheckOut()}
              data-testid="btn-check-out"
              aria-label={t("today.actions.checkOut")}
              className="flex-1 sm:flex-none"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {isBusy && checkOutMutation.isPending
                ? t("today.actions.checking")
                : t("today.actions.checkOut")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
