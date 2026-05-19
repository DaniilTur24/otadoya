import { NextRequest, NextResponse } from 'next/server';
import { calculateAllEmployeesSalaries } from '@/lib/salary-calculator';

export const dynamic = 'force-dynamic';

// GET /api/employees/salary-summary?month=X&year=Y&pharmacyId=Z
// Возвращает зарплаты всех активных сотрудников за указанный месяц.
// Используется в закрытии месяца для расчёта статьи «Зарплата сотрудников».
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const pharmacyId = searchParams.get('pharmacyId')
    ? Number(searchParams.get('pharmacyId'))
    : undefined;

  const results = await calculateAllEmployeesSalaries(month, year, pharmacyId);
  const totalSalary = results.reduce((sum, r) => sum + r.totalSalary, 0);

  return NextResponse.json({ month, year, pharmacyId: pharmacyId ?? null, employees: results, totalSalary });
}
