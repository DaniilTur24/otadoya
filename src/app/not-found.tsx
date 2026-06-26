import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      <h2 className="text-base font-semibold text-slate-800 mb-2">Страница не найдена</h2>
      <p className="text-sm text-slate-500 mb-4">Запрашиваемая страница не существует.</p>
      <Link href="/" className="btn-primary">
        На главную
      </Link>
    </div>
  );
}
