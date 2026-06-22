#!/usr/bin/env node
// Weekly Pick 콘텐츠 암호화기. 개발계획서 3.1.
//
// src/ 의 평문 JSON 을 AES-256-GCM 으로 암호화해 out 디렉터리에 `.enc` 로 생성한다.
// 출력 포맷(앱의 ContentCipher.kt 와 동일):
//   [ IV(12바이트) | ciphertext | GCM tag(16바이트) ]
//
// 사용법:
//   CONTENT_AES_KEY=<base64 32바이트> node scripts/encrypt.mjs [srcDir] [outDir]
// 키 미지정 시 개발용 기본 키를 사용한다(운영 빌드에서 절대 사용 금지).

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';

const SRC = process.argv[2] ?? 'src';
const OUT = process.argv[3] ?? 'public';

function resolveKey() {
  const b64 = process.env.CONTENT_AES_KEY;
  if (b64) {
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error(`AES-256 키는 32바이트여야 합니다(현재 ${key.length}).`);
    return key;
  }
  // 개발용 기본 키 — app/gradle.properties 의 weeklypick.contentAesKey 와 동일하게 파생.
  console.warn('⚠️  CONTENT_AES_KEY 미지정 — 개발용 기본 키 사용(운영 금지).');
  return createHash('sha256').update('weeklypick-development-key-do-not-use-in-prod').digest();
}

const KEY = resolveKey();

function encrypt(plain /* Buffer */) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16바이트
  return Buffer.concat([iv, ct, tag]);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // .omc, .git 등 숨김 항목 제외
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

async function main() {
  try {
    await stat(SRC);
  } catch {
    console.error(`소스 디렉터리가 없습니다: ${SRC}`);
    process.exit(1);
  }

  const files = await walk(SRC);
  let count = 0;
  for (const file of files) {
    const rel = relative(SRC, file);
    const plain = await readFile(file);
    const enc = encrypt(plain);
    const dest = join(OUT, `${rel}.enc`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, enc);
    count++;
    console.log(`  ✓ ${rel} → ${rel}.enc (${enc.length}B)`);
  }
  console.log(`완료: ${count}개 파일 암호화 → ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
