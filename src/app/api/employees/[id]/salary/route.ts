import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateEmployeeMonthlySalary,
  getEmployeeMonthlyShifts,
  getEmployeeMonthlyAdvances,
  getEmployeeMonthlySurcharges,
  getEmployeeMonthlyAttendance,
} from '@/lib/salary-calculator';
import { parseSnapshot, findStoredSalary } from '@/lib/salary-snapshot';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const pharmacyId = searchParams.get('pharmacyId')
    ? Number(searchParams.get('pharmacyId'))
    : undefined;

  const employeeId = Number((await params).id);

  // Списки смен/отметок/авансов читаются вживую и для закрытого месяца тоже: это реальные
  // строки в БД, а запись в закрытый месяц запрещена, поэтому они уже неизменны. Замораживать
  // нужно только вычисляемые суммы — они зависят от текущих настроек (оклад, календарь, премии).
  const [liveSummary, shifts, advances, surcharges, attendance, closedMonth] = await Promise.all([
    calculateEmployeeMonthlySalary(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyShifts(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyAdvances(employeeId, month, year, pharmacyId),
    getEmployeeMonthlySurcharges(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyAttendance(employeeId, month, year, pharmacyId),
    prisma.closedMonth.findUnique({ where: { year_month: { year, month } } }),
  ]);

  if (!liveSummary) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  const overtimeHours = attendance.reduce((sum, a) => sum + a.overtimeHours, 0);

  // Месяц закрыт — отдаём зафиксированные при закрытии суммы. Если сотрудника в снимке нет
  // (создан уже после закрытия, или снимок сделан до появления зарплатной секции), считаем
  // вживую и честно помечаем это, а не выдаём живой расчёт за замороженный.
  let summary = liveSummary;
  let isFrozen = false;
  if (closedMonth) {
    const stored = findStoredSalary(
      parseSnapshot(closedMonth.snapshotJson).employees,
      employeeId,
      pharmacyId ?? null,
    );
    if (stored) {
      summary = stored;
      isFrozen = true;
    }
  }

  return NextResponse.json({
    ...summary,
    shifts,
    advances,
    surcharges,
    attendance,
    overtimeHours,
    isClosed: !!closedMonth,
    isFrozen,
  });
}
