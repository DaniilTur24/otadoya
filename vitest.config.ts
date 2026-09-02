import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Рабочие деревья агентов (.claude/worktrees/*) — это копии репозитория со своими
    // src/__tests__. Vitest подхватывал их в общий прогон, но алиас '@' резолвится в src
    // ОСНОВНОГО репозитория, поэтому их тесты проверяли чужой код и падали на устаревших
    // ожиданиях. Тесты каждого дерева нужно запускать из него самого.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
