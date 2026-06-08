'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const ALL_LINKS = [
  { href: '/revenue/new', label: '+ Добавить выручку', roles: ['admin', 'bookkeeper', 'manager'], exact: true },
  { href: '/revenue', label: 'Записи выручки', roles: ['admin', 'bookkeeper', 'manager'], exact: true },
  { href: '/employees', label: 'Сотрудники', roles: ['admin', 'bookkeeper'] },
  { href: '/users', label: 'Заведующие', roles: ['admin', 'bookkeeper'] },
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
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          <span className="font-bold text-blue-700 mr-2 text-sm shrink-0">Аптека Учёт</span>

          <div className="hidden md:flex items-center gap-1 flex-1 flex-wrap">
            {links.map((link) => {
              const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="hidden md:flex ml-auto items-center gap-3">
            <span className="text-xs text-gray-400">{roleLabel}</span>
            <button
              onClick={logout}
              className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Выйти
            </button>
          </div>

          <div className="flex md:hidden ml-auto items-center gap-2">
            <span className="text-xs text-gray-400">{roleLabel}</span>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
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
          <div className="md:hidden border-t border-gray-100 py-2 space-y-0.5">
            {links.map((link) => {
              const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-1 border-t border-gray-100 mt-1">
              <button
                onClick={logout}
                className="block w-full text-left px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
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
