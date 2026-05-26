import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';
import { requireAdmin } from '@/lib/api-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const file = await prisma.uploadedFile.findUnique({
    where: { id: Number((await params).id) },
  });
  if (!file) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  await prisma.uploadedFile.delete({ where: { id: Number((await params).id) } });
  try {
    await deleteFile(file.filename);
  } catch (err) {
    console.error('Не удалось удалить файл из хранилища (сиротский файл):', file.filename, err);
  }

  return NextResponse.json({ ok: true });
}
