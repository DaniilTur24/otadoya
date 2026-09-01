import { NextRequest, NextResponse } from 'next/server';
import { getPharmacySalaryImpact } from '@/lib/salary-impact';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET /api/pharmacies/[id]/salary-impact
// Какие месяцы и кого из сотрудников затронет изменение настроек премии этой аптеки
// (пороги лестничной премии, переключатель средней выручки за смену).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const pharmacyId = Number((await params).id);
  if (!Number.isInteger(pharmacyId) || pharmacyId <= 0) {
    return NextResponse.json({ error: 'Некорректный id аптеки' }, { status: 400 });
  }

  const impact = await getPharmacySalaryImpact(pharmacyId);
  if (!impact) return NextResponse.json({ error: 'Аптека не найдена' }, { status: 404 });

  return NextResponse.json(impact);
}
