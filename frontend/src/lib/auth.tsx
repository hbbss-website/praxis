import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getPasswordSetupCurrentPassword, clearPasswordSetupCurrentPassword, storePasswordSetupCurrentPassword } from '@/lib/session';
import type { StoredUser } from '@/lib/types';
import { createApiClient, unwrapResponse, ApiResponseError } from '@/lib/api';

interface SessionValue {
  user: StoredUser | null;
  loading: boolean;
  passwordSetupCurrentPassword: string | null;
  notificationCount: number;
  signIn: (user: StoredUser, passwordSetupCurrentPassword?: string | null) => void;
  signOut: () => void;
  updateUser: (user: StoredUser) => void;
  setNotificationCount: (count: number) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordSetupCurrentPassword, setPasswordSetupCurrentPasswordState] = useState<string | null>(() => getPasswordSetupCurrentPassword());
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    const api = createApiClient();
    api.auth.me.get()
      .then(async (response) => {
        if (response.status === 200 && response.data) {
          const data = response.data as { user: StoredUser };
          setUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback((nextUser: StoredUser, nextPasswordSetupCurrentPassword?: string | null) => {
    setUser(nextUser);
    if (nextPasswordSetupCurrentPassword) {
      storePasswordSetupCurrentPassword(nextPasswordSetupCurrentPassword);
      setPasswordSetupCurrentPasswordState(nextPasswordSetupCurrentPassword);
    } else {
      clearPasswordSetupCurrentPassword();
      setPasswordSetupCurrentPasswordState(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await createApiClient().auth.logout.post();
    } catch {}
    clearPasswordSetupCurrentPassword();
    setUser(null);
    setPasswordSetupCurrentPasswordState(null);
    setNotificationCount(0);
  }, []);

  const updateUser = useCallback((nextUser: StoredUser) => {
    setUser(nextUser);
    if (!nextUser.password_setup_required) {
      clearPasswordSetupCurrentPassword();
      setPasswordSetupCurrentPasswordState(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      passwordSetupCurrentPassword,
      notificationCount,
      signIn,
      signOut,
      updateUser,
      setNotificationCount
    }),
    [user, loading, passwordSetupCurrentPassword, notificationCount, signIn, signOut, updateUser]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Missing session context');
  return value;
}
