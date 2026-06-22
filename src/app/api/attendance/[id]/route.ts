import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';

// DELETE /api/attendance/[id] — снимает отметку посещаемости (например, при ошибочной отметке)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAnyRole(request);
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
