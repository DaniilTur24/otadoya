import { NextRequest, NextResponse } from 'next/server';
import {
  calculateEmployeeMonthlySalary,
  getEmployeeMonthlyShifts,
  getEmployeeMonthlyAdvances,
  getEmployeeMonthlyAttendance,
} from '@/lib/salary-calculator';
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

  const [summary, shifts, advances, attendance] = await Promise.all([
    calculateEmployeeMonthlySalary(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyShifts(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyAdvances(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyAttendance(employeeId, month, year, pharmacyId),
  ]);

  if (!summary) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  return NextResponse.json({ ...summary, shifts, advances, attendance });
}
