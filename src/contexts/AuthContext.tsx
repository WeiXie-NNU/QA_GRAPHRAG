import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  getInitialAuthState,
  loginUser,
  logoutUser,
  switchUser as switchStoredUser,
  type AppUser,
} from "../services/authService";

interface AuthContextValue {
  currentUser: AppUser | null;
  users: AppUser[];
  login: (name: string) => AppUser;
  logout: () => void;
  switchUser: (userId: string) => AppUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState(() => getInitialAuthState());

  useEffect(() => {
    const syncFromStorage = () => {
      setAuthState(getInitialAuthState());
    };

    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser: authState.currentUser,
      users: authState.users,
      login: (name: string) => {
        const user = loginUser(name);
        setAuthState(getInitialAuthState());
        return user;
      },
      logout: () => {
        logoutUser();
        setAuthState(getInitialAuthState());
      },
      switchUser: (userId: string) => {
        const user = switchStoredUser(userId);
        setAuthState(getInitialAuthState());
        return user;
      },
    }),
    [authState.currentUser, authState.users],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
