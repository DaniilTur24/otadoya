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

    // Записи «на проверке» в снимок не входят (он берёт только approved), а подтвердить их после
    // закрытия уже нельзя (approve отвечает 423). Закрыть месяц с ними — значит навсегда потерять
    // их выручку, смены и выданные из них авансы, причём все статусы будут выглядеть «зелёными»
    // (QA раунд 4, №6). Поэтому сначала пусть бухгалтер их подтвердит или удалит.
    const pending = await prisma.dailyRevenueEntry.aggregate({
      where: {
        status: 'pending',
        date: { gte: new Date(year, month - 1, 1), lte: new Date(year, month, 0, 23, 59, 59, 999) },
      },
      _count: { _all: true },
      _sum: { cashRevenue: true, terminalRevenue: true, kaspiRevenue: true },
    });
    if (pending._count._all > 0) {
      const pendingRevenue =
        Number(pending._sum.cashRevenue ?? 0) +
        Number(pending._sum.terminalRevenue ?? 0) +
        Number(pending._sum.kaspiRevenue ?? 0);
      return NextResponse.json(
        {
          error:
            `В ${month}.${year} ${pending._count._all} запис(ей) выручки на проверке ` +
            `на ${pendingRevenue.toLocaleString('ru-RU')} ₸ — сначала подтвердите или удалите их на странице «Записи выручки»`,
        },
        { status: 400 },
      );
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

    // Симметричный случай для заведующей на фиксированной ставке (manager_trading с
    // fiveDayViaAttendance) и суточника (seller_five_day_fixed): дни в табеле отработаны, а
    // shiftRate не задан — та же защита от заморозки тихого нуля, что и для календаря выше.
    const shiftRateMissingNames = [
      ...new Set(
        employeeSalaries
          .filter((e) => e.pharmacyId === null && e.shiftRateMissing)
          .map((e) => e.employeeName),
      ),
    ];
    if (shiftRateMissingNames.length > 0) {
      return NextResponse.json(
        {
          error:
            `Заполните ставку за смену на странице /users для: ${shiftRateMissingNames.join(', ')} — иначе зарплата ` +
            `за ${month}.${year} будет зафиксирована нулём`,
        },
        { status: 400 },
      );
    }

    // Лестничная премия включена, а у аптеки не заполнены порог/база — премия тихо 0. Тот же
    // класс, что календарь/ставка выше: замораживать такой ноль снимком нельзя (QA раунд 4, №14).
    const ladderMissing = employeeSalaries.filter((e) => e.pharmacyId === null && e.ladderConfigMissing);
    if (ladderMissing.length > 0) {
      const names = [...new Set(ladderMissing.map((e) => e.employeeName))];
      const pharmacyNames = [...new Set(ladderMissing.flatMap((e) => e.ladderConfigMissingPharmacies ?? []))];
      return NextResponse.json(
        {
          error:
            `Заполните лестницу премии (порог и базу) в настройках аптек: ${pharmacyNames.join(', ')} — ` +
            `иначе премия за ${month}.${year} будет зафиксирована нулём для: ${names.join(', ')}`,
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
