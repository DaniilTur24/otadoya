import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function serialize(emp: Record<string, unknown>) {
  return { ...emp, baseSalary: Number(emp.baseSalary) };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const employee = await prisma.employee.findUnique({ where: { id: Number(params.id) } });
  if (!employee) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return NextResponse.json(serialize(employee as unknown as Record<string, unknown>));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { name, baseSalary, isActive } = await request.json();

  const data: Record<string, unknown> = {};
  if (name != null) data.name = name.trim();
  if (baseSalary != null) data.baseSalary = String(baseSalary);
  if (isActive != null) data.isActive = Boolean(isActive);

  const employee = await prisma.employee.update({
    where: { id: Number(params.id) },
    data,
  });

  return NextResponse.json(serialize(employee as unknown as Record<string, unknown>));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.employee.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}
