import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { clearSession, getPasswordSetupCurrentPassword, getStoredUser, getToken, storeSession } from '@/lib/session';
import type { StoredUser } from '@/lib/types';

interface SessionValue {
  token: string | null;
  user: StoredUser | null;
  passwordSetupCurrentPassword: string | null;
  notificationCount: number;
  signIn: (token: string, user: StoredUser, passwordSetupCurrentPassword?: string | null) => void;
  signOut: () => void;
  updateUser: (user: StoredUser) => void;
  setNotificationCount: (count: number) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser());
  const [passwordSetupCurrentPassword, setPasswordSetupCurrentPassword] = useState<string | null>(() => getPasswordSetupCurrentPassword());
  const [notificationCount, setNotificationCount] = useState(0);

  const value = useMemo(
    () => ({
      token,
      user,
      passwordSetupCurrentPassword,
      notificationCount,
      signIn: (nextToken: string, nextUser: StoredUser, nextPasswordSetupCurrentPassword?: string | null) => {
        storeSession(nextToken, nextUser, nextPasswordSetupCurrentPassword ?? null);
        setToken(nextToken);
        setUser(nextUser);
        setPasswordSetupCurrentPassword(nextPasswordSetupCurrentPassword ?? null);
      },
      signOut: () => {
        clearSession();
        setToken(null);
        setUser(null);
        setPasswordSetupCurrentPassword(null);
        setNotificationCount(0);
      },
      updateUser: (nextUser: StoredUser) => {
        if (token) {
          storeSession(token, nextUser, nextUser.password_setup_required ? passwordSetupCurrentPassword : null);
        }
        setUser(nextUser);
        if (!nextUser.password_setup_required) {
          setPasswordSetupCurrentPassword(null);
        }
      },
      setNotificationCount
    }),
    [notificationCount, passwordSetupCurrentPassword, token, user]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Missing session context');
  return value;
}
