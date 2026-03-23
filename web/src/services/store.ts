// src/services/store.ts
import { create } from 'zustand';
import { api } from './api';

interface AuthState {
  token: string | null;
  user: { id: number; username: string; role: string } | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: localStorage.getItem('token'),
  user: null,
  loading: true,

  login: async (username, password) => {
    const res = await api.login(username, password);
    if (res.ok) {
      localStorage.setItem('token', res.data.token);
      set({ token: res.data.token, user: res.data.user });
    } else {
      throw new Error(res.msg || '登录失败');
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ loading: false });
      return false;
    }
    try {
      const res = await api.getProfile();
      if (res.ok) {
        set({ user: res.data, token, loading: false });
        return true;
      }
    } catch {
      localStorage.removeItem('token');
    }
    set({ loading: false, token: null, user: null });
    return false;
  },
}));
