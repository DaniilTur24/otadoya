'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Главная' },
  { href: '/revenue/new', label: '+ Добавить выручку' },
  { href: '/revenue', label: 'Записи выручки' },
  { href: '/files', label: 'Банк / Импорт' },
  { href: '/reports', label: 'Отчёты' },
  { href: '/reports/monthly', label: 'Закрытие месяца' },
  { href: '/reports/pdf-import', label: 'Импорт PDF' },
  { href: '/settings', label: 'Настройки' },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center min-h-14 py-2 gap-1 flex-wrap">
          <span className="font-bold text-blue-700 mr-4 text-sm shrink-0">
            Аптека Учёт
          </span>
          {links.map((link) => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
