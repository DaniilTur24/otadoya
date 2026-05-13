'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
          <h2 className="text-lg font-semibold mb-2">Критическая ошибка приложения</h2>
          <button onClick={reset} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">
            Перезагрузить
          </button>
        </div>
      </body>
    </html>
  );
}
