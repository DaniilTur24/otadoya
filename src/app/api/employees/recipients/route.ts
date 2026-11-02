import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// Только id, имя и тип активных сотрудников выбранной аптеки (плюс office, которым можно выдать
// деньги из кассы любой аптеки) — для селектора «кому» в авансе, выданном из кассы одной аптеки
// сотруднику другой. Полный /api/employees заведующему отдаёт лишь его аптеки, а оклады и прочие
// финансовые поля чужих сотрудников ему не нужны, поэтому здесь их нет.
export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const pharmacyId = Number(new URL(request.url).searchParams.get('pharmacyId'));
  if (!Number.isInteger(pharmacyId) || pharmacyId <= 0) {
    return NextResponse.json({ error: 'Не указана аптека' }, { status: 400 });
  }

  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      OR: [{ pharmacies: { some: { pharmacyId } } }, { employeeType: 'office' }],
    },
    select: { id: true, name: true, employeeType: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(employees);
}
