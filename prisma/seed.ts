import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pharmacies = [
    '70я',
    'Алатау',
    'Байтерек',
    'Думан',
    'Есик',
    'Ирень',
  ];

  for (const name of pharmacies) {
    await prisma.pharmacy.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  console.log('✓ Seed завершён: добавлены аптеки');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
