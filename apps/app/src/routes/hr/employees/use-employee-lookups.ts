/**
 * S2-FE-HR-2 — fetch the four EmployeeForm dropdown lookups.
 *
 * department (read:department) and position (read:position) load whenever the form is shown.
 * job-level / contract-type are gated by `manage:master-data` on the BE — we only fire those queries
 * when the caller holds that capability, so a creator without it sees those two dropdowns disabled
 * instead of a 403 in the console.
 */
import { useQuery } from "@tanstack/react-query";
import { hrApi, hrKeys, useCan } from "@mediaos/web-core";
import type {
  HrDepartmentLookup,
  HrPositionLookup,
  HrJobLevelLookup,
  HrContractTypeLookup,
} from "@mediaos/contracts";
import { HR_ENGINE_PAIRS } from "../constants";

const LOOKUP_STALE_TIME = 5 * 60 * 1000;

export interface EmployeeLookups {
  departments: HrDepartmentLookup[];
  positions: HrPositionLookup[];
  jobLevels: HrJobLevelLookup[];
  contractTypes: HrContractTypeLookup[];
  canManageMasterData: boolean;
}

export function useEmployeeLookups(): EmployeeLookups {
  const canManageMasterData = useCan(
    HR_ENGINE_PAIRS.MANAGE_MASTER_DATA.action,
    HR_ENGINE_PAIRS.MANAGE_MASTER_DATA.resourceType,
  );

  const departments = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: LOOKUP_STALE_TIME,
  });

  const positions = useQuery({
    queryKey: hrKeys.positions.list(),
    queryFn: () => hrApi.listPositions(),
    staleTime: LOOKUP_STALE_TIME,
  });

  const jobLevels = useQuery({
    queryKey: hrKeys.jobLevels.list(),
    queryFn: () => hrApi.listJobLevels(),
    staleTime: LOOKUP_STALE_TIME,
    enabled: canManageMasterData,
  });

  const contractTypes = useQuery({
    queryKey: hrKeys.contractTypes.list(),
    queryFn: () => hrApi.listContractTypes(),
    staleTime: LOOKUP_STALE_TIME,
    enabled: canManageMasterData,
  });

  return {
    departments: departments.data ?? [],
    positions: positions.data ?? [],
    jobLevels: jobLevels.data ?? [],
    contractTypes: contractTypes.data ?? [],
    canManageMasterData,
  };
}
