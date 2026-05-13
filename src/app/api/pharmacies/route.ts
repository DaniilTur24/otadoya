import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const pharmacies = await prisma.pharmacy.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(pharmacies);
}

export async function POST(request: Request) {
  const { name } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
  }
  const pharmacy = await prisma.pharmacy.create({ data: { name: name.trim() } });
  return NextResponse.json(pharmacy, { status: 201 });
}
