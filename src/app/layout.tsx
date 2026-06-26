import type { Metadata } from 'next';
import './globals.css';
import { Navigation } from '@/components/Navigation';
import { AuthGuard } from '@/components/AuthGuard';

export const metadata: Metadata = {
  title: 'Аптека — Учёт выручки',
  description: 'Система учёта ежедневной выручки и расходов сети аптек',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <AuthGuard />
        <Navigation />
        <main className="max-w-screen-2xl mx-auto px-3 py-3">{children}</main>
      </body>
    </html>
  );
}
