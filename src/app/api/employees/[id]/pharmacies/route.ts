import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { findPharmacyUnlinkBlocker } from '@/lib/employee-pharmacy-validation';

// GET /api/employees/:id/pharmacies
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const employeeId = Number((await params).id);
  const links = await prisma.employeePharmacy.findMany({
    where: { employeeId },
    include: { pharmacy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(links.map((l) => l.pharmacy));
}

// PUT /api/employees/:id/pharmacies  — заменяет весь список аптек сотрудника
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const employeeId = Number((await params).id);
  const { pharmacyIds } = await request.json();

  if (!Array.isArray(pharmacyIds)) {
    return NextResponse.json({ error: 'pharmacyIds должен быть массивом' }, { status: 400 });
  }

  const currentLinks = await prisma.employeePharmacy.findMany({ where: { employeeId }, select: { pharmacyId: true } });
  const newIds = new Set(pharmacyIds.map(Number));
  const removedPharmacyIds = currentLinks.map((l) => l.pharmacyId).filter((id) => !newIds.has(id));

  const blocker = await findPharmacyUnlinkBlocker(employeeId, removedPharmacyIds);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  await prisma.$transaction(async (tx) => {
    await tx.employeePharmacy.deleteMany({ where: { employeeId } });
    if (pharmacyIds.length > 0) {
      await tx.employeePharmacy.createMany({
        data: pharmacyIds.map((pid: number) => ({ employeeId, pharmacyId: pid })),
        skipDuplicates: true,
      });
    }
  });

  const links = await prisma.employeePharmacy.findMany({
    where: { employeeId },
    include: { pharmacy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(links.map((l) => l.pharmacy));
}
