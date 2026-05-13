import Link from 'next/link';

const sections = [
  {
    href: '/revenue/new',
    title: 'Добавить выручку',
    description: 'Бухгалтер вводит дневную выручку по данным с бумажного листочка сотрудника.',
    color: 'border-blue-400 hover:border-blue-500',
    icon: '📋',
  },
  {
    href: '/files',
    title: 'Файлы и расходы',
    description: 'Загрузка Excel-выгрузок из банка. Автоматическое извлечение строк с расходами и арендой.',
    color: 'border-purple-400 hover:border-purple-500',
    icon: '📂',
  },
  {
    href: '/reports',
    title: 'Отчёты',
    description: 'Сводный отчёт по аптекам: выручка, расходы, итог. Фильтрация по периоду и аптеке.',
    color: 'border-amber-400 hover:border-amber-500',
    icon: '📊',
  },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Учёт выручки аптечной сети
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        Выберите раздел для работы
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={`card p-6 border-l-4 ${s.color} transition-shadow hover:shadow-md block`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{s.icon}</span>
              <div>
                <h2 className="font-semibold text-gray-900 text-base mb-1">
                  {s.title}
                </h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {s.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
