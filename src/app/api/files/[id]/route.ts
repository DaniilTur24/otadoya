import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import path from 'path';

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

  // Удаляем физический файл (не критично если не нашли)
  try {
    await unlink(path.join(process.cwd(), 'uploads', file.filename));
  } catch {
    // файл мог быть удалён вручную — игнорируем
  }

  return NextResponse.json({ ok: true });
}
