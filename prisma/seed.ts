import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pharmacies = [
    'Аптека №1 — Центральная',
    'Аптека №2 — Северная',
    'Аптека №3 — Западная',
    'Аптека №4 — Восточная',
    'Аптека №5 — Южная',
  ];

  for (const name of pharmacies) {
    await prisma.pharmacy.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log('✓ Seed завершён: добавлено 5 аптек');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
