'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const ALL_LINKS = [
  { href: '/revenue/new', label: '+ Добавить выручку', roles: ['admin', 'bookkeeper'] },
  { href: '/revenue', label: 'Записи выручки', roles: ['admin', 'bookkeeper'] },
  { href: '/employees', label: 'Сотрудники', roles: ['admin', 'bookkeeper'] },
  { href: '/files', label: 'Банк / Импорт', roles: ['admin'] },
  { href: '/reports/monthly', label: 'Закрытие месяца', roles: ['admin'] },
  { href: '/reports/pdf-import', label: 'Импорт PDF', roles: ['admin'] },
  { href: '/settings', label: 'Настройки', roles: ['admin'] },
];

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setRole(d.role ?? null))
      .catch(() => setRole(null));
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (!role) return null;

  const links = ALL_LINKS.filter((l) => l.roles.includes(role));

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center min-h-14 py-2 gap-1 flex-wrap">
          <span className="font-bold text-blue-700 mr-4 text-sm shrink-0">
            Аптека Учёт
          </span>
          {links.map((link) => {
            const active = pathname.startsWith(link.href);
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
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {role === 'admin' ? 'Администратор' : 'Бухгалтер'}
            </span>
            <button
              onClick={logout}
              className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
