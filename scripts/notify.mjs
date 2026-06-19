#!/usr/bin/env node
// FCM HTTP v1 토픽 푸시. 개발계획서 5.3.
// GitHub Actions 가 콘텐츠 배포 후 'updates' 토픽으로 알림을 보낸다.
//
// 필요 환경변수:
//   FCM_SA_KEY  : Firebase 서비스 계정 JSON 을 Base64 로 인코딩한 값
//   FCM_TOPIC   : 보낼 토픽(기본 'updates')
//
// 외부 의존성 없이 Node 내장 crypto 로 JWT 를 서명해 OAuth 토큰을 발급받는다.

import { createSign } from 'node:crypto';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const b64 = process.env.FCM_SA_KEY;
  if (!b64) {
    console.log('FCM_SA_KEY 미설정 — 알림 발송을 건너뜁니다.');
    return;
  }
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const topic = process.env.FCM_TOPIC || 'updates';
  const token = await getAccessToken(sa);

  const message = {
    message: {
      topic,
      notification: {
        title: 'Weekly Pick 업데이트',
        body: '오늘의 Weekly Pick이 업데이트됐어요.',
      },
      android: { priority: 'HIGH' },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    },
  );
  if (!res.ok) throw new Error(`FCM 발송 실패: ${res.status} ${await res.text()}`);
  console.log(`FCM 발송 완료 → topic=${topic}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
