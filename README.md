# Daily Startup & VC Briefing

직전 24시간 동안 발행된 주요 스타트업·VC·창업 생태계 뉴스를 RSS에서 선별해 정적 HTML로 보여주는 최소 기능 제품(MVP)입니다. 기사 제목·발행일·짧은 요약·출처·링크만 저장하며 기사 전문은 수집하거나 재배포하지 않습니다.

## 작동 구조

1. GitHub Actions 같은 예약 실행 환경이 매일 Node.js 수집 스크립트를 실행합니다.
2. `scripts/collect-news.js`가 RSS를 읽고 최근 24시간 기사만 남깁니다.
3. 키워드 매칭, 출처 allowlist, 점수화, 분류, 유사 제목 중복 제거를 수행합니다.
4. 기본 로컬 규칙 또는 선택형 OpenAI API로 100자 이내 요약을 만듭니다.
5. 결과를 최신용 `data/news.json`과 KST 날짜별 `data/archive/YYYY-MM-DD.json`에 함께 저장합니다.
6. `data/archive/index.json`에 조회 가능한 날짜 목록과 최신 날짜를 기록합니다.
7. `app.js`가 최신 또는 선택한 날짜의 JSON을 읽어 정적 대시보드에 렌더링합니다.

Codex는 이 프로젝트를 만들고 수정하는 **개발 단계에서만** 사용됩니다. 운영 중 매일 실행되는 작업은 일반 Node.js 스크립트이며 Codex가 예약 실행되거나 Codex 크레딧을 사용하지 않습니다. GitHub Actions 대신 Vercel Cron 또는 Netlify Scheduled Functions에서 같은 스크립트를 실행하도록 구성할 수도 있습니다.

## 비용 원칙

- 기본값 `USE_OPENAI_SUMMARY=false`에서는 OpenAI API를 절대 호출하지 않습니다.
- API 키가 없을 때도 OpenAI API를 호출하지 않고 로컬 규칙 요약을 사용합니다.
- 따라서 기본 설정의 매일 수집에는 Codex 크레딧과 OpenAI API 비용이 발생하지 않습니다. 단, 선택한 호스팅·CI 서비스의 자체 사용 한도나 비용은 별도입니다.
- `USE_OPENAI_SUMMARY=true`와 유효한 `OPENAI_API_KEY`를 함께 설정하면 OpenAI API 비용이 별도로 발생합니다.
- ChatGPT Plus 구독 및 Codex 크레딧과 OpenAI API 사용료는 서로 별개의 상품·과금 체계입니다.
- OpenAI 요약에도 기사 전문은 보내지 않고 RSS 제목과 description 일부만 전송합니다. API 실패 시 자동으로 로컬 요약으로 전환합니다.

## 프로젝트 구조

```text
news-briefing-site/
├─ index.html
├─ style.css
├─ app.js
├─ data/
│  ├─ news.json
│  └─ archive/
│     ├─ index.json
│     └─ YYYY-MM-DD.json
├─ scripts/
│  ├─ collect-news.js
│  ├─ sources.js
│  ├─ summarize.js
│  └─ utils.js
├─ .env.example
├─ package.json
├─ README.md
└─ .github/
   └─ workflows/
      └─ daily-news.yml
```

## 설치

Node.js 20 이상과 npm이 필요합니다.

```bash
cd news-briefing-site
npm install
```

실제 비밀값이 담긴 `.env` 파일은 만들지 않습니다. `.env.example`은 필요한 환경변수를 설명하는 예시 파일일 뿐이며, 로컬에서는 현재 셸에 환경변수를 주입하고 GitHub에서는 Secrets/Variables를 사용합니다.

## 뉴스 수집

기본 설정으로 실행합니다.

```bash
npm run collect
```

카테고리당 기사 수를 바꾸거나 allowlist 외 출처를 포함하려면 실행 명령에 환경변수를 전달합니다.

```bash
MAX_ITEMS_PER_CATEGORY=8 ALLOW_UNLISTED_SOURCES=true npm run collect
```

OpenAI API 요약은 명시적으로 두 값을 모두 제공할 때만 켜집니다. 아래 값은 예시 이름이며 실제 키를 코드나 문서에 저장하지 마세요.

