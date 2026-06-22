import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);

const BOOKKEEPER_ALLOWED = [
  '/revenue',
  '/revenue/new',
  '/employees',
  '/users',
  '/attendance',
  '/api/revenue',
  '/api/employees',
  '/api/pharmacies',
  '/api/users',
  '/api/months/close',
  '/api/attendance',
];

const MANAGER_ALLOWED = [
  '/revenue',
  '/revenue/new',
  '/attendance',
  '/api/revenue',
  '/api/employees',
  '/api/pharmacies',
  '/api/months/close',
  '/api/attendance',
];

const MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PDF_UPLOAD_BYTES = 15 * 1024 * 1024;

function isAllowed(pathname: string, allowlist: string[]): boolean {
  return allowlist.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(prefix + '/') ||
      pathname.startsWith(prefix + '?')
  );
}

function getUploadLimit(pathname: string, method: string): number | null {
  if (method !== 'POST') return null;
  if (pathname === '/api/files' || pathname === '/api/bank-imports') return MAX_EXCEL_UPLOAD_BYTES;
  if (pathname === '/api/reports/pdf-import') return MAX_PDF_UPLOAD_BYTES;
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const uploadLimit = getUploadLimit(pathname, request.method);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (uploadLimit && contentLength > uploadLimit) {
    return NextResponse.json({ error: 'Файл слишком большой' }, { status: 413 });
  }

  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('session')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  let role: string;
  let userId: number | null = null;
  try {
    const { payload } = await jwtVerify(token, secret);
    role = payload.role as string;
    userId = typeof payload.userId === 'number' ? payload.userId : null;
  } catch {
    const response = pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Сессия истекла' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('session', '', { maxAge: 0, path: '/' });
    return response;
  }

  if (role === 'bookkeeper' && !isAllowed(pathname, BOOKKEEPER_ALLOWED)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/revenue/new', request.url));
  }

  if (role === 'manager' && !isAllowed(pathname, MANAGER_ALLOWED)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/revenue/new', request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-role', role);
  if (userId !== null) requestHeaders.set('x-user-id', String(userId));

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|IMG_5454.PNG).*)'],
};
