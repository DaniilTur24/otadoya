import { prisma } from '@/lib/prisma';

/**
 * Если у сотрудника есть записи выручки/табеля по аптеке, которую от него хотят отвязать,
 * блокируем отвязку — иначе эти записи останутся в БД, но перестанут попадать в расчёт
 * зарплаты и в отчёт (оба берут текущий список привязанных аптек сотрудника), и расхождение
 * останется незаметным.
 */
export async function findPharmacyUnlinkBlocker(
  employeeId: number,
  removedPharmacyIds: number[],
): Promise<string | null> {
  if (removedPharmacyIds.length === 0) return null;

  const [revenueCount, attendanceCount] = await Promise.all([
    prisma.dailyRevenueEntry.count({ where: { employeeId, pharmacyId: { in: removedPharmacyIds } } }),
    prisma.attendanceShift.count({ where: { employeeId, pharmacyId: { in: removedPharmacyIds } } }),
  ]);

  const total = revenueCount + attendanceCount;
  if (total > 0) {
    return `Нельзя отвязать сотрудника от этой аптеки — у него есть ${total} запис(ей) выручки/табеля по ней, они перестанут учитываться в зарплате и отчёте`;
  }
  return null;
}
