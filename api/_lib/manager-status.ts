export type ManagerStatus = 'Manager' | 'Primary Manager' | 'Co-Manager' | 'Unclaimed';
export function managerStatus(coManager: boolean, coManagerCount: number, hasOwner = true): ManagerStatus {
  return coManager ? 'Co-Manager' : !hasOwner ? 'Unclaimed' : coManagerCount > 0 ? 'Primary Manager' : 'Manager';
}
