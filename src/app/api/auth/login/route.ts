import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  let role: string | null = null;
  if (password === process.env.ADMIN_PASSWORD) role = 'admin';
  else if (password === process.env.BOOKKEEPER_PASSWORD) role = 'bookkeeper';

  if (!role) {
    return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 });
  }

  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);

  const response = NextResponse.json({ ok: true, role });
  response.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return response;
}
