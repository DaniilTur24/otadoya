import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('session')?.value;
  if (!token) return NextResponse.json({ role: null });

  try {
    const { payload } = await jwtVerify(token, secret);
    return NextResponse.json({ role: payload.role });
  } catch {
    return NextResponse.json({ role: null });
  }
}
