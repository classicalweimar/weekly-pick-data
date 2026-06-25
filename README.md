# Weekly Pick — 콘텐츠 데이터 저장소

앱이 읽는 **암호화된 콘텐츠**를 GitHub Pages 로 배포하는 저장소입니다.
개발계획서 3장(서버 0원 + 콘텐츠 암호화)을 구현합니다.

## 동작 원리

```
src/ (평문 JSON, push 대상)
  └─ GitHub Actions(build.yml): push 시 AES-256-GCM 암호화
       └─ public/ (.enc 만 생성) ─→ GitHub Pages 배포
            └─ 앱이 .enc 를 내려받아 내장 키로 복호화
```

- **평문(`src/`)은 Pages 로 배포되지 않습니다.** 공개되는 것은 암호문(`.enc`)뿐입니다.
- 브라우저로 `.enc` URL 을 직접 열면 의미 없는 암호문만 보입니다(개발계획서 3.3).

## 디렉터리

```
src/
├── index.json              # 사용 가능한 날짜 목록
├── categories.json         # 카테고리 목록(id, 한글명)
└── data/<YYYY>/<MM>/<YYYY-MM-DD>.json   # 날짜별 콘텐츠
scripts/
├── encrypt.mjs             # src → public 암호화 + static/ 정적 복사
└── notify.mjs              # 배포 후 FCM 토픽 푸시(선택)
static/
└── s/index.html           # 공유 링크 리다이렉트 페이지(암호화 없이 그대로 배포)
.github/workflows/build.yml # 암호화 + Pages 배포 + 알림
```

## 공유 링크(딥링크) — `static/s/`

앱의 공유 버튼은 본문 대신 **https 링크**(`<Pages>/s/?m=&d=&id=`)를 공유합니다.
이 링크는 `static/s/index.html` 로 열리며:

- 앱이 설치돼 있으면 → `weeklypick://content?…` 스킴으로 **앱을 열어** 해당 본문을 펼쳐 보여주고,
- 설치돼 있지 않으면 → **Play 스토어 설치 페이지**로 보냅니다.

카카오톡 인앱 브라우저·일반 모바일 브라우저 모두에서 동작합니다.
`static/` 안의 파일은 암호화 없이 `public/` 으로 복사되어 배포됩니다.

> (선택) **링크를 누르면 리다이렉트 없이 바로 앱**이 열리게 하려면 Android App Links 를 검증해야
> 합니다. 도메인 **루트**(`https://<user>.github.io/.well-known/assetlinks.json`)에
> 앱의 `assetlinks.json` 을 올리세요. 이 파일은 `<user>.github.io` 루트 저장소에 둬야 하며,
> 미검증 상태여도 위의 리다이렉트 경로로 정상 동작합니다.

## 콘텐츠 작성 형식 (개발계획서 3.2)

```jsonc
{
  "date": "2026-06-17",
  "updatedAt": "2026-06-17T09:00:00+09:00",
  "items": [
    { "id": "...", "category": "science", "type": "text",
      "format": "markdown", "title": "...", "body": "...", "tier": "free" },
    { "id": "...", "category": "travel", "type": "youtube",
      "title": "...", "videoId": "abcd1234", "tier": "basic" },
    { "id": "...", "category": "economy", "type": "image",
      "title": "...", "imageUrl": "https://.../x.png", "tier": "free" }
  ]
}
```

- `type`: `text` | `image` | `youtube`
- `format`(text 전용): `markdown` | `html` (HTML 은 앱에서 스크립트 차단 렌더링)
- `tier`: `free` | `basic` (콘텐츠 범위는 동일, 베이직은 광고 제거 — 개발계획서 6.1)

## 로컬에서 암호화 테스트

```bash
# 개발용 기본 키로 암호화(앱 gradle.properties 기본 키와 동일)
node scripts/encrypt.mjs src public

# 운영 키 지정
CONTENT_AES_KEY="<base64 32바이트>" node scripts/encrypt.mjs src public
```

`.enc` 포맷: `[ IV(12바이트) | ciphertext | GCM tag(16바이트) ]`
— 앱의 `ContentCipher.kt` 와 호환됩니다.

## 배포 설정 (운영)

1. 이 디렉터리를 **별도의 GitHub 저장소**(예: `weekly-pick-data`)로 push.
2. 저장소 **Settings → Secrets and variables → Actions** 에 추가:
   - `CONTENT_AES_KEY` : Base64 32바이트 AES 키 (앱 빌드의 `weeklypick.contentAesKey` 와 동일)
   - `FCM_SERVICE_ACCOUNT_BASE64` *(선택)* : Firebase 서비스 계정 JSON 의 Base64
3. **Settings → Pages → Source: GitHub Actions** 로 설정.
4. `src/` 에 콘텐츠를 push 하면 자동으로 암호화·배포되고, 설정 시 FCM 알림이 발송됩니다.
5. 앱의 `gradle.properties` `weeklypick.contentBaseUrl` 을 배포된 Pages URL
   (예: `https://<user>.github.io/weekly-pick-data/`)로 맞춥니다.

> ⚠️ 운영 키는 개발용 기본 키와 **반드시 다르게** 생성하세요:
> `openssl rand -base64 32`
