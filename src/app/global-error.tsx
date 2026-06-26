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
          <h2 className="text-base font-semibold mb-2">Критическая ошибка приложения</h2>
          <button onClick={reset} className="px-3 py-1.5 bg-slate-800 text-white rounded text-sm">
            Перезагрузить
          </button>
        </div>
      </body>
    </html>
  );
}
