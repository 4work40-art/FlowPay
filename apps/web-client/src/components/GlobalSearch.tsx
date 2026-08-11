'use client';
// Глобальный поиск (⌘K) — заявлен в ТЗ v4.1 как P0/P1, висел в открытом
// дизайн-долге (см. ROADMAP.md) до этой реализации. Только клиентский
// кабинет — не подключается в /admin/* (см. AppShell.tsx, где этот
// компонент рендерится рядом с проверкой isPlatformAdminArea).
//
// Архитектура: debounce ~300мс + параллельный запрос к 4 существующим
// list-эндпоинтам с новым `?q=` (ILIKE на бэкенде, см. routes/invoices.js,
// outgoingInvoices.js, counterparties.js, payments.js) — не клиентская
// фильтрация уже загруженных данных, потому что у организации может быть
// много сотен счетов/платежей и подгружать их все заранее ради поиска
// нецелесообразно; сервер и так уже пагинирует эти списки.
//
// Компонент сам владеет своим open-состоянием и рендерит и видимую кнопку
// «⌘K» (для рельса), и модалку поиска рядом — модалка позиционируется
// fixed, так что физическое место рендера кнопки в дереве не важно для
// расположения модалки на экране.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search, FileText, Send, Users, CreditCard, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

type ResultItem = {
  id: string;
  href: string;
  title: string;
  subtitle: string;
};

type ResultGroup = {
  key: 'invoices' | 'outgoingInvoices' | 'counterparties' | 'payments';
  label: string;
  icon: typeof FileText;
  items: ResultItem[];
};

