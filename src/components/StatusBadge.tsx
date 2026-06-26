const STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает проверки',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
  needs_review: 'Нужна проверка',
  ignored: 'Игнорировано',
  confirmed: 'Подтверждено',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-300',
  approved: 'bg-green-50 text-green-800 border-green-300',
  rejected: 'bg-red-50 text-red-800 border-red-300',
  needs_review: 'bg-amber-50 text-amber-800 border-amber-300',
  ignored: 'bg-slate-100 text-slate-600 border-slate-300',
  confirmed: 'bg-green-50 text-green-800 border-green-300',
};

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Аренда',
  expense: 'Расход',
};

const CATEGORY_CLASSES: Record<string, string> = {
  rent: 'bg-slate-100 text-slate-700 border-slate-300',
  expense: 'bg-zinc-100 text-zinc-700 border-zinc-300',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium ${
        STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-700 border-slate-300'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium ${
        CATEGORY_CLASSES[category] ?? 'bg-slate-100 text-slate-700 border-slate-300'
      }`}
    >
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}
