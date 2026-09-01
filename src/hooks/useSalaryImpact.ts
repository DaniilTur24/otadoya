'use client';

import { useState, useCallback } from 'react';
import type { ImpactMonth } from '@/components/SalaryImpactDialog';

interface BaseImpact {
  months: ImpactMonth[];
  totalRecords: number;
}

/**
 * Загружает «что затронет это изменение» для формы, которая правит настройку,
 * пересчитывающую зарплату задним числом (см. src/lib/salary-impact.ts).
 *
 * Диалог открывается сразу, не дожидаясь ответа, и показывает спиннер: иначе между
 * нажатием «Сохранить» и появлением предупреждения был бы провал, в котором непонятно,
 * сохранилось уже или нет.
 */
export function useSalaryImpact<T extends BaseImpact = BaseImpact>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (url: string) => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(url);
      if (res.ok) setData(await res.json());
    } catch {
      // Не удалось посчитать — диалог всё равно показывается, просто без списка месяцев.
      // Блокировать сохранение из-за сбоя вспомогательного запроса неправильно.
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
  }, []);

  return { data, loading, load, reset };
}
