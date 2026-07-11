// ─── FIX #6 #7: прямой URL к API, без прокси/rewrite ───────
// NEXT_PUBLIC_API_URL устанавливается в docker-compose как http://localhost:3001/api/v1
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sk_token');
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url   = `${BASE}${path}`;
  const token = getStoredToken();
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
  } catch (e: any) {
    throw new Error(`Сеть недоступна (${url}): ${e.message}`);
  }

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    localStorage.removeItem('sk_token');
    localStorage.removeItem('sk_user');
    window.location.href = '/login';
    throw new Error('Сессия истекла, войдите заново');
  }

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ─── FIX #5: объект api с нужными методами ───────────────
export const api = {
  auth: {
    login:  (email: string, password: string) =>
      req('/auth/login', { method:'POST', body:JSON.stringify({ email, password }) }),
    logout: () =>
      req('/auth/logout', { method:'POST' }),
  },

  dashboard: {
    summary: (org_id?: string) =>
      req(`/dashboard${org_id ? `?org_id=${org_id}` : ''}`),
  },

  invoices: {
    list: (params: Record<string, string> = {}) =>
      req(`/invoices?${new URLSearchParams(params)}`),
    get: (id: string) =>
      req(`/invoices/${id}`),
    create: (body: {
      amount_kopecks: number;
      number?: string;
      counterparty_id?: string;
      due_date?: string;
      notes?: string;
    }) => req('/invoices', { method:'POST', body:JSON.stringify(body) }),
    transition: (id: string, transition: string, reason?: string) =>
      req(`/invoices/${id}/state`, { method:'PATCH', body:JSON.stringify({ transition, reason }) }),
  },

  payments: {
    list: (params: Record<string, string> = {}) =>
      req(`/payments?${new URLSearchParams(params)}`),
    create: (body: {
      invoice_id: string;
      amount_kopecks: number;
      method?: string;
      reference?: string;
      payment_date?: string;
    }) => req('/payments', { method:'POST', body:JSON.stringify(body) }),
  },

  counterparties: {
    list: () => req('/counterparties'),
    create: (body: { name: string; inn?: string; kpp?: string; phone?: string; email?: string; address?: string; type?: string }) =>
      req('/counterparties', { method:'POST', body:JSON.stringify(body) }),
    update: (id: string, body: Record<string, any>) =>
      req(`/counterparties/${id}`, { method:'PATCH', body:JSON.stringify(body) }),
  },

  users: {
    me: () => req('/users/me'),
    list: () => req('/users'),
    changePassword: (current_password: string, new_password: string) =>
      req('/users/me/password', { method:'PATCH', body:JSON.stringify({ current_password, new_password }) }),
  },

  admin: {
    overview: () => req('/admin/overview'),
    organizations: () => req('/admin/organizations'),
  },

  audit: {
    logs: (params: Record<string, string> = {}) =>
      req(`/audit/logs?${new URLSearchParams(params)}`),
  },
};

// ─── Форматирование суммы (P5: разделители) ───────────────
export function fmt(kopecks: number | string | null | undefined): string {
  const n = Math.round(Number(kopecks ?? 0)) / 100;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
}

// ─── Статусы счетов ────────────────────────────────────────
export const STATUS_LABEL: Record<string, string> = {
  CREATED:         'Создан',
  UNDER_CONTROL:   'На контроле',
  PAYMENT_PENDING: 'Ожидает',
  PARTIALLY_PAID:  'Частично',
  PAID:            'Оплачен',
  OVERDUE:         'Просрочен',
  DISPUTED:        'Спор',
  ARCHIVED:        'Архив',
  WRITTEN_OFF:     'Списан',
};

// P5: оранжевый для просрочки, НЕ красный
export const STATUS_COLOR: Record<string, string> = {
  PAID:            'bg-emerald-50 text-emerald-800 border border-emerald-200',
  PARTIALLY_PAID:  'bg-blue-50   text-blue-800   border border-blue-200',
  OVERDUE:         'bg-amber-50  text-amber-800  border border-amber-200',
  UNDER_CONTROL:   'bg-purple-50 text-purple-800 border border-purple-200',
  PAYMENT_PENDING: 'bg-blue-50   text-blue-700   border border-blue-200',
  CREATED:         'bg-gray-100  text-gray-700   border border-gray-200',
  DISPUTED:        'bg-red-50    text-red-700    border border-red-200',
  ARCHIVED:        'bg-gray-100  text-gray-500   border border-gray-200',
  WRITTEN_OFF:     'bg-gray-100  text-gray-500   border border-gray-200',
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', accountant: 'Бухгалтер', vendor_admin: 'Vendor Admin', readonly: 'Read only',
};

export const STATUS_ICON: Record<string, string> = {
  PAID:            '✓',
  PARTIALLY_PAID:  '%',
  OVERDUE:         '⏰',
  UNDER_CONTROL:   '👁',
  PAYMENT_PENDING: '⏳',
  CREATED:         '📄',
  DISPUTED:        '⚠',
  ARCHIVED:        '📦',
  WRITTEN_OFF:     '✗',
};
