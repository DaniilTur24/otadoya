import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type UserRole = 'admin' | 'bookkeeper' | 'manager';

const VALID_ROLES = new Set<UserRole>(['admin', 'bookkeeper', 'manager']);

export function getRequestRole(request: Request): UserRole | null {
  const role = request.headers.get('x-user-role');
  return VALID_ROLES.has(role as UserRole) ? (role as UserRole) : null;
}

export function getRequestUserId(request: Request): number | null {
  const id = request.headers.get('x-user-id');
  const parsed = id ? parseInt(id, 10) : NaN;
  return isNaN(parsed) ? null : parsed;
}

export async function requireRole(request: Request, allowedRoles: UserRole[]): Promise<NextResponse | null> {
  const role = getRequestRole(request);

  if (!role) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  // admin/bookkeeper — из env, isActive у них нет. У manager isActive проверяется здесь
  // на каждый запрос (а не только при логине): токен живёт 7 дней, а без этой проверки
  // отключённый/уволенный заведующий сохранял бы доступ до истечения токена.
  if (role === 'manager') {
    const userId = getRequestUserId(request);
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } }) : null;
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Аккаунт отключён' }, { status: 403 });
    }
  }

  return null;
}

export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  return requireRole(request, ['admin']);
}

export async function requireAdminOrBookkeeper(request: Request): Promise<NextResponse | null> {
  return requireRole(request, ['admin', 'bookkeeper']);
}

export async function requireAnyRole(request: Request): Promise<NextResponse | null> {
  return requireRole(request, ['admin', 'bookkeeper', 'manager']);
}

// Возвращает список ID аптек, доступных заведующему.
// Для admin/bookkeeper возвращает null (без ограничений).
export async function getManagerPharmacyIds(request: Request): Promise<number[] | null> {
  const role = getRequestRole(request);
  if (role !== 'manager') return null;

  const userId = getRequestUserId(request);
  if (!userId) return [];

  const links = await prisma.userPharmacy.findMany({
    where: { userId },
    select: { pharmacyId: true },
  });

  return links.map((l) => l.pharmacyId);
}
