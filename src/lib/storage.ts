import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';

const isR2Configured = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);

const s3 = isR2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

const BUCKET = process.env.R2_BUCKET_NAME ?? '';

export async function uploadFile(key: string, buffer: Buffer): Promise<void> {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer }));
  } else {
    const dir = path.join(process.cwd(), 'uploads');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, key), buffer);
  }
}

export async function downloadFile(key: string): Promise<Buffer> {
  if (s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } else {
    return readFile(path.join(process.cwd(), 'uploads', key));
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (s3) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch {
      // ignore if file doesn't exist
    }
  } else {
    try {
      await unlink(path.join(process.cwd(), 'uploads', key));
    } catch {
      // ignore if file doesn't exist
    }
  }
}
