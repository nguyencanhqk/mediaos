import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/auth/auth-context";
import { useMyTasks } from "../../src/tasks/use-tasks";
import { summarizeTasks } from "../../src/tasks/task-date";

/**
 * Home — personal overview: greeting, a "việc cần làm" summary (open / due today / overdue) computed
 * from the caller's own tasks, and quick links into My Tasks and Approvals.
 */
export default function HomeScreen() {
  const { user, logout } = useAuth();
  const { data: tasks = [], isLoading } = useMyTasks();
  const summary = summarizeTasks(tasks);

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/login");
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Xin chào{user?.fullName ? `, ${user.fullName}` : ""}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.summaryRow}>
        <SummaryCard label="Đang mở" value={summary.open} loading={isLoading} accent="#2563eb" />
        <SummaryCard label="Hôm nay" value={summary.dueToday} loading={isLoading} accent="#b45309" />
        <SummaryCard label="Quá hạn" value={summary.overdue} loading={isLoading} accent="#dc2626" />
      </View>

      <Text style={styles.sectionTitle}>Truy cập nhanh</Text>
      <QuickLink label="Việc của tôi" hint="Danh sách công việc được giao" onPress={() => router.push("/(tabs)/tasks")} />
      <QuickLink label="Chờ duyệt" hint="Việc cần bạn duyệt" onPress={() => router.push("/(tabs)/approvals")} />

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SummaryCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: number;
  loading: boolean;
  accent: string;
}) {
  return (
    <View style={styles.summaryCard}>
      {loading ? (
        <ActivityIndicator color={accent} />
      ) : (
        <Text style={[styles.summaryValue, { color: accent }]}>{value}</Text>
      )}
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function QuickLink({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickLink} onPress={onPress} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={styles.quickLinkLabel}>{label}</Text>
        <Text style={styles.quickLinkHint}>{hint}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 20, gap: 12 },
  greeting: { fontSize: 22, fontWeight: "700", color: "#111827" },
  email: { fontSize: 14, color: "#6b7280", marginBottom: 8 },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    gap: 4,
    elevation: 1,
  },
  summaryValue: { fontSize: 26, fontWeight: "700" },
  summaryLabel: { fontSize: 12, color: "#6b7280" },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#6b7280", marginTop: 12, textTransform: "uppercase" },
  quickLink: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
  },
  quickLinkLabel: { fontSize: 16, fontWeight: "600", color: "#111827" },
  quickLinkHint: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  chevron: { fontSize: 24, color: "#9ca3af" },
  logoutButton: { marginTop: 24, padding: 14, alignItems: "center" },
  logoutText: { color: "#dc2626", fontWeight: "600", fontSize: 15 },
});
