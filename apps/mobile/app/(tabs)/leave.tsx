import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { createLeaveRequestSchema, type LeaveRequestDto } from "@mediaos/contracts";
import { errorMessage } from "../../src/api/client";
import {
  useCreateLeaveRequest,
  useLeaveTypes,
  useMyLeaveRequests,
} from "../../src/hr/use-leave";
import { HR_REQUEST_STATUS_LABELS, formatDayMonth } from "../../src/hr/hr-format";

/** Module-level stable separator identity for FlatList. */
const RowSeparator = () => <View style={styles.separator} />;

/**
 * Leave — list the caller's own requests + create a new one. The create form validates the date range
 * with the shared Zod schema BEFORE any network call (fail-fast). The server gates create:leave and
 * scopes the list to the caller (scope=me default); a denied create surfaces a generic message.
 */
export default function LeaveScreen() {
  const requests = useMyLeaveRequests();
  const types = useLeaveTypes();
  const create = useCreateLeaveRequest();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <FlatList
      style={styles.container}
      data={requests.data ?? []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={RowSeparator}
      refreshControl={
        <RefreshControl refreshing={requests.isRefetching} onRefresh={() => void requests.refetch()} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {formOpen ? (
            <CreateLeaveForm
              leaveTypeId={types.data?.[0]?.id}
              typesLoading={types.isLoading}
              submitting={create.isPending}
              onCancel={() => setFormOpen(false)}
              onSubmit={(payload) =>
                create.mutate(payload, {
                  onSuccess: () => {
                    Alert.alert("Đã gửi đơn", "Đơn nghỉ của bạn đã được gửi để duyệt.");
                    setFormOpen(false);
                  },
                  onError: (err) => Alert.alert("Không gửi được đơn", errorMessage(err)),
                })
              }
            />
          ) : (
            <TouchableOpacity
              style={styles.newButton}
              onPress={() => setFormOpen(true)}
              accessibilityRole="button"
            >
              <Text style={styles.newButtonText}>Tạo đơn nghỉ</Text>
            </TouchableOpacity>
          )}
        </View>
      }
      ListEmptyComponent={
        requests.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <Text style={styles.emptyText}>Bạn chưa có đơn nghỉ nào.</Text>
        )
      }
      renderItem={({ item }) => <LeaveRow request={item} />}
    />
  );
}

function CreateLeaveForm({
  leaveTypeId,
  typesLoading,
  submitting,
  onCancel,
  onSubmit,
}: {
  leaveTypeId: string | undefined;
  typesLoading: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: { leaveTypeId: string; startDate: string; endDate: string; reason?: string }) => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  function handleSubmit() {
    if (typesLoading) {
      Alert.alert("Đang tải", "Đang tải loại nghỉ, vui lòng đợi một lát.");
      return;
    }
    if (!leaveTypeId) {
      Alert.alert("Thiếu loại nghỉ", "Chưa có loại nghỉ nào được cấu hình. Liên hệ HR.");
      return;
    }
    // Validate with the shared schema BEFORE any network call (date range, same-year, etc.).
    const parsed = createLeaveRequestSchema.safeParse({
      leaveTypeId,
      startDate: startDate.trim(),
      endDate: endDate.trim(),
      reason: reason.trim() === "" ? undefined : reason.trim(),
    });
    if (!parsed.success) {
      Alert.alert("Đơn chưa hợp lệ", parsed.error.errors[0]?.message ?? "Vui lòng kiểm tra lại.");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>Đơn nghỉ mới</Text>

      <Text style={styles.label}>Từ ngày</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel="Từ ngày"
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        value={startDate}
        onChangeText={setStartDate}
      />

      <Text style={styles.label}>Đến ngày</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel="Đến ngày"
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        value={endDate}
        onChangeText={setEndDate}
      />

      <Text style={styles.label}>Lý do (tuỳ chọn)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        accessibilityLabel="Lý do"
        placeholder="Lý do nghỉ…"
        value={reason}
        onChangeText={setReason}
        multiline
      />

      <View style={styles.formActions}>
        <TouchableOpacity onPress={onCancel} disabled={submitting} accessibilityRole="button">
          <Text style={styles.cancelText}>Huỷ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.disabled]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityRole="button"
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Gửi đơn</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LeaveRow({ request }: { request: LeaveRequestDto }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{request.leaveTypeName ?? "Đơn nghỉ"}</Text>
        <Text style={styles.rowDates}>
          {formatDayMonth(request.startDate)} – {formatDayMonth(request.endDate)} · {request.totalDays} ngày
        </Text>
      </View>
      <Text style={[styles.badge, statusStyle(request.status)]}>
        {HR_REQUEST_STATUS_LABELS[request.status]}
      </Text>
    </View>
  );
}

function statusStyle(status: LeaveRequestDto["status"]) {
  switch (status) {
    case "approved":
      return styles.badgeApproved;
    case "rejected":
      return styles.badgeRejected;
    case "cancelled":
      return styles.badgeCancelled;
    default:
      return styles.badgePending;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  listContent: { padding: 12, flexGrow: 1 },
  separator: { height: 8 },
  header: { marginBottom: 12 },
  newButton: { backgroundColor: "#2563eb", borderRadius: 8, padding: 14, alignItems: "center" },
  newButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  formCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 6 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 4 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginTop: 6 },
  input: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  formActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 16, marginTop: 12 },
  cancelText: { color: "#6b7280", fontWeight: "600" },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "600" },
  emptyText: { textAlign: "center", color: "#6b7280", marginTop: 32, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 8, padding: 14 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowDates: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  badge: { fontSize: 12, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  badgePending: { backgroundColor: "#fef3c7", color: "#b45309" },
  badgeApproved: { backgroundColor: "#dcfce7", color: "#16a34a" },
  badgeRejected: { backgroundColor: "#fee2e2", color: "#dc2626" },
  badgeCancelled: { backgroundColor: "#e5e7eb", color: "#6b7280" },
  disabled: { opacity: 0.6 },
});
