import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function serialize(emp: Record<string, unknown>) {
  return { ...emp, baseSalary: Number(emp.baseSalary) };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isActiveParam = searchParams.get('isActive');

  const where: Record<string, unknown> = {};
  if (isActiveParam === 'true') where.isActive = true;
  if (isActiveParam === 'false') where.isActive = false;

  const employees = await prisma.employee.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(employees.map((e) => serialize(e as unknown as Record<string, unknown>)));
}

export async function POST(request: Request) {
  const { name, baseSalary, isActive } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Имя сотрудника обязательно' }, { status: 400 });
  }

  const employee = await prisma.employee.create({
    data: {
      name: name.trim(),
      baseSalary: String(baseSalary ?? 0),
      isActive: isActive !== false,
    },
  });

  return NextResponse.json(serialize(employee as unknown as Record<string, unknown>), { status: 201 });
}
