'use client';

import { useEffect } from 'react';

// Числа в таких полях должны вводиться только нажатием клавиш с цифрами —
// колесо мыши и стрелки вверх/вниз не должны менять значение.
export function NumberInputGuard() {
  useEffect(() => {
    function isNumberInput(target: EventTarget | null): target is HTMLInputElement {
      return target instanceof HTMLInputElement && target.type === 'number';
    }

    function handleWheel() {
      if (isNumberInput(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isNumberInput(e.target)) {
        e.preventDefault();
      }
    }

    document.addEventListener('wheel', handleWheel, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return null;
}