const EMPTY_GROUPS: ResultGroup[] = [];

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ResultGroup[]>(EMPTY_GROUPS);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // Модалка рендерится через портал в document.body (см. ниже) — рельс
  // .fp-rail использует backdrop-filter, который по спецификации CSS создаёт
  // containing block для потомков с position:fixed. Без портала оверлей
  // поиска был бы зажат внутри 88px рельса вместо полноэкранного оверлея.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Плоский список результатов в порядке отображения — нужен для навигации
  // стрелками единым индексом через границы групп.
  const flatItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setGroups(EMPTY_GROUPS);
    setActiveIndex(0);
  }, []);

  // Глобальный слушатель ⌘K/Ctrl+K — работает с любого клиентского экрана,
  // даже если фокус сейчас не в поиске.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(o => {
          if (o) { close(); return false; }
          return o;
        });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  // Фокус на поле ввода при открытии.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Фокус-ловушка: пока модалка открыта, Tab не должен утекать за её
  // пределы. Оборачиваем фокус на первом/последнем фокусируемом элементе.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Debounced параллельный запрос к нескольким list-эндпоинтам с ?q=.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups(EMPTY_GROUPS);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeq.current;
      try {
        const [invRes, outRes, cpRes, payRes] = await Promise.all([
          api.invoices.list({ q: trimmed, limit: '5' }).catch(() => null),
          api.outgoingInvoices.list({ q: trimmed, limit: '5' }).catch(() => null),
          api.counterparties.list({ q: trimmed }).catch(() => null),
          api.payments.list({ q: trimmed, limit: '5' }).catch(() => null),
        ]);
        if (seq !== requestSeq.current) return; // устаревший ответ — игнорируем

        const nextGroups: ResultGroup[] = [];

        const invItems = (invRes?.data?.items ?? []).slice(0, 5).map((i: any): ResultItem => ({
          id: i.id,
          href: `/invoices/${i.id}`,
          title: `Счёт №${i.number}`,
          subtitle: `${i.counterparty_name ?? 'Без контрагента'} · ${i.amount_display ?? ''}`,
        }));
        if (invItems.length) nextGroups.push({ key: 'invoices', label: 'Счета', icon: FileText, items: invItems });

        const outItems = (outRes?.data?.items ?? []).slice(0, 5).map((i: any): ResultItem => ({
          id: i.id,
          href: `/outgoing-invoices/${i.id}`,
          title: `Счёт №${i.number}`,
          subtitle: `${i.counterparty_name ?? 'Без контрагента'} · ${i.amount_display ?? ''}`,
        }));
        if (outItems.length) nextGroups.push({ key: 'outgoingInvoices', label: 'Выставленные счета', icon: Send, items: outItems });

        const cpItems = (cpRes?.data?.items ?? []).slice(0, 5).map((c: any): ResultItem => ({
          id: c.id,
          href: `/counterparties/${c.id}`,
          title: c.name,
          subtitle: c.inn ? `ИНН ${c.inn}` : 'ИНН не указан',
        }));
        if (cpItems.length) nextGroups.push({ key: 'counterparties', label: 'Контрагенты', icon: Users, items: cpItems });

        // У платежа нет собственной карточки — переход на связанный счёт.
        const payItems = (payRes?.data?.items ?? []).slice(0, 5).map((p: any): ResultItem => ({
          id: p.id,
          href: `/invoices/${p.invoice_id}`,
          title: `Платёж по счёту №${p.invoice_number ?? '—'}`,
          subtitle: `${p.counterparty_name ?? 'Без контрагента'} · ${p.amount_display ?? ''}`,
        }));
        if (payItems.length) nextGroups.push({ key: 'payments', label: 'Платежи', icon: CreditCard, items: payItems });

        setGroups(nextGroups);
        setActiveIndex(0);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function goTo(item: ResultItem) {
    close();
    router.push(item.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length) setActiveIndex(i => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length) setActiveIndex(i => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) goTo(item);
    }
  }

  let runningIndex = -1;

  return (
    <>
      <button
        type="button"
        className="fp-item fp-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Открыть глобальный поиск (⌘K)"
        title="Поиск (⌘K)"
      >
        <Search strokeWidth={1.5} />
      </button>

      {open && mounted && createPortal(
        <div className="fp-search-backdrop" onClick={close} aria-hidden="true">
          <div
            ref={dialogRef}
            className="fp-search-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Глобальный поиск"
            onClick={e => e.stopPropagation()}
          >
            <div
              className="fp-search-field"
              role="combobox"
              aria-expanded={flatItems.length > 0}
              aria-owns="fp-search-listbox"
              aria-haspopup="listbox"
            >
              {loading ? <Loader2 className="fp-search-spinner" strokeWidth={1.5} /> : <Search strokeWidth={1.5} />}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Поиск по счетам, контрагентам, платежам…"
                aria-label="Строка поиска"
                aria-autocomplete="list"
                aria-controls="fp-search-listbox"
                aria-activedescendant={flatItems[activeIndex] ? `fp-search-item-${flatItems[activeIndex].id}-${activeIndex}` : undefined}
                autoComplete="off"
              />
              <kbd className="fp-search-esc">Esc</kbd>
            </div>

            <div id="fp-search-listbox" role="listbox" className="fp-search-results">
              {!query.trim() && (
                <div className="fp-search-hint">Начните вводить номер счёта, название контрагента или ИНН</div>
              )}
              {query.trim() && !loading && flatItems.length === 0 && (
                <div className="fp-search-hint">Ничего не найдено по запросу «{query.trim()}»</div>
              )}
              {groups.map(group => {
                const Icon = group.icon;
                return (
                  <div className="fp-search-group" key={group.key}>
                    <div className="fp-search-group-label">{group.label}</div>
                    {group.items.map(item => {
                      runningIndex += 1;
                      const idx = runningIndex;
                      const active = idx === activeIndex;
                      return (
                        <button
                          type="button"
                          key={item.id}
                          id={`fp-search-item-${item.id}-${idx}`}
                          role="option"
                          aria-selected={active}
                          className={`fp-search-item${active ? ' active' : ''}`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => goTo(item)}
                        >
                          <Icon strokeWidth={1.5} />
                          <span className="fp-search-item-text">
                            <span className="fp-search-item-title">{item.title}</span>
                            <span className="fp-search-item-subtitle">{item.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
