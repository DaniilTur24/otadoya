import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const file = await prisma.uploadedFile.findUnique({
    where: { id: Number(params.id) },
  });
  if (!file) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  // Удаляем запись из БД (расходы удалятся каскадно)
  await prisma.uploadedFile.delete({ where: { id: Number(params.id) } });

  await deleteFile(file.filename);

  return NextResponse.json({ ok: true });
}
