import { NextRequest, NextResponse } from 'next/server';
import { getEmployeeSalaryImpact } from '@/lib/salary-impact';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET /api/employees/[id]/salary-impact
// Какие месяцы пересчитаются, если изменить оклад/ставку/тип этого сотрудника.
// Используется формой карточки сотрудника и /users, чтобы предупредить конкретикой.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const employeeId = Number((await params).id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'Некорректный id сотрудника' }, { status: 400 });
  }

  const impact = await getEmployeeSalaryImpact(employeeId);
  if (!impact) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  return NextResponse.json(impact);
}
