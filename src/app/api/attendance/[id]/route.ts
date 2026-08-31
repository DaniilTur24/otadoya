import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';

// PATCH /api/attendance/[id] { overtimeHours } — правит часы переработки уже отмеченного дня
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const shift = await prisma.attendanceShift.findUnique({ where: { id } });
  if (!shift) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  const role = getRequestRole(request);
  if (role === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!shift.pharmacyId || !allowedIds?.includes(shift.pharmacyId)) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
  }

  const { overtimeHours } = await request.json();
  const numHours = Number(overtimeHours);
  if (Number.isNaN(numHours) || numHours < 0) {
    return NextResponse.json({ error: 'Некорректное значение часов' }, { status: 400 });
  }

  const updated = await prisma.attendanceShift.update({
    where: { id },
    data: { overtimeHours: numHours },
  });
  return NextResponse.json({ ...updated, overtimeHours: Number(updated.overtimeHours) });
}

// DELETE /api/attendance/[id] — снимает отметку посещаемости (например, при ошибочной отметке)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const shift = await prisma.attendanceShift.findUnique({ where: { id } });
  if (!shift) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  const role = getRequestRole(request);
  if (role === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!shift.pharmacyId || !allowedIds?.includes(shift.pharmacyId)) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
  }

  await prisma.attendanceShift.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
