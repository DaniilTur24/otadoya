import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { timingSafeEqual } from 'crypto';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  getClientIp,
  recordFailedLogin,
} from '@/lib/rate-limit';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);

function passwordMatches(input: unknown, expected: string | undefined): boolean {
  if (typeof input !== 'string' || !expected) return false;

  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(inputBuffer, expectedBuffer);
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = checkLoginRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Слишком много попыток входа. Попробуйте позже' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds ?? 60),
        },
      }
    );
  }

  const { password } = await request.json().catch(() => ({ password: null }));

  let role: string | null = null;
  if (passwordMatches(password, process.env.ADMIN_PASSWORD)) role = 'admin';
  else if (passwordMatches(password, process.env.BOOKKEEPER_PASSWORD)) role = 'bookkeeper';

  if (!role) {
    recordFailedLogin(clientIp);
    return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 });
  }

  clearLoginRateLimit(clientIp);

  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);

  const response = NextResponse.json({ ok: true, role });
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return response;
}
