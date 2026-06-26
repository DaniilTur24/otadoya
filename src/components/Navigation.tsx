'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const ALL_LINKS = [
  { href: '/revenue/new', label: '+ Добавить выручку', roles: ['admin', 'bookkeeper', 'manager'], exact: true },
  { href: '/revenue', label: 'Записи выручки', roles: ['admin', 'bookkeeper', 'manager'], exact: true },
  { href: '/employees', label: 'Сотрудники', roles: ['admin', 'bookkeeper'] },
  { href: '/users', label: 'Заведующие', roles: ['admin', 'bookkeeper'] },
  { href: '/attendance', label: 'Табель', roles: ['admin', 'bookkeeper', 'manager'] },
  { href: '/files', label: 'Банк / Импорт', roles: ['admin'] },
  { href: '/reports/monthly', label: 'Закрытие месяца', roles: ['admin'] },
  { href: '/reports/pdf-import', label: 'Импорт PDF', roles: ['admin'] },
  { href: '/settings', label: 'Настройки', roles: ['admin'] },
];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  bookkeeper: 'Бухгалтер',
  manager: 'Заведующий',
};

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setRole(d.role ?? null))
      .catch(() => setRole(null));
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (!role) return null;

  const links = ALL_LINKS.filter((l) => role && l.roles.includes(role));
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <nav className="sticky top-0 z-40 bg-slate-900 border-b border-slate-950">
      <div className="max-w-screen-2xl mx-auto px-3">
        <div className="flex items-center h-10 gap-1">
          <span className="font-semibold text-white mr-3 text-sm shrink-0 tracking-wide">Аптека Учёт</span>

          <div className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto flex-nowrap">
            {links.map((link) => {
              const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                    active ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="hidden md:flex ml-auto items-center gap-3">
            <span className="text-xs text-slate-400">{roleLabel}</span>
            <button
              onClick={logout}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Выйти
            </button>
          </div>

          <div className="flex md:hidden ml-auto items-center gap-2">
            <span className="text-xs text-slate-400">{roleLabel}</span>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded text-slate-200 hover:bg-slate-800 transition-colors"
              aria-label="Меню"
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-slate-700 py-2 space-y-0.5">
            {links.map((link) => {
              const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block px-3 py-2 rounded text-sm font-medium transition-colors ${
                    active ? 'bg-white text-slate-950' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-1 border-t border-slate-700 mt-1">
              <button
                onClick={logout}
                className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 rounded transition-colors"
              >
                Выйти
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
