'use client';

import { useEffect } from 'react';

const DEFAULT_MESSAGE = 'Данные не сохранены. Уйти со страницы?';

/**
 * Предупреждает пользователя при попытке уйти со страницы (закрыть/обновить вкладку
 * или перейти по ссылке навигации), пока isDirty === true.
 */
export function useUnsavedChangesGuard(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (anchor.href === window.location.href) return;

      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isDirty, message]);
}
