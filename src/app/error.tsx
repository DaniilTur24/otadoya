'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Что-то пошло не так</h2>
      <p className="text-sm text-gray-500 mb-4">{error.message || 'Неизвестная ошибка'}</p>
      <button className="btn-primary" onClick={reset}>
        Попробовать снова
      </button>
    </div>
  );
}
