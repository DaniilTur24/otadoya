import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);

const BOOKKEEPER_ALLOWED = [
  '/revenue',
  '/revenue/new',
  '/employees',
  '/api/revenue',
  '/api/employees',
  '/api/pharmacies',
  '/api/months/close',
];

function isBookkeeperAllowed(pathname: string): boolean {
  return BOOKKEEPER_ALLOWED.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix + '?'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Пропускаем страницу входа и её API
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('session')?.value;

  // Нет токена — на страницу входа
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  let role: string;
  try {
    const { payload } = await jwtVerify(token, secret);
    role = payload.role as string;
  } catch {
    const response = pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Сессия истекла' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('session', '', { maxAge: 0, path: '/' });
    return response;
  }

  // Бухгалтер — проверяем доступ
  if (role === 'bookkeeper' && !isBookkeeperAllowed(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/revenue/new', request.url));
  }

  // Передаём роль в заголовке для использования на сервере
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-role', role);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|IMG_5454.PNG).*)'],
};
