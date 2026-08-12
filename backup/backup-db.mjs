#!/usr/bin/env node
// Standalone daily DB backup: pg_dump -> Cloudflare R2. Deployed as its own Railway
// service (rootDirectory: backup/) so it gets a plain Node.js build — Railpack ships
// only framework build output for the main Next.js app, not arbitrary source files.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const execFileAsync = promisify(execFile);

const RETENTION_DAYS = 30;
const PREFIX = 'db-backups/';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function dumpDatabase(databaseUrl) {
  const dir = await mkdtemp(join(tmpdir(), 'otadoya-backup-'));
  const dumpPath = join(dir, 'backup.dump');
  await execFileAsync('pg_dump', [databaseUrl, '-Fc', '-f', dumpPath]);
  return { dir, dumpPath };
}

async function uploadToR2(client, bucket, dumpPath, stamp) {
  const key = `${PREFIX}otadoya_${stamp}.dump`;
  const body = await readFile(dumpPath);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  return { key, bytes: body.length };
}

async function pruneOldBackups(client, bucket) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }));
  const stale = (listed.Contents ?? []).filter((obj) => obj.LastModified && obj.LastModified.getTime() < cutoff);
  for (const obj of stale) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
  }
  return stale.length;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const endpoint = requireEnv('R2_ENDPOINT');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET_NAME');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

  const { dir, dumpPath } = await dumpDatabase(databaseUrl);
  try {
    const { key, bytes } = await uploadToR2(client, bucket, dumpPath, stamp);
    console.log(`OK: uploaded ${key} (${bytes} bytes)`);

    const pruned = await pruneOldBackups(client, bucket);
    if (pruned > 0) console.log(`Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('BACKUP FAILED:', err);
  process.exit(1);
});
