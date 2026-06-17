import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { KpiComponentScores } from "@mediaos/contracts";
import { useAuth } from "../../src/auth/auth-context";
import { errorMessage } from "../../src/api/client";
import { useKpiDefinitions, useOwnKpi } from "../../src/hr/use-kpi";

const COMPONENT_LABELS: Record<keyof KpiComponentScores, string> = {
  tasksDone: "Khối lượng công việc",
  onTimeRate: "Đúng hạn",
  evaluationScore: "Đánh giá chất lượng",
  defectScore: "Ít lỗi",
  firstPassApprovalRate: "Duyệt đạt lần đầu",
};

/**
 * Personal KPI (read-only) — the caller's OWN KPI snapshot for the current month. There is no
 * "list my results" endpoint; the only read route is POST /kpi/compute (read:kpi), so this lists active
 * definitions and computes the OWN result (subjectUserId = self) for the first one. The server gates
 * read:kpi (fail-closed); an employee without it sees a generic permission message (no leak). KPI is
 * reference-only (BR-007) — never money, never pushed to payroll.
 */
export default function KpiScreen() {
  const { user } = useAuth();
  const definitions = useKpiDefinitions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const defs = definitions.data ?? [];
  const activeId = selectedId ?? defs[0]?.id;
  const own = useOwnKpi(activeId, user?.id);

  if (definitions.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (definitions.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Không tải được danh sách KPI.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void definitions.refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (defs.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Chưa có chỉ số KPI nào.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {defs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {defs.map((d) => {
            const active = d.id === activeId;
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedId(d.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {own.isLoading ? (
        <ActivityIndicator style={{ marginTop: 32 }} size="large" />
      ) : own.isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage(own.error)}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void own.refetch()}>
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : own.data ? (
        <View style={styles.card}>
          <Text style={styles.scoreLabel}>Điểm KPI tổng</Text>
          <Text style={styles.score}>{Math.round(own.data.totalScore)}</Text>
          <Text style={styles.reference}>
            {own.data.confirmedAt ? "Đã xác nhận" : "Tham khảo (chưa xác nhận)"}
          </Text>

          <View style={styles.divider} />
          {(Object.keys(COMPONENT_LABELS) as (keyof KpiComponentScores)[]).map((key) => (
            <View key={key} style={styles.componentRow}>
              <Text style={styles.componentLabel}>{COMPONENT_LABELS[key]}</Text>
              <Text style={styles.componentValue}>{Math.round(own.data.components[key])}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  errorText: { fontSize: 15, color: "#dc2626" },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#2563eb", borderRadius: 8 },
  retryText: { color: "#fff", fontWeight: "600" },
  muted: { fontSize: 15, color: "#6b7280", textAlign: "center" },
  chips: { gap: 8, paddingBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#e5e7eb" },
  chipActive: { backgroundColor: "#2563eb" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 20, alignItems: "center" },
  scoreLabel: { fontSize: 13, color: "#6b7280", textTransform: "uppercase" },
  score: { fontSize: 48, fontWeight: "800", color: "#2563eb", marginVertical: 4 },
  reference: { fontSize: 13, color: "#b45309" },
  divider: { height: 1, backgroundColor: "#e5e7eb", alignSelf: "stretch", marginVertical: 16 },
  componentRow: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", paddingVertical: 6 },
  componentLabel: { fontSize: 14, color: "#374151" },
  componentValue: { fontSize: 14, fontWeight: "600", color: "#111827" },
});
