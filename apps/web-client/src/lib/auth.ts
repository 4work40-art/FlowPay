export type StoredUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  org_id: string;
  org_name: string;
  plan: string;
  is_platform_admin?: boolean;
};

const TOKEN_KEY = 'sk_token';
const USER_KEY  = 'sk_user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setSession(token: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Обновить только токен (например, после смены пароля сервер выдаёт новый,
// а остальные сессии отзывает).
export function updateToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