```bash
USE_OPENAI_SUMMARY=true OPENAI_API_KEY="현재 셸에 안전하게 주입한 키" npm run collect
```

`OPENAI_MODEL`을 지정하지 않으면 비용·속도를 고려한 소형 모델을 사용합니다. 계정에서 사용할 수 있는 모델과 최신 모델 정보는 [OpenAI 공식 모델 문서](https://developers.openai.com/api/docs/models)를 확인하세요.

## 로컬 화면 확인

브라우저의 `file://` 방식은 JSON `fetch`가 차단될 수 있으므로 로컬 서버를 사용합니다.

```bash
npm run start
```

브라우저에서 `http://localhost:4173`을 엽니다. `npm run preview`도 같은 명령입니다. 기사 수가 0건이어도 통계와 빈 상태 화면이 정상적으로 표시됩니다.

## 날짜별 아카이브

- `data/news.json`: 가장 최근에 수집한 브리핑을 홈페이지에 빠르게 표시하는 최신 데이터입니다.
- `data/archive/YYYY-MM-DD.json`: `generatedAt`의 한국시간(KST) 날짜를 파일명으로 사용한 일별 보관 데이터입니다. 같은 날짜에 다시 수집하면 해당 날짜 파일을 최신 결과로 덮어씁니다.
- `data/archive/index.json`: 저장된 날짜의 오름차순 목록과 `latest` 날짜를 담습니다.

페이지 상단의 **브리핑 날짜** 달력에서 날짜를 고르면 해당 날짜의 통계·수집 기간·기사 카드가 함께 바뀝니다. 선택한 날짜에 파일이 없으면 “해당 날짜의 브리핑 데이터가 없습니다.”가 표시됩니다. **최신 보기**를 누르면 다시 `data/news.json` 기준의 최신 브리핑으로 돌아갑니다. 날짜를 바꾼 뒤에도 카테고리 필터를 그대로 사용할 수 있습니다.

## 수집 설정 수정

### 카테고리와 키워드

`scripts/sources.js`의 `categories` 객체에서 카테고리별 키워드를 추가·삭제합니다. 한 기사가 여러 카테고리에 걸치면 제목과 description에서 가장 높은 점수를 얻은 카테고리 하나만 선택합니다.

점수 기준은 다음과 같습니다.

- 제목의 키워드 일치: 높은 가중치
- RSS description의 키워드 일치: 중간 가중치
- allowlist 출처 및 최신 기사: 가산점
- 지나치게 짧은 제목 및 광고성 표현: 감점
- 최종 출력: 날짜 최신순, 같은 날짜에서는 점수 높은 순

`농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주` 카테고리는 일반 기술 뉴스를 막기 위해 더 엄격하게 선별합니다. 기술 키워드 하나만으로는 수집하지 않으며, 다음 세 조건을 모두 만족해야 합니다.

1. 농식품·딥테크·ESG·AI·반도체·항공우주 기술 키워드가 하나 이상 존재
2. 스타트업·벤처·투자·VC·AC·TIPS·지원사업·데모데이·IR·펀드·선정 등 생태계 키워드가 하나 이상 존재
3. 제목 또는 RSS description에 창업·투자·지원사업·사업화·기업 성장 맥락이 존재

모든 카테고리는 최종 최소 관련성 점수도 통과해야 합니다. 따라서 “AI 반도체 인재 양성” 같은 일반 산업 기사는 제외하고, “반도체 팹리스 스타트업 시리즈A 투자”처럼 창업·투자 맥락이 함께 있는 기사를 우선합니다.

### RSS 소스

`scripts/sources.js`의 `rssSources` 배열에서 `{ name, url }` 형식으로 검색 RSS 또는 직접 RSS를 추가·삭제합니다. 기본 구현은 Google 뉴스 검색 RSS를 사용합니다. 한 RSS에서 네트워크 오류가 나도 다른 RSS 수집은 계속됩니다.

무리한 웹 크롤링이나 기사 본문 파싱은 기본 기능에 포함하지 않았습니다.

### 언론사 allowlist

`scripts/sources.js`의 `allowedSources` 배열에서 언론사·전문지·정부기관·공공기관 이름을 직접 추가하거나 삭제할 수 있습니다. RSS가 제공하는 출처 표기와 배열의 이름이 달라 누락되면 실제 표기에 맞춰 항목을 추가하세요.

기본값 `ALLOW_UNLISTED_SOURCES=false`에서는 allowlist 출처만 저장합니다. `true`로 설정하면 allowlist 외 출처도 후보에 포함되지만, 신뢰도 검토가 필요합니다.

## GitHub Actions 자동 실행

`.github/workflows/daily-news.yml`은 cron `0 0 * * *`로 매일 `00:00 UTC`, 즉 한국시간 `09:00`에 실행됩니다. GitHub Actions cron은 UTC 기준이며, GitHub의 예약 작업은 서비스 상황에 따라 몇 분 지연될 수 있습니다.

자동 실행은 프로젝트를 **GitHub 저장소에 push하고 Actions가 활성화되어 있어야** 동작합니다. 프로젝트가 로컬 폴더에만 있으면 매일 오전 9시 자동 실행은 일어나지 않습니다.

워크플로우는 다음 순서로 동작합니다.

1. Node.js 20 설치
2. `npm install --no-audit --no-fund`
3. `npm run collect`
4. 변경된 `data/news.json`, `data/archive/YYYY-MM-DD.json`, `data/archive/index.json` 자동 커밋 및 푸시

자동 커밋이나 푸시가 권한 문제로 실패하더라도 해당 단계는 경고만 남기고 워크플로우 전체를 치명적으로 중단하지 않습니다.

저장소의 **Settings → Actions → General → Workflow permissions**에서 `Read and write permissions`가 허용되어 있는지 확인하세요. 조직 정책이 쓰기를 막으면 저장소 관리자에게 권한을 요청해야 합니다. `Actions` 화면의 `Daily startup news briefing`에서 `Run workflow`를 눌러 수동 실행할 수도 있습니다.

## GitHub Secrets와 Variables

저장소의 **Settings → Secrets and variables → Actions**에서 설정합니다.

### Secret

- `OPENAI_API_KEY`: 선택값. 기본 로컬 요약 모드에서는 만들 필요가 없습니다.

### Variables

- `USE_OPENAI_SUMMARY`: 기본 `false`. OpenAI 요약 사용 시에만 `true`
- `OPENAI_MODEL`: 선택값. OpenAI 요약 모델 변경 시 사용
- `MAX_ITEMS_PER_CATEGORY`: 기본 `5`
- `ALLOW_UNLISTED_SOURCES`: 기본 `false`

API 키를 Repository Variable, 코드, 커밋, 워크플로우 본문에 직접 넣지 마세요. `USE_OPENAI_SUMMARY=true`여도 `OPENAI_API_KEY` Secret이 비어 있으면 로컬 규칙 요약만 사용합니다.

## 배포

`index.html`, `style.css`, `app.js`, `data/news.json`, `data/archive/`는 정적 파일이므로 GitHub Pages, Vercel, Netlify 등에 배포할 수 있습니다. 매일 수집은 정적 페이지가 아니라 GitHub Actions, Vercel Cron 또는 Netlify Scheduled Function이 Node.js 스크립트를 실행하도록 유지하세요.

GitHub Pages를 사용할 때는 Pages 배포 대상으로 이 프로젝트가 위치한 브랜치·폴더를 선택합니다. 저장소 루트가 이 폴더가 아니라면 배포 설정에서 해당 하위 폴더를 별도로 빌드·게시해야 합니다.

## 데이터와 저작권 주의

- 저장 항목은 제목, 발행일, 100자 이내 요약, 언론사명, 카테고리, 원문 링크, 내부 정렬 점수로 제한합니다.
- 기사 전문, 긴 인용문, 유료 기사 본문을 저장하거나 재배포하지 마세요.
- 각 기사의 저작권과 이용 조건은 원 언론사에 있습니다.
- RSS 제공 정책과 robots/이용약관이 변경되면 해당 소스를 검토하거나 제거하세요.
- 자동 요약은 오류가 있을 수 있으므로 중요한 의사결정 전에는 원문을 확인하세요.
