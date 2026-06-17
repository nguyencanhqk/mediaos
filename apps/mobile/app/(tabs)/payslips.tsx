import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { PayslipDto, PayslipSummaryDto } from "@mediaos/contracts";
import { useOwnPayslips } from "../../src/hr/use-payslip-reauth";
import { PayslipReauthModal } from "../../src/components/payslip-reauth-modal";
import { formatDayMonth, formatMoney } from "../../src/hr/hr-format";

const ENTRY_KIND_LABELS: Record<PayslipSummaryDto["entryKind"], string> = {
  original: "Phiếu gốc",
  adjustment: "Điều chỉnh",
  void: "Đã huỷ",
};

/** Module-level stable separator identity for FlatList. */
const RowSeparator = () => <View style={styles.separator} />;

/**
 * Payslips (own) — "Phiếu lương của tôi". The list is MONEY-FREE (GET /payslips/me/list returns no
 * monetary field). Money is shown ONLY after a password re-auth (PayslipReauthModal → reauthOwn →
 * getOwn direct fetch), and only ever lives in this screen's ephemeral `revealed` state — never cached,
 * never persisted. Revealing a different payslip (or pull-to-refresh) clears the prior reveal so money
 * is not left on screen. BẤT BIẾN #3.
 */
export default function PayslipsScreen() {
  const { data: payslips = [], isLoading, isError, refetch, isRefetching } = useOwnPayslips();
  /** The id we are currently re-authenticating for (drives the modal). */
  const [reauthId, setReauthId] = useState<string | null>(null);
  /** Ephemeral revealed money snapshot — cleared aggressively. */
  const [revealed, setRevealed] = useState<PayslipDto | null>(null);

  function startReveal(id: string) {
    // Clear any previously revealed money before opening a new step-up.
    setRevealed(null);
    setReauthId(id);
  }

  function hideMoney() {
    setRevealed(null);
  }

  function onRefresh() {
    // Don't leave plaintext money on screen across a refresh, and close any open step-up so a
    // mid-refresh reveal can't re-populate stale state.
    setRevealed(null);
    setReauthId(null);
    void refetch();
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Không tải được danh sách phiếu lương.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={payslips}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={RowSeparator}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <PayslipRow
            summary={item}
            revealed={revealed?.id === item.id ? revealed : null}
            onReveal={() => startReveal(item.id)}
            onHide={hideMoney}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Bạn chưa có phiếu lương nào.</Text>}
      />

      <PayslipReauthModal
        payslipId={reauthId}
        onClose={() => setReauthId(null)}
        onRevealed={(detail) => setRevealed(detail)}
      />
    </View>
  );
}

function PayslipRow({
  summary,
  revealed,
  onReveal,
  onHide,
}: {
  summary: PayslipSummaryDto;
  revealed: PayslipDto | null;
  onReveal: () => void;
  onHide: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{ENTRY_KIND_LABELS[summary.entryKind]}</Text>
        <Text style={styles.cardDate}>Tạo {formatDayMonth(summary.createdAt.slice(0, 10))}</Text>
      </View>

      {revealed ? (
        <View style={styles.moneyBlock}>
          <MoneyRow label="Lương cơ bản" value={formatMoney(revealed.baseSalary, revealed.currency)} />
          <MoneyRow label="Phụ cấp" value={formatMoney(revealed.totalAllowances, revealed.currency)} />
          <MoneyRow label="Tổng (gross)" value={formatMoney(revealed.gross, revealed.currency)} />
          <MoneyRow label="Thực nhận (net)" value={formatMoney(revealed.net, revealed.currency)} strong />
          <TouchableOpacity onPress={onHide} accessibilityRole="button" style={styles.hideButton}>
            <Text style={styles.hideText}>Ẩn</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.revealButton} onPress={onReveal} accessibilityRole="button">
          <Text style={styles.revealText}>Xem chi tiết</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={[styles.moneyValue, strong && styles.moneyValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  errorText: { fontSize: 15, color: "#dc2626" },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#2563eb", borderRadius: 8 },
  retryText: { color: "#fff", fontWeight: "600" },
  listContent: { padding: 12, flexGrow: 1 },
  separator: { height: 10 },
  emptyText: { textAlign: "center", color: "#6b7280", marginTop: 48, fontSize: 15 },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 16, gap: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },
  cardDate: { fontSize: 13, color: "#6b7280" },
  revealButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  revealText: { color: "#2563eb", fontWeight: "600" },
  moneyBlock: { gap: 6, backgroundColor: "#f9fafb", borderRadius: 8, padding: 12 },
  moneyRow: { flexDirection: "row", justifyContent: "space-between" },
  moneyLabel: { fontSize: 14, color: "#374151" },
  moneyValue: { fontSize: 14, color: "#111827" },
  moneyValueStrong: { fontWeight: "700", color: "#16a34a" },
  hideButton: { alignSelf: "flex-end", marginTop: 4 },
  hideText: { color: "#6b7280", fontWeight: "600" },
});
