import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Страница не найдена</h2>
      <p className="text-sm text-gray-500 mb-4">Запрашиваемая страница не существует.</p>
      <Link href="/" className="btn-primary">
        На главную
      </Link>
    </div>
  );
}
