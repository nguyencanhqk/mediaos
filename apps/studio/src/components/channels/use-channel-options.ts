import { useQuery } from "@tanstack/react-query";
import { employeesApi } from "@/lib/employees-api";
import { orgApi } from "@/lib/org-api";

/**
 * Danh sách nhân sự (active) cho dropdown manager/member.
 * Dùng key ["employees"] khớp EmployeesPage → react-query dedupe cache.
 */
export function useEmployeeOptions() {
  const { data = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeesApi.listEmployees({ status: "active" }),
  });
  return data;
}

/** Danh sách team cho dropdown "team phụ trách" — key khớp TeamsPage. */
export function useTeamOptions() {
  const { data = [] } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: () => orgApi.listTeams(),
  });
  return data;
}
