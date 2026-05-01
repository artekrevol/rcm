import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  name: string;
  organization_id: string | null;
  impersonatingOrgId: string | null;
  impersonatingOrgName: string | null;
};

/** Returns the effective org ID for the current user.
 *  - super_admin uses impersonatingOrgId when set
 *  - regular users use their own organization_id
 */
export function useOrgId(user: AuthUser | null): string | null {
  if (!user) return null;
  if (user.role === "super_admin") return user.impersonatingOrgId || null;
  return user.organization_id || null;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn<AuthUser | null>({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
      window.location.href = "/auth/login";
    },
  });

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user && !error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
  };
}
