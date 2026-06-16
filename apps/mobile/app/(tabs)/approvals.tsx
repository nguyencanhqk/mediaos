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
import { router } from "expo-router";
import type { ApprovalRequestDto } from "@mediaos/contracts";
import { useApprovalRequests, useApprove } from "../../src/tasks/use-workflow";
import { errorMessage } from "../../src/api/client";

/**
 * Approval inbox — GET /workflow/approval-requests returns ONLY the requests the caller may act on
 * (server scopes by reviewer identity). So a non-reviewer simply sees the empty state and no
 * Approve / Revision controls render: the gating is server-driven, not a client capability guess.
 * The server still re-enforces the reviewer on every approve/request-revision call.
 */
/** Module-level so FlatList keeps a stable separator identity across renders. */
const CardSeparator = () => <View style={styles.separator} />;

export default function ApprovalsScreen() {
  const { data: requests = [], isLoading, isError, refetch, isRefetching } = useApprovalRequests();

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
        <Text style={styles.errorText}>Không tải được danh sách chờ duyệt.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={requests}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={CardSeparator}
      renderItem={({ item }) => <ApprovalCard request={item} />}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      ListEmptyComponent={<Text style={styles.emptyText}>Không có việc nào chờ bạn duyệt.</Text>}
    />
  );
}

function ApprovalCard({ request }: { request: ApprovalRequestDto }) {
  const approve = useApprove(request.id);

  function handleApprove() {
    approve.mutate(
      { comment: null },
      {
        onError: (err) => Alert.alert("Không thể duyệt", errorMessage(err)),
        onSuccess: () => Alert.alert("Đã duyệt", "Bước đã được duyệt."),
      },
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Yêu cầu duyệt</Text>
      <Text style={styles.cardMeta}>
        Cấp {request.currentLevel}/{request.maxLevel}
      </Text>
      {request.comment ? <Text style={styles.cardComment}>“{request.comment}”</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.approveButton, approve.isPending && styles.disabled]}
          onPress={handleApprove}
          disabled={approve.isPending}
          accessibilityRole="button"
        >
          {approve.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.approveText}>Duyệt</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.revisionButton]}
          onPress={() => router.push(`/revision/${request.id}`)}
          disabled={approve.isPending}
          accessibilityRole="button"
        >
          <Text style={styles.revisionText}>Trả sửa</Text>
        </TouchableOpacity>
      </View>
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
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 16, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },
  cardMeta: { fontSize: 13, color: "#6b7280" },
  cardComment: { fontSize: 14, color: "#374151", fontStyle: "italic" },
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  approveButton: { backgroundColor: "#16a34a" },
  approveText: { color: "#fff", fontWeight: "600" },
  revisionButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ea580c" },
  revisionText: { color: "#ea580c", fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
