const STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает проверки',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
  needs_review: 'Нужна проверка',
  ignored: 'Игнорировано',
  confirmed: 'Подтверждено',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  needs_review: 'bg-orange-100 text-orange-800',
  ignored: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-100 text-green-800',
};

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Аренда',
  expense: 'Расход',
};

const CATEGORY_CLASSES: Record<string, string> = {
  rent: 'bg-purple-100 text-purple-800',
  expense: 'bg-orange-100 text-orange-800',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        STATUS_CLASSES[status] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        CATEGORY_CLASSES[category] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}
