import { NextRequest, NextResponse } from 'next/server';
import { calculateEmployeeMonthlySalary, getEmployeeMonthlyShifts } from '@/lib/salary-calculator';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const pharmacyId = searchParams.get('pharmacyId')
    ? Number(searchParams.get('pharmacyId'))
    : undefined;

  const employeeId = Number(params.id);

  const [summary, shifts] = await Promise.all([
    calculateEmployeeMonthlySalary(employeeId, month, year, pharmacyId),
    getEmployeeMonthlyShifts(employeeId, month, year, pharmacyId),
  ]);

  if (!summary) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  return NextResponse.json({ ...summary, shifts });
}
