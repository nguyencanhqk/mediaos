import React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { AttendanceRecordDto } from "@mediaos/contracts";
import { errorMessage } from "../../src/api/client";
import {
  useAttendanceMonth,
  useAttendanceToday,
  useCheckIn,
  useCheckOut,
} from "../../src/hr/use-attendance";
import { ATTENDANCE_STATUS_LABELS, formatDayMonth, formatTime } from "../../src/hr/hr-format";

/** Module-level stable separator identity for FlatList. */
const RowSeparator = () => <View style={styles.separator} />;

/**
 * Attendance — self-service check-in/out + this month's history. Check-in/out always send
 * method=mobile. The server gates check-in/check-out:attendance (fail-closed) and scopes the list to
 * the caller (RLS); a denied action surfaces a generic message (no leak).
 */
export default function AttendanceScreen() {
  const today = useAttendanceToday();
  const month = useAttendanceMonth();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();

  const record = today.data?.record ?? null;
  const hasCheckedIn = Boolean(record?.checkInAt);
  const hasCheckedOut = Boolean(record?.checkOutAt);
  const busy = checkIn.isPending || checkOut.isPending;

  function doCheckIn() {
    checkIn.mutate(
      { method: "mobile" },
      {
        onSuccess: () => Alert.alert("Đã chấm công vào", "Chúc bạn một ngày làm việc hiệu quả."),
        onError: (err) => Alert.alert("Không chấm công được", errorMessage(err)),
      },
    );
  }

  function doCheckOut() {
    checkOut.mutate(
      { method: "mobile" },
      {
        onSuccess: () => Alert.alert("Đã chấm công ra", "Hẹn gặp lại bạn."),
        onError: (err) => Alert.alert("Không chấm công được", errorMessage(err)),
      },
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={month.data ?? []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={RowSeparator}
      refreshControl={
        <RefreshControl
          refreshing={month.isRefetching || today.isRefetching}
          onRefresh={() => {
            void today.refetch();
            void month.refetch();
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Hôm nay</Text>
          {today.isLoading ? (
            <ActivityIndicator />
          ) : (
            <>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Giờ vào</Text>
                <Text style={styles.statusValue}>{formatTime(record?.checkInAt ?? null)}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Giờ ra</Text>
                <Text style={styles.statusValue}>{formatTime(record?.checkOutAt ?? null)}</Text>
              </View>

              {today.data?.periodLocked ? (
                <Text style={styles.locked}>Kỳ công đã khoá — không thể chấm công.</Text>
              ) : !hasCheckedIn ? (
                <ActionButton label="Chấm công vào" busy={busy} onPress={doCheckIn} />
              ) : !hasCheckedOut ? (
                <ActionButton label="Chấm công ra" busy={busy} onPress={doCheckOut} />
              ) : (
                <Text style={styles.done}>Bạn đã hoàn tất chấm công hôm nay.</Text>
              )}
            </>
          )}
        </View>
      }
      ListEmptyComponent={
        month.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <Text style={styles.emptyText}>Chưa có dữ liệu chấm công tháng này.</Text>
        )
      }
      renderItem={({ item }) => <HistoryRow record={item} />}
    />
  );
}

function ActionButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.primaryButton, busy && styles.disabled]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function HistoryRow({ record }: { record: AttendanceRecordDto }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowDate}>{formatDayMonth(record.workDate)}</Text>
      <View style={styles.rowTimes}>
        <Text style={styles.rowTime}>
          {formatTime(record.checkInAt)} → {formatTime(record.checkOutAt)}
        </Text>
        <Text style={styles.rowStatus}>{ATTENDANCE_STATUS_LABELS[record.status]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  listContent: { padding: 12, flexGrow: 1 },
  separator: { height: 8 },
  headerCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 8, marginBottom: 12 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  statusLabel: { fontSize: 14, color: "#6b7280" },
  statusValue: { fontSize: 15, fontWeight: "600", color: "#111827" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  locked: { marginTop: 8, color: "#b45309", fontSize: 13 },
  done: { marginTop: 8, color: "#16a34a", fontSize: 14, fontWeight: "600" },
  emptyText: { textAlign: "center", color: "#6b7280", marginTop: 32, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    gap: 12,
  },
  rowDate: { fontSize: 15, fontWeight: "700", color: "#111827", width: 56 },
  rowTimes: { flex: 1 },
  rowTime: { fontSize: 14, color: "#374151" },
  rowStatus: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  disabled: { opacity: 0.6 },
});
