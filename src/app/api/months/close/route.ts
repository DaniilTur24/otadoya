import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeMonthlyData, buildMonthlySnapshot } from '@/lib/monthly-report-builder';
import { buildEmployeeSalarySnapshot, serializeSnapshot } from '@/lib/salary-snapshot';
import { requireAdmin, requireAnyRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET — проверить закрыт ли месяц. Middleware явно разрешает этот путь менеджеру
// (нужно, чтобы /revenue/new мог предупредить его до сохранения записи) — раньше здесь
// стоял requireAdminOrBookkeeper, менеджер получал 403, и фронт молча трактовал это как
// «месяц открыт», не показывая предупреждение.
export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  if (!year || !month) return NextResponse.json({ isClosed: false });

  try {
    const record = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
    return NextResponse.json({ isClosed: !!record, closedAt: record?.closedAt ?? null });
  } catch (err) {
    console.error('Ошибка проверки статуса месяца:', err);
    return NextResponse.json({ error: 'Не удалось проверить статус месяца' }, { status: 500 });
  }
}

// POST — закрыть месяц: снапшот строится на сервере из актуальных данных БД
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  let year: number, month: number;
  try {
    ({ year, month } = await request.json());
  } catch (err) {
    console.error('Ошибка разбора запроса закрытия месяца:', err);
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
  }

  if (!year || !month) {
    return NextResponse.json({ error: 'year и month обязательны' }, { status: 400 });
  }

  try {
    const existing = await prisma.closedMonth.findUnique({
      where: { year_month: { year, month } },
    });
    if (existing) {
      return NextResponse.json({ error: 'Месяц уже закрыт' }, { status: 409 });
    }

    const { pharmacies, systemData, overrideMap } = await computeMonthlyData(year, month);
    const snapshot = buildMonthlySnapshot(pharmacies, systemData, overrideMap);
    // Разбивка по сотрудникам замораживается вместе с отчётом — иначе повышение оклада или
    // правка производственного календаря изменили бы карточку за уже закрытый месяц.
    const employeeSalaries = await buildEmployeeSalarySnapshot(year, month);

    // Без производственного календаря пятидневная/табельная часть оклада тихо считается как 0
    // (см. calendarMissing в salary-calculator.ts). Замораживать такие нули снимком нельзя —
    // это зафиксирует неверную зарплату навсегда для уже закрытого месяца.
    const affectedNames = [
      ...new Set(
        employeeSalaries
          .filter((e) => e.pharmacyId === null && e.calendarMissing)
          .map((e) => e.employeeName),
      ),
    ];
    if (affectedNames.length > 0) {
      return NextResponse.json(
        {
          error:
            `Заполните производственный календарь за ${month}.${year} — иначе зарплата ` +
            `будет зафиксирована нулём для: ${affectedNames.join(', ')}`,
        },
        { status: 400 },
      );
    }

    const record = await prisma.closedMonth.create({
      data: { year, month, snapshotJson: serializeSnapshot(snapshot, employeeSalaries) },
    });

    return NextResponse.json({ ok: true, closedAt: record.closedAt });
  } catch (err) {
    console.error(`Ошибка закрытия месяца ${year}-${month}:`, err);
    // Уникальный индекс (year, month) — гонка между параллельными запросами закрытия
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Месяц уже закрыт' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Не удалось закрыть месяц' }, { status: 500 });
  }
}

// DELETE — открыть месяц обратно
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  let year: number, month: number;
  try {
    ({ year, month } = await request.json());
  } catch (err) {
    console.error('Ошибка разбора запроса открытия месяца:', err);
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
  }

  if (!year || !month) {
    return NextResponse.json({ error: 'year и month обязательны' }, { status: 400 });
  }

  try {
    // Раньше запись в закрытый месяц не отклонялась, а тихо сохранялась с excludedFromReport:
    // true, и при открытии месяца обратно эту автопометку нужно было снять массово. Сейчас
    // POST /api/revenue и табельные эндпоинты просто отклоняют запись в закрытый месяц (423) —
    // автопометки больше не бывает. excludedFromReport теперь выставляет только бухгалтер вручную
    // как осознанное решение "не учитывать эту запись" (влияет и на отчёт, и на зарплату), и
    // массовый сброс здесь стирал бы это решение при каждом открытии месяца обратно.
    await prisma.closedMonth.deleteMany({ where: { year, month } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Ошибка открытия месяца ${year}-${month}:`, err);
    return NextResponse.json({ error: 'Не удалось открыть месяц' }, { status: 500 });
  }
}
