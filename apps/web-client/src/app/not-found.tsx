import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';

// Next.js App Router рендерит этот файл как для несуществующих маршрутов, так и
// при явном вызове notFound() — при этом он попадает в children обычного
// RootLayout, а значит и внутрь <AppShell>. Но AppShell определяет "публичные"
// маршруты по точному списку путей (см. isPublic в AppShell.tsx), и путь
// несуществующей страницы в этот список никогда не попадёт. Из-за этого 404
// на время между рендером и проверкой токена получает "приватную" обёртку
// AppShell (рельс навигации, ReminderPopup и т.д.) поверх дефолтной страницы
// Next.js — отсюда и артефакт с полупрозрачным баннером поверх чёрного фона
// дефолтной 404-страницы.
//
// Чтобы не зависеть от этой логики (и от порядка её будущих правок), страница
// сама разворачивается на весь вьюпорт поверх всего остального дерева —
// с фирменным градиентным фоном и центрированной карточкой, независимо от
// того, что успел отрендерить AppShell вокруг неё.
export default function NotFound() {
  return (
    <div className="fp-wrap" style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      <div className="card blueprint fp-panel" style={{ textAlign: 'center' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="fp-brand">
          <div className="fp-brand-mark" aria-hidden="true" />
          <div className="fp-brand-title">Счёт&amp;Контроль</div>
          <div className="fp-brand-sub">Страница не найдена</div>
        </div>

        <div className="error-box" style={{ marginBottom: 0, textAlign: 'left' }}>
          Такой страницы не существует — возможно, ссылка устарела или в адресе опечатка.
        </div>

        <Link href="/dashboard" className="btn btn-primary btn-block blueprint" style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <LayoutDashboard strokeWidth={1.5} size={16} />
          На дашборд
        </Link>
      </div>
    </div>
  );
}
