#!/usr/bin/env node
// Weekly Pick 예약 발행기(promote). 데스크톱 도구가 staging/ 에 올려둔 콘텐츠 중
// publishAt(예약 시각)이 지난 것을 src/ 로 옮겨 "발행 대기" 상태로 만든다.
//
// 동작:
//   1) staging/<market>/<yyyy-MM-dd>/<itemId>.json 들을 읽는다.
//        포맷: { publishAt: ISO8601, market, date: "yyyy-MM-dd", item: {ContentItem} }
//   2) publishAt <= now 인 항목만 골라, 해당 날짜의
//        src/<market>/data/<yyyy>/<MM>/<date>.json 에 item.id 기준으로 upsert 한다.
//        (파일이 없으면 {date, items:[]} 로 새로 만든다)
//   3) 발행한 staging 파일은 삭제한다(같은 커밋에 반영 → 재실행 시 중복 발행 없음).
//   4) 발행된 (market, category) 쌍을 promote-targets.json 으로 남긴다(notify.mjs 용).
//
// 커밋/푸시와 이후 암호화·배포·알림은 워크플로우(publish-scheduled.yml)가 담당한다.
// 이 스크립트는 파일 변경과 promote-targets.json 출력까지만 한다.
//
// 사용법:  node scripts/promote.mjs [stagingDir] [srcDir]
// 종료코드: 항상 0. 발행한 항목이 없으면 아무 파일도 바꾸지 않는다.

import { readdir, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STAGING = process.argv[2] ?? 'staging';
const SRC = process.argv[3] ?? 'src';
const TARGETS_OUT = 'promote-targets.json';

/** staging 디렉터리 아래의 모든 .json 경로를 모은다(숨김 항목 제외). */
async function walkJson(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // staging 디렉터리가 없으면 빈 목록.
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkJson(p)));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  // 들여쓰기 2칸 + 끝 개행 — 기존 src JSON 스타일과 맞춘다.
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n');
}

/** "yyyy-MM-dd" → src/<market>/data/<yyyy>/<MM>/<date>.json */
function srcPathFor(market, date) {
  const [y, m] = date.split('-');
  return join(SRC, market, 'data', y, m, `${date}.json`);
}

/** items 배열에서 같은 id 가 있으면 교체, 없으면 추가(upsert). */
function upsertItem(items, item) {
  const idx = items.findIndex((it) => it && it.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
}

async function main() {
  const now = Date.now();
  const files = await walkJson(STAGING);

  // publishAt 이 지난 항목만 추린다(파싱 불가/미래는 건너뜀).
  const due = [];
  for (const file of files) {
    let entry;
    try {
      entry = await readJson(file);
    } catch {
      console.warn(`  ! 파싱 불가 — 건너뜀: ${file}`);
      continue;
    }
    const at = Date.parse(entry.publishAt);
    if (Number.isNaN(at)) {
      console.warn(`  ! publishAt 형식 오류 — 건너뜀: ${file}`);
      continue;
    }
    if (at <= now) due.push({ file, entry });
  }

  if (due.length === 0) {
    console.log('발행할 예약 콘텐츠가 없습니다(due 0건).');
    return;
  }

  // (market, date) 별로 묶어 한 날짜 파일을 한 번만 읽고 쓴다.
  const byDay = new Map(); // "market|date" → { market, date, entries:[] }
  for (const d of due) {
    const { market, date } = d.entry;
    if (!market || !date) {
      console.warn(`  ! market/date 누락 — 건너뜀: ${d.file}`);
      continue;
    }
    const key = `${market}|${date}`;
    if (!byDay.has(key)) byDay.set(key, { market, date, entries: [] });
    byDay.get(key).entries.push(d);
  }

  const nowIso = new Date(now).toISOString();
  const targets = new Map(); // "market|category" → { market, category }
  let promoted = 0;

  for (const { market, date, entries } of byDay.values()) {
    const path = srcPathFor(market, date);
    let day;
    try {
      await stat(path);
      day = await readJson(path);
    } catch {
      day = { date, items: [] };
    }
    if (!Array.isArray(day.items)) day.items = [];

    for (const { entry } of entries) {
      if (!entry.item || !entry.item.id) {
        console.warn(`  ! item/id 누락 — 건너뜀: ${entry.date}`);
        continue;
      }
      upsertItem(day.items, entry.item);
      if (entry.item.category) {
        targets.set(`${market}|${entry.item.category}`, {
          market,
          category: entry.item.category,
        });
      }
      promoted++;
    }
    day.updatedAt = nowIso;
    await writeJson(path, day);
    console.log(`  ✓ ${market}/${date} ← ${entries.length}건 발행 → ${path}`);

    // 발행 완료한 staging 파일 제거.
    for (const { file } of entries) {
      await rm(file, { force: true });
    }
  }

  const targetList = [...targets.values()];
  await writeFile(TARGETS_OUT, JSON.stringify(targetList) + '\n');
  console.log(`완료: ${promoted}건 발행, 알림 대상 ${targetList.length}건 → ${TARGETS_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
