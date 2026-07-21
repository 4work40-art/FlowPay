// ─── FIX #6 #7: прямой URL к API, без прокси/rewrite ───────
// NEXT_PUBLIC_API_URL устанавливается в docker-compose как http://localhost:3001/api/v1
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

// Позиция счёта (товар/услуга) — учёт купленного: количество, цена за
// единицу; сумма позиции всегда пересчитывается на сервере.
export type InvoiceItemInput = { name: string; quantity: number; unit?: string; unit_price_kopecks: number };

// Строка распознанного реестра счетов (POST /documents/recognize-register)
export type RegisterRow = {
  row: number;
  number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_kopecks: number | null;
  counterparty_name: string | null;
  counterparty_inn: string | null;
  notes: string | null;
  warnings: string[];
};

// Элемент массового создания счетов (POST /invoices/bulk)
export type BulkInvoiceItem = {
  number?: string;
  amount_kopecks: number;
  counterparty_id?: string;
  counterparty_name?: string;
  counterparty_inn?: string;
  due_date?: string;
  invoice_date?: string;
  notes?: string;
};

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
    const e = new Error(msg) as Error & { code?: string };
    e.code = data?.error?.code;
    throw e;
  }
  return data;
}

// ─── FIX #5: объект api с нужными методами ───────────────
export const api = {
  public: {
    invoice: (id: string) => req(`/public/invoices/${id}`),
  },

  auth: {
    login:  (email: string, password: string) =>
      req('/auth/login', { method:'POST', body:JSON.stringify({ email, password }) }),
    register: (body: { org_name: string; email: string; password: string; name?: string; consent: boolean }) =>
      req('/auth/register', { method:'POST', body:JSON.stringify(body) }),
    logout: () =>
      req('/auth/logout', { method:'POST' }),
    forgotPassword: (email: string) =>
      req('/auth/forgot-password', { method:'POST', body:JSON.stringify({ email }) }),
    resetPassword: (token: string, new_password: string) =>
      req('/auth/reset-password', { method:'POST', body:JSON.stringify({ token, new_password }) }),
    inviteInfo: (token: string) => req(`/auth/invite/${token}`),
    acceptInvite: (body: { token: string; name?: string; password: string; consent: boolean }) =>
      req('/auth/accept-invite', { method:'POST', body:JSON.stringify(body) }),
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
      invoice_date?: string;
      notes?: string;
      items?: InvoiceItemInput[];
    }) => req('/invoices', { method:'POST', body:JSON.stringify(body) }),
    transition: (id: string, transition: string, reason?: string) =>
      req(`/invoices/${id}/state`, { method:'PATCH', body:JSON.stringify({ transition, reason }) }),
    setPublic: (id: string, enabled: boolean) =>
      req(`/invoices/${id}/public`, { method:'PATCH', body:JSON.stringify({ enabled }) }),
    addItem: (invoiceId: string, item: InvoiceItemInput) =>
      req(`/invoices/${invoiceId}/items`, { method:'POST', body:JSON.stringify(item) }),
    deleteItem: (invoiceId: string, itemId: string) =>
      req(`/invoices/${invoiceId}/items/${itemId}`, { method:'DELETE' }),
    // Массовое создание счетов из проверенного пользователем реестра.
    bulkCreate: (items: BulkInvoiceItem[]): Promise<{
      success: true;
      data: {
        created: { row: number; invoice_id: string; number: string }[];
        failed: { row: number; reason: string }[];
      };
    }> => req('/invoices/bulk', { method:'POST', body:JSON.stringify({ items }) }),
  },

  documents: {
    // Распознавание счёта/платёжки из файла (PDF/JPG/PNG) — возвращает
    // черновик полей для проверки, ничего не сохраняет само по себе.
    recognize: async (file: File) => {
      const token = getStoredToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/documents/recognize'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      return data;
    },
    // Распознавание реестра счетов (xlsx/xls/csv, выгрузка из 1С/МойСклад/СБИС) —
    // возвращает построчный черновик для проверки перед массовым созданием счетов.
    recognizeRegister: async (file: File): Promise<{
      success: true;
      data: {
        items: RegisterRow[];
        total_rows: number;
        parsed_rows: number;
        warning_rows: number;
      };
    }> => {
      const token = getStoredToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/documents/recognize-register'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      return data;
    },
    list: (invoiceId: string) => req(`/invoices/${invoiceId}/documents`),
    upload: async (invoiceId: string, file: File) => {
      const token = getStoredToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl(`/invoices/${invoiceId}/documents`), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      return data;
    },
    // /download требует Bearer-токен, поэтому обычная <a href> не подходит —
    // качаем как blob и открываем через временный object URL.
    download: async (documentId: string, filename: string) => {
      const token = getStoredToken();
      const res = await fetch(apiUrl(`/documents/${documentId}/download`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
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
      force?: boolean;
    }) => req('/payments', { method:'POST', body:JSON.stringify(body) }),
    importBankStatement: async (file: File) => {
      const token = getStoredToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/payments/bank-import'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      return data;
    },
  },

  counterparties: {
    list: () => req('/counterparties'),
    suggest: (inn: string) => req(`/counterparties/suggest?inn=${encodeURIComponent(inn)}`),
    create: (body: {
      name: string; inn?: string; kpp?: string; phone?: string; email?: string; address?: string; type?: string;
      ogrn?: string; bank_account?: string; bank_name?: string; bank_bik?: string; bank_corr_account?: string;
    }) => req('/counterparties', { method:'POST', body:JSON.stringify(body) }),
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
    organization: (id: string) => req(`/admin/organizations/${id}`),
    updateOrganization: (id: string, body: { plan?: string; invoice_limit?: number; is_active?: boolean; reason: string }) =>
      req(`/admin/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    engagement: () => req('/admin/engagement'),
    revenueEvents: () => req('/admin/revenue-events'),
    createRevenueEvent: (body: { org_id: string; amount_kopecks: number; plan?: string; occurred_at?: string; note?: string }) =>
      req('/admin/revenue-events', { method: 'POST', body: JSON.stringify(body) }),
  },

  organization: {
    me: () => req('/organizations/me'),
    update: (body: { name?: string; inn?: string; kpp?: string }) =>
      req('/organizations/me', { method:'PATCH', body:JSON.stringify(body) }),
    deleteMe: (password: string) =>
      req('/organizations/me', { method:'DELETE', body:JSON.stringify({ password }) }),
    fetchLogoBlobUrl: async (): Promise<string | null> => {
      const token = getStoredToken();
      const res = await fetch(apiUrl('/organizations/me/logo'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    uploadLogo: async (file: File) => {
      const token = getStoredToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/organizations/me/logo'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      return data;
    },
    invites: {
      list: () => req('/organizations/invites'),
      create: (body: { email: string; role: string }) =>
        req('/organizations/invites', { method:'POST', body:JSON.stringify(body) }),
      revoke: (id: string) =>
        req(`/organizations/invites/${id}/revoke`, { method:'POST' }),
    },
  },

  billing: {
    plans: () => req('/billing/plans'),
    subscription: () => req('/billing/subscription'),
    checkout: (plan: string) =>
      req('/billing/checkout', { method:'POST', body:JSON.stringify({ plan }) }),
    cancel: () =>
      req('/billing/cancel', { method:'POST' }),
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

// ─── Форматирование даты (DATE-поля БД: payment_date, due_date,
// invoice_date) — ДД.ММ.ГГГГ. Разбираем строку напрямую, не через
// new Date().toLocaleDateString(): БД отдаёт такие поля в JSON как
// "2026-07-13T00:00:00.000Z" (полночь UTC), и создание Date из этой строки
// с последующим переводом в локальную таймзону браузера может сдвинуть
// дату на день назад в западных часовых поясах — сама по себе дата не
// привязана к времени суток, поэтому просто берём ГГГГ-ММ-ДД из начала строки.
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(value);
  return `${m[3]}.${m[2]}.${m[1]}`;
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

export const STATUS_DESCRIPTION: Record<string, string> = {
  CREATED:         'Счёт создан, но ещё не поставлен на контроль',
  UNDER_CONTROL:   'Вы следите за этим счётом, ждёте наступления срока оплаты',
  PAYMENT_PENDING: 'Срок подошёл, оплата ожидается',
  PARTIALLY_PAID:  'Оплачена часть суммы, есть остаток к оплате',
  PAID:            'Счёт полностью оплачен',
  OVERDUE:         'Срок оплаты прошёл, а долг не погашен',
  DISPUTED:        'По счёту открыт спор — сумма или факт оплаты оспаривается',
  ARCHIVED:        'Счёт оплачен и убран из активного списка',
  WRITTEN_OFF:     'Долг списан — оплата не ожидается',
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
  owner: 'Владелец', accountant: 'Бухгалтер', vendor_admin: 'Администратор поставщика', readonly: 'Только чтение',
};

export const PLAN_LABEL: Record<string, string> = {
  free: 'Бесплатный', pro: 'Профессиональный', business: 'Бизнес', enterprise: 'Корпоративный',
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
