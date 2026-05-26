import { NextResponse } from 'next/server';

export type UserRole = 'admin' | 'bookkeeper';

const VALID_ROLES = new Set<UserRole>(['admin', 'bookkeeper']);

export function getRequestRole(request: Request): UserRole | null {
  const role = request.headers.get('x-user-role');
  return VALID_ROLES.has(role as UserRole) ? (role as UserRole) : null;
}

export function requireRole(request: Request, allowedRoles: UserRole[]): NextResponse | null {
  const role = getRequestRole(request);

  if (!role) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  return null;
}

export function requireAdmin(request: Request): NextResponse | null {
  return requireRole(request, ['admin']);
}

export function requireAdminOrBookkeeper(request: Request): NextResponse | null {
  return requireRole(request, ['admin', 'bookkeeper']);
}
