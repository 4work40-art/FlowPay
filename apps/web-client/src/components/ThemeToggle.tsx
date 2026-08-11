'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Тема хранится в localStorage под ключом THEME_KEY и применяется как
// атрибут data-theme на <html>. Начальное значение при первом визите (без
// сохранённого выбора) проставляется синхронно inline-скриптом в <head>
// (см. app/layout.tsx) — до гидратации React, чтобы не мигать неправильной
// темой (FOUC). Здесь мы только читаем то, что уже стоит на <html>, и
// переключаем его по клику.
export const THEME_KEY = 'theme';

function getCurrentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

export function toggleTheme() {
  applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
}

/** Иконка солнце/луна — переключатель темы. mounted-флаг нужен, т.к. на
 * сервере атрибута data-theme ещё нет (его проставляет только inline-скрипт
 * в браузере) — без этого флага SSR и первый клиентский рендер разойдутся. */
export default function ThemeToggle({ className = 'fp-item', label = true }: { className?: string; label?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setMounted(true);
    setTheme(getCurrentTheme());
  }, []);

  const handleClick = () => {
    toggleTheme();
    setTheme(getCurrentTheme());
  };

  const isDark = mounted && theme === 'dark';

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      aria-label={isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
      suppressHydrationWarning
    >
      {isDark ? <Sun strokeWidth={1.5} /> : <Moon strokeWidth={1.5} />}
      {label && className !== 'fp-item' ? <span>{isDark ? 'Светлая тема' : 'Тёмная тема'}</span> : null}
    </button>
  );
}
