import { createContext, useContext } from 'react';

const PermissionContext = createContext<string[]>([]);

export const PermissionProvider = PermissionContext.Provider;

/** Returns true if the current user has the given permission */
export function usePerm(permission: string): boolean {
  return useContext(PermissionContext).includes(permission);
}

/** Returns the full permissions array */
export function usePermissions(): string[] {
  return useContext(PermissionContext);
}
