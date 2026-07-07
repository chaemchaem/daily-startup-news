# Daily Startup & VC Briefing

한국시간 09:00 기준 최근 48시간 동안 발행된 주요 스타트업·VC·창업 생태계 뉴스를 RSS에서 선별해 정적 HTML로 보여주는 최소 기능 제품(MVP)입니다. 최종 후보 기사의 본문은 요약을 만들 때만 일시적으로 읽으며, 기사 제목·발행일·요약·출처·링크 등 제한된 정보만 저장합니다.

## 작동 구조

1. GitHub Actions 같은 예약 실행 환경이 매일 Node.js 수집 스크립트를 실행합니다.
2. `scripts/collect-news.js`가 직접 RSS와 제한형 공식 목록 페이지(`primary`)를 읽고 한국시간 09:00 기준 최근 48시간 기사만 남깁니다.
3. 키워드 매칭, 출처 allowlist, 점수화, 분류, 유사 제목 중복 제거를 수행합니다.
4. 검색 discovery는 기본적으로 사용하지 않으며, `ENABLE_DISCOVERY_FALLBACK=true`일 때 강한 연결의 국내 후보가 부족한 경우에만 보조합니다.
5. 최종 후보에 한해 기사 페이지에서 본문 추출을 시도하고 광고·저작권·추천기사 문구를 제거합니다.
6. 본문이 추출되고 OpenAI 설정이 유효하면 Responses API로 먼저 요약하며, 실패하거나 꺼져 있으면 로컬 추출형 요약으로 전환합니다.
7. 결과를 최신용 `data/news.json`과 KST 날짜별 `data/archive/YYYY-MM-DD.json`에 함께 저장합니다.
8. `data/archive/index.json`에 조회 가능한 날짜 목록과 최신 날짜를 기록합니다.
9. `app.js`가 최신 또는 선택한 날짜의 JSON을 읽어 정적 대시보드에 렌더링합니다.

Codex는 이 프로젝트를 만들고 수정하는 **개발 단계에서만** 사용됩니다. 운영 중 매일 실행되는 작업은 일반 Node.js 스크립트이며 Codex가 예약 실행되거나 Codex 크레딧을 사용하지 않습니다. GitHub Actions 대신 Vercel Cron 또는 Netlify Scheduled Functions에서 같은 스크립트를 실행하도록 구성할 수도 있습니다.

## OpenAI 요약과 비용 원칙

- 기본값 `USE_OPENAI_SUMMARY=false`에서는 무료 `local_extractive` 요약을 사용하며 OpenAI API를 호출하지 않습니다.
- `USE_OPENAI_SUMMARY=true`, 유효한 `OPENAI_API_KEY`, 300자 이상의 추출 본문이 모두 있으면 OpenAI Responses API 요약을 우선 사용합니다.
- API 키가 없거나 OpenAI 호출이 실패하면 `local_extractive → description → titleFallback` 순서로 자동 전환합니다. 키가 없어도 수집 전체는 중단되지 않습니다.
- 본문 추출에 실패해도 RSS description이 충분하면 title+description을 OpenAI에 보내며, 성공 결과는 `openai_description`으로 저장합니다.
- OpenAI 호출이나 결과 검증이 실패해도 전체 수집은 중단되지 않고 로컬 fallback으로 전환됩니다.
- OpenAI API 사용료는 ChatGPT Plus 구독 및 Codex 크레딧과 별개입니다.
- 비용을 쓰지 않으려면 `USE_OPENAI_SUMMARY=false`로 설정하세요. 호스팅·CI 서비스의 자체 사용 한도나 비용은 별도입니다.
- 본문 추출에 성공한 상태에서 OpenAI 요약을 켜면 제목·출처·카테고리·RSS description·정제된 본문 일부를 API 요청에 사용합니다. API 실패 시 자동으로 로컬 요약으로 전환합니다.

## 프로젝트 구조

```text
news-briefing-site/
├─ index.html
├─ style.css
├─ app.js
├─ data/
│  ├─ news.json
│  ├─ summary-cache.json
│  └─ archive/
│     ├─ index.json
│     └─ YYYY-MM-DD.json
├─ scripts/
│  ├─ collect-news.js
│  ├─ article-extractor.js
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

Node.js 20 이상과 pnpm 11.7 이상이 필요합니다. 이 프로젝트는 `pnpm-lock.yaml`과 `packageManager` 필드를 기준으로 pnpm만 사용합니다.

```bash
cd news-briefing-site
corepack enable
pnpm install --frozen-lockfile
```

`npm install`을 실행하지 마세요. pnpm이 만든 `node_modules`에 npm을 섞으면 설치 메타데이터 오류가 발생할 수 있습니다. 현재 저장소에는 `package-lock.json`이 없어야 하며, `node_modules/.pnpm`은 정상적인 pnpm 설치 구조입니다. `pnpm-workspace.yaml`은 커밋된 lockfile을 신뢰하고 프로젝트 내부 가상 저장소를 사용하도록 고정합니다.

일반 설치는 `pnpm install --frozen-lockfile`을 사용합니다. `package.json`의 의존성을 의도적으로 바꾼 경우에만 `pnpm install --no-frozen-lockfile`로 `pnpm-lock.yaml`을 갱신하고, lockfile 변경 내용을 함께 검토·커밋합니다. 설치 복구를 위해 `node_modules` 삭제가 필요한 상황이라면 먼저 백업 여부를 확인하고 사용자 승인을 받은 뒤 진행하세요.

저장소에는 실제 비밀값이 담긴 `.env`를 커밋하지 않습니다. 이 프로젝트의 `.gitignore`에는 `.env`가 포함되어 있으며, 제공되는 `.env.example`에는 비밀값이 없습니다.

### 로컬 OpenAI 설정

1. [OpenAI Platform API keys](https://platform.openai.com/api-keys)에서 API 키를 발급합니다.
2. 프로젝트 루트에서 `.env.example`을 복사해 로컬 전용 `.env`를 만듭니다.
3. 아래처럼 설정하고 `pnpm run collect`를 실행합니다.

```bash
cp .env.example .env
```

```dotenv
USE_OPENAI_SUMMARY=true
OPENAI_API_KEY=발급받은_API_키
OPENAI_SUMMARY_MODEL=gpt-5.4-mini
USE_FULL_TEXT_EXTRACTION=true
```

수집 스크립트는 프로젝트 루트의 `.env`를 자동으로 읽되, 이미 셸이나 GitHub Actions에서 주입한 환경변수는 덮어쓰지 않습니다. API 키는 코드, `.env.example`, Git 커밋, GitHub Repository Variable에 넣지 마세요. `.env`가 Git 추적 대상이 아닌지 커밋 전에 반드시 확인하세요.

OpenAI API 계정에는 분당 요청 수(RPM), 분당 토큰 수(TPM), 일일 요청 수(RPD) 제한이 적용될 수 있습니다. 이 프로젝트는 body와 description 재요약을 포함한 모든 OpenAI 요청을 하나의 순차 큐로 처리하며 기본 7초 간격을 둡니다. `OPENAI_REQUEST_DELAY_MS`로 간격을 조정할 수 있습니다.

- RPM 429는 오류의 대기 시간이 짧을 때만 20초, 40초 간격을 기준으로 재시도합니다. 횟수는 `OPENAI_MAX_RETRIES`로 조정합니다.
- TPM 429의 `Please try again in ...`을 파싱합니다. 120초 이하면 표시된 시간 이상 기다린 뒤 재시도하고, 120초를 넘거나 시간을 확인할 수 없으면 남은 OpenAI 호출을 즉시 중단해 캐시 또는 로컬 fallback으로 전환합니다.
- RPD 429는 기다려도 당일에 해소되지 않으므로 재시도하지 않고, 해당 실행의 남은 OpenAI 호출을 즉시 중단해 로컬 fallback으로 전환합니다.
- `OPENAI_DAILY_CALL_BUDGET`은 한 번의 수집 실행에서 허용할 실제 API 호출 수입니다. 개발 기본값은 12이며 재시도 호출도 예산에 포함됩니다. 운영 계정 한도가 충분하면 20으로 올릴 수 있습니다.
- `OPENAI_BODY_MAX_ITEMS`은 본문 추출 성공 기사 중 새 OpenAI body 요약을 요청할 최대 건수이며 기본값은 8입니다. 캐시 적중은 이 한도와 API 호출 예산을 사용하지 않습니다.
- `OPENAI_ARTICLE_TEXT_MAX_CHARS`는 API에 보내는 정제 본문 구간의 상한이며 기본값은 3,500자입니다. 본문 앞 1,500자와 투자·라운드·펀드·선정·지원·실증 등 핵심 문장 최대 8개만 조합합니다.
- `OPENAI_DESCRIPTION_MAX_ITEMS`은 본문이 없는 기사 중 OpenAI description 요약을 새로 요청할 최대 건수입니다. 기본값은 6입니다.
- 성공한 OpenAI 요약은 `data/summary-cache.json`에 저장됩니다. 같은 URL·제목·description·요약 유형이면 다음 실행에서 API를 다시 부르지 않습니다. 캐시는 최근 30일, 최대 500건만 유지하며 기사 본문은 저장하지 않습니다.

요청 간 대기와 RPM 재시도로 뉴스 수집에 1~3분 이상 걸릴 수 있으며 안정적인 요약을 위한 정상 동작입니다.

## 뉴스 수집

기본 설정으로 실행합니다.

```bash
pnpm run collect
```

기사 유형별 선별 회귀 테스트는 다음 명령으로 실행합니다.

```bash
pnpm run test:selection
```

기본값은 `USE_FULL_TEXT_EXTRACTION=true`로, 1차 선별이 끝난 최종 후보 기사에 대해서만 본문 추출을 시도합니다. 추출을 끄려면 다음처럼 실행합니다.

```bash
USE_FULL_TEXT_EXTRACTION=false pnpm run collect
```

카테고리당 기사 수를 바꾸거나 allowlist 외 출처를 포함하려면 실행 명령에 환경변수를 전달합니다.

```bash
MAX_ITEMS_PER_CATEGORY=8 ALLOW_UNLISTED_SOURCES=true pnpm run collect
```

OpenAI API 요약은 명시적으로 두 값을 모두 제공할 때만 켜집니다. 실제 키를 코드나 문서에 저장하지 마세요.

```bash
USE_FULL_TEXT_EXTRACTION=true USE_OPENAI_SUMMARY=true OPENAI_API_KEY="현재 셸에 안전하게 주입한 키" pnpm run collect
```

`OPENAI_SUMMARY_MODEL`을 지정하지 않으면 비용·속도를 고려한 소형 모델 `gpt-5.4-mini`를 사용합니다. 계정에서 사용할 수 있는 모델과 최신 모델 정보는 [OpenAI 공식 모델 문서](https://developers.openai.com/api/docs/models)를 확인하세요.

## 기사 본문 추출과 요약 품질

RSS 제목과 description만 사용한 요약은 기사 배경·목적·성과를 충분히 담지 못할 수 있습니다. 그래서 원문 링크를 제공하는 직접 RSS를 우선 사용합니다. `USE_FULL_TEXT_EXTRACTION=true`이면 최종 후보 기사 URL에만 접근하고, Node.js 내장 `fetch`와 HTML 의미 태그(`article`, `main`, 본문 문단)를 이용해 본문을 정제한 뒤 로컬 핵심문장 추출 요약에 사용합니다.

OpenAI 설정이 유효하면 제목·출처·카테고리·description과 정제된 핵심 본문 구간을 API에 보내 100자 이내 한국어 요약을 생성합니다. 본문 입력은 기본 3,500자 이하이며, 앞부분 1,500자와 핵심 키워드 문장 최대 8개로 구성합니다. 본문이 없으면 핵심 사건이 명확한 title과 짧은 description도 사용할 수 있습니다. 본문 요약은 제목 유사도 80% 기준을 적용하고, description 요약은 30~100자·사건 동사·보고서식 종결을 요구하되 제목과 완전히 같거나 조사만 바꾼 복붙만 차단합니다. 메타 문구·입력에 없는 수치 또는 라운드가 있으면 한 번 재요약한 뒤 실패 시 로컬로 전환합니다.

무료 `local_extractive` 요약은 본문을 한국어 문장 단위로 나눈 뒤 제목과의 핵심어 중첩, 투자금액·라운드·펀드·TIPS·선정·지원·실증·기관명·기업명·본문 위치를 점수화합니다. 기자명·이메일·사진설명·입력일·수정일·저작권·관련기사·로그인·구독·공유·광고 문장은 제외하고, 완결된 핵심문장 1~2개를 원문에서 그대로 선택합니다. 새 사실이나 문장을 생성하지 않습니다.

영어 로컬 추출 요약은 60~100자이며 사건 동사와 완결 문장부호가 있는 문장만 허용합니다. 짧거나 중간에서 잘린 본문 문장은 버리고 완결된 RSS description을 다시 시도하며, 그것도 없으면 기본 `MAX_TITLE_FALLBACK_ITEMS=0` 정책에 따라 저장하지 않습니다.

- Google News RSS는 `news.google.com/rss/articles/...` 중계 링크를 제공하므로 원문 URL 해석이나 본문 추출이 실패할 수 있습니다. 기본 설정에서는 비활성화되며 `ENABLE_DISCOVERY_FALLBACK=true`일 때만 discovery 소스로 사용합니다.
- Google News 중계 링크는 HTTP redirect, canonical URL, `og:url`, meta refresh, Google News URL 해석 요청 순으로 원문을 확인합니다. 원문 언론사 URL을 확인하지 못하면 본문 추출과 최종 저장에서 제외합니다.
- 기사 전문은 메모리에서 요약 입력으로만 사용하고 `data/news.json`, 아카이브 JSON, HTML 화면에 저장하거나 노출하지 않습니다.
- `data/summary-cache.json`에도 기사 전문은 저장하지 않습니다. 제목, URL, description 해시, 요약, 요약 출처, 생성 시각만 보관합니다.
- 광고, 기자 이메일, 저작권 고지, 관련·추천기사, 댓글, SNS 공유 문구를 제거합니다.
- 정제 후 기본 300자 미만인 본문은 실패로 처리합니다.
- timeout과 동시 요청 수를 제한해 언론사에 과도하게 요청하지 않습니다.
- paywall, 로그인, 403/404, robots·이용 정책 또는 동적 렌더링 때문에 실패하면 우회하지 않습니다.
- 본문 추출 실패 시 RSS description으로 fallback할 수 있습니다. description도 부족한 제목 기반 요약은 기본 설정에서 저장하지 않습니다.

수집 로그에는 실패 URL과 `http_403`, `timeout`, `dns_error`, `unsupported_content_type`, `extracted_text_too_short`, `google_batch_http_*`, `google_news_redirect_unresolved` 같은 원인을 표시합니다. 사이트의 접근 정책을 우회하지 않고 실패 지점을 판단하기 위한 진단 정보입니다.

저장되는 `summarySource`는 요약에 사용한 최선의 입력을 나타냅니다.

- `local_extractive`: 무료 로컬 엔진이 정제된 기사 본문에서 완결된 핵심문장을 추출함
- `extractive_body`: 이전 버전 로컬 요약과의 호환용 값
- `openai_description`: 본문 추출 실패 후 OpenAI가 title+description으로 요약함
- `description`: RSS 제목과 description을 사용함
- `titleFallback`: 제목 정보만 사용함. 점수를 낮춰 우선순위를 떨어뜨림
- `openai_body`: OpenAI API가 추출 본문을 바탕으로 요약하고 검증까지 통과함

Google News 중계 링크가 실제 언론사 링크로 확인된 항목은 `url`에 원문 URL을 사용하고, 진단용 `resolvedUrl`에도 해당 URL을 기록합니다. 기사 본문 자체는 어떤 JSON 필드에도 기록하지 않습니다.

저장 직전에 제목과 요약의 토큰·문자 유사도를 검사합니다. 유사도가 80% 이상이면 저장하지 않습니다. `titleFallback`은 기본 0건이며 `MAX_TITLE_FALLBACK_ITEMS=1`을 명시한 경우에만 마지막 수단으로 1건 허용합니다.

저장 우선순위는 `openai_body → openai_description → local_extractive → description → titleFallback`입니다. 각 기사에는 `summarySource`와 같은 값을 가진 `summaryType`도 저장합니다. 요약 후에는 기업명·투자금액·라운드·주요 사건을 비교해 같은 사건을 다시 다룬 기사를 제거하고 더 높은 summarySource를 남깁니다. 기사 전문은 어느 경로에서도 JSON에 저장하지 않습니다.

## 로컬 화면 확인

브라우저의 `file://` 방식은 JSON `fetch`가 차단될 수 있으므로 로컬 서버를 사용합니다.

```bash
pnpm run start
```

브라우저에서 `http://localhost:4173`을 엽니다. `pnpm run preview`도 같은 명령입니다. 기사 수가 0건이어도 통계와 빈 상태 화면이 정상적으로 표시됩니다.

## 날짜별 아카이브

- `data/news.json`: 가장 최근에 수집한 브리핑을 홈페이지에 빠르게 표시하는 최신 데이터입니다.
- `data/archive/YYYY-MM-DD.json`: `generatedAt`의 한국시간(KST) 날짜를 파일명으로 사용한 일별 보관 데이터입니다. 같은 날짜에 다시 수집하면 해당 날짜 파일을 최신 결과로 덮어씁니다.
- `data/archive/index.json`: 저장된 날짜의 오름차순 목록과 `latest` 날짜를 담습니다.

페이지 상단의 **브리핑 날짜** 달력에서 날짜를 고르면 해당 날짜의 통계·수집 기간·기사 카드가 함께 바뀝니다. 선택한 날짜에 파일이 없으면 “해당 날짜의 브리핑 데이터가 없습니다.”가 표시됩니다. **최신 보기**를 누르면 다시 `data/news.json` 기준의 최신 브리핑으로 돌아갑니다. 날짜를 바꾼 뒤에도 카테고리 필터를 그대로 사용할 수 있습니다.

## 수집 설정 수정

### 카테고리와 키워드

`scripts/sources.js`의 `categories` 객체에서 카테고리별 키워드를 추가·삭제합니다. 한 기사가 여러 카테고리에 걸치면 제목과 description에서 가장 높은 점수를 얻은 카테고리 하나만 선택합니다.

선별은 두 단계로 처리합니다.

1. 넓은 후보 단계에서는 스타트업·창업·벤처·투자·지원·정책·실증·기술·자금조달·회수시장 등 단서가 하나라도 있으면 후보로 남깁니다.
2. 최종 단계에서는 기사 주체, 사건 유형, 출처 신뢰도, 최신성, 본문에서 확인된 맥락과 명백한 제외 사유를 함께 점수화합니다.

주요 점수 기준은 다음과 같습니다.

- 제목의 키워드 일치: 높은 가중치
- RSS description의 키워드 일치: 중간 가중치
- allowlist 출처 및 최신 기사: 가산점
- 지나치게 짧은 제목 및 광고성 표현: 감점
- 투자유치·라운드·펀드결성·출자·TIPS/LIPS: 높은 가산점
- 창업지원·사업화·글로벌 진출·판로·데모데이·오픈이노베이션: 가산점
- PoC·실증·규제특례·딥테크 스타트업 사업화: 가산점
- 회수시장·자금조달·IPO/M&A·세컨더리·벤처투자 정책과 제도: 가산점
- 최종 출력: 관련성 점수와 요약 품질을 반영해 하루 10~15건 목표

`농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주` 카테고리도 초반에는 넓게 후보로 수집합니다. 다만 최종 단계에서는 스타트업 주체, 투자환경, 실증, 사업화, 규제환경, 시장진입 중 하나와 연결되어야 합니다. 일반 AI 제품 소개나 반도체 산업 전망은 제외하지만, 같은 산업 기사라도 스타트업의 투자·사업기회·실증·자금조달과 직접 연결되면 통과할 수 있습니다.

명백한 증시 시황, 주가 급등락, 일반 실적 발표, 대기업 일반 사업, 소비자 제품 소개, 사건 없는 칼럼·조언 글은 제외합니다. 반면 상장·증권사·운용사·세제·규제·개인투자자 같은 표현은 그것만으로 제외하지 않고, 벤처기업 자금조달이나 창업 생태계와의 연결 여부를 확인합니다.

국내 기사는 기본 최소 8건, 전체는 최소 10건을 목표로 하며 최대 15건을 저장합니다. 엄격 기준으로 목표에 미달하면 명백한 제외 사유가 없고 완화 점수를 넘은 국내 후보부터 보충합니다. 숫자를 맞추기 위해 무관한 기사를 넣지는 않습니다.

로컬 개발에서는 `data/debug/candidates-YYYY-MM-DD.json`에 후보 리포트를 저장합니다. 제목·출처·URL·날짜·카테고리·점수·포함/제외 사유·매칭 신호·국내 여부·최종 선택 여부와 A~E 강한 연결 유형, 상장사/대기업 여부, 일반 산업 여부, 부족한 연결 신호를 기록합니다. 기사 본문은 저장하지 않습니다. `SAVE_DEBUG_CANDIDATES=false`로 끌 수 있고 CI에서는 기본적으로 생성하지 않습니다.

강한 연결 유형은 다음 의미입니다.

- A: 기사 대상이 스타트업·창업기업·벤처기업·초기기업임
- B: VC·AC·정부·공공기관·창업지원기관이 창업·벤처 대상을 지원하거나 투자함
- C: 투자·펀드·자금조달이 비상장기업·스타트업·벤처 생태계와 연결됨
- D: 지원사업·정책·규제·세제가 창업기업이나 벤처투자 생태계에 직접 영향을 줌
- E: 대기업·공공기관이 스타트업과 오픈이노베이션·PoC·실증·투자 연계를 수행함

### 직접 수집 소스

`scripts/sources.js`의 `sourceFeeds` 배열에서 RSS, 공식 기사 목록, sitemap, 검색 목록과 Google News discovery RSS를 관리합니다. 각 소스는 다음 공통 구조를 가집니다.

```js
{
  name: "매체명",
  enabled: true,
  type: "rss",
  feedUrl: "공식 RSS URL",
  listUrl: null,
  sitemapUrl: null,
  baseUrl: "https://example.com",
  allowedUrlPatterns: ["^https://example\\.com/news/"],
  categoryHints: ["VC / AC", "스타트업 / 벤처기업 / 초기창업"],
  articleLinkSelector: "a[href]",
  titleSelector: "meta[property='og:title'], h1",
  dateSelector: "meta[property='article:published_time'], time[datetime]",
  bodySelector: ".article-body, article",
  removeSelectors: [".advertisement", ".related-news", ".reporter"],
  maxItems: 20,
  sourceWeight: 8,
  fetchDelayMs: 700,
  priority: "primary",
  region: "domestic",
}
```

`type`은 `rss`, `html_list`, `sitemap`, `search_page` 중 하나입니다. RSS가 있는 매체는 RSS를 우선 사용하며, `fallbackFor`가 지정된 HTML 목록은 같은 매체의 RSS 원본 수가 기준보다 적을 때만 실행됩니다. 목록 수집은 `allowedUrlPatterns`, `maxItems`, timeout, `fetchDelayMs`로 제한합니다. 사이트의 `robots.txt`에서 금지된 목록·기사 경로는 요청하지 않습니다.

실행 시 사용하는 `sourceFeeds`에는 RSS·HTML 목록 방식이 실제로 구성된 활성 소스만 들어갑니다. 공식 URL이나 상세 링크 추출 방식을 확인하지 못한 이름은 `disabledSources`로 분리되어 수집 통계와 primary 개수에 포함되지 않습니다. 스타트업·투자 전문매체와 공공기관에는 높은 `sourceWeight`를 부여하고, 종합·경제지는 강한 연결 조건을 확인합니다.

VentureBeat는 기존 `feeds.venturebeat.com`의 인증서 불일치 때문에 공식 도메인의 `https://venturebeat.com/feed/`를 사용합니다. 한국벤처투자 보도자료 목록은 서버 응답에 상세 기사 `<a href>`가 노출되지 않아 현재 `html_list` 방식으로 0건이 수집되므로 비활성화했습니다. 상세 링크를 임의로 조합하지 않으며, 공식 API나 서버 렌더링 링크가 확인될 때 다시 활성화해야 합니다.

주소를 점검할 때는 [뉴시스 RSS 안내](https://www.newsis.com/RSS/), [한국벤처투자 보도자료](https://www.kvic.or.kr/notice/kvic-news/press-release), [창업진흥원 보도자료](https://www.kised.or.kr/board.es?bid=0006&list_no=&mid=a10305000000&tag=), [VentureBeat RSS 안내](https://venturebeat.com/business/venturebeat-rss/), [Crunchbase News](https://news.crunchbase.com/), [플래텀](https://platum.kr/), [와우테일](https://wowtale.net/), [바이라인네트워크](https://byline.network/) 같은 공식 페이지를 기준으로 다시 확인하세요.

RSS URL을 경로 규칙만 보고 임의로 만들지 마세요. 각 매체의 공식 RSS 안내나 공식 보도자료·기사 목록 페이지에서 현재 주소와 이용 조건을 확인한 뒤 추가해야 합니다. 공식 주소나 자동 수집 허용 범위를 확인하지 못한 매체는 `enabled: false` 상태로 유지합니다. 한 소스에서 네트워크 오류가 발생해도 다른 소스 수집은 계속됩니다.

Google News는 중계 URL 때문에 본문 추출 성공률이 낮으므로 기본값 `ENABLE_DISCOVERY_FALLBACK=false`에서는 요청하지 않습니다. `true`로 설정하면 강한 연결의 primary 또는 국내 후보가 목표보다 부족할 때 투자·지원·정책·실증·회수시장·딥테크 스타트업 discovery 검색을 실행합니다. 검색 결과는 후보 발견용일 뿐이며 원문 언론사 URL 해석에 실패한 `news.google.com` 링크는 최종 저장하지 않습니다.

수집기는 목록 페이지를 무리하게 크롤링하지 않습니다. source별 최대 개수와 지연 시간을 지키고, 기사 링크는 허용 URL 패턴으로 제한하며, 최종 후보의 원문만 제한된 동시 요청 수로 읽습니다. source별 `bodySelector`를 먼저 사용하고 충분한 본문을 얻지 못했을 때만 공통 의미 태그 추출로 전환합니다.

### 언론사 allowlist

`scripts/sources.js`의 `allowedSources` 배열에서 언론사·전문지·정부기관·공공기관 이름을 직접 추가하거나 삭제할 수 있습니다. RSS가 제공하는 출처 표기와 배열의 이름이 달라 누락되면 실제 표기에 맞춰 항목을 추가하세요.

기본값 `ALLOW_UNLISTED_SOURCES=false`에서는 allowlist 출처만 저장합니다. `true`로 설정하면 allowlist 외 출처도 후보에 포함되지만, 신뢰도 검토가 필요합니다.

## GitHub Actions 자동 실행

`.github/workflows/daily-news.yml`은 cron `15 0 * * *`로 매일 `00:15 UTC`, 즉 한국시간 `09:15`에 실행됩니다. GitHub Actions cron은 UTC 기준이며, GitHub의 예약 작업은 서비스 상황에 따라 몇 분 지연될 수 있어 정각을 피했습니다. 실제 데이터 수집 기간은 실행 시각과 별개로 한국시간 `09:00` 기준 최근 48시간으로 고정됩니다.

자동 실행은 프로젝트를 **GitHub 저장소에 push하고 Actions가 활성화되어 있어야** 동작합니다. 프로젝트가 로컬 폴더에만 있으면 매일 오전 9시 15분 자동 실행은 일어나지 않습니다.

워크플로우는 다음 순서로 동작합니다.

1. Node.js 20 설치
2. pnpm 11.7 설정
3. `pnpm install --frozen-lockfile`
4. `pnpm run collect`
5. 변경된 `data/news.json`, `data/archive/YYYY-MM-DD.json`, `data/archive/index.json`, `data/summary-cache.json` 자동 커밋 및 푸시

자동 커밋이나 푸시가 권한 문제로 실패하더라도 해당 단계는 경고만 남기고 워크플로우 전체를 치명적으로 중단하지 않습니다.

저장소의 **Settings → Actions → General → Workflow permissions**에서 `Read and write permissions`가 허용되어 있는지 확인하세요. 조직 정책이 쓰기를 막으면 저장소 관리자에게 권한을 요청해야 합니다. `Actions` 화면의 `Daily startup news briefing`에서 `Run workflow`를 눌러 수동 실행할 수도 있습니다.

## GitHub Secrets와 Variables

저장소의 **Settings → Secrets and variables → Actions**에서 설정합니다.

### Secret

- `OPENAI_API_KEY`: OpenAI 요약을 사용할 때 필요한 비밀값. 반드시 Repository Secret으로 저장

### Variables

- `USE_OPENAI_SUMMARY`: OpenAI 요약을 우선 사용할 때 `true`; 비용 없이 로컬 fallback만 사용하려면 `false`
- `OPENAI_SUMMARY_MODEL`: 선택값. 기본 `gpt-5.4-mini`
- `OPENAI_REQUEST_DELAY_MS`: 기본 `7000`. body·description·재요약을 포함한 모든 API 요청 사이 간격
- `OPENAI_MAX_RETRIES`: 기본 `2`. 짧은 RPM/TPM 429 대기에만 적용하며 장시간 TPM·RPD 429에는 적용하지 않음
- `OPENAI_DAILY_CALL_BUDGET`: 개발 기본 `12`. 한 번의 수집 실행에서 허용할 실제 OpenAI API 호출 수. 운영 시 필요하면 `20`으로 조정 가능
- `OPENAI_ARTICLE_TEXT_MAX_CHARS`: 기본 `3500`. API에 보내는 핵심 본문 구간의 최대 글자 수
- `OPENAI_BODY_MAX_ITEMS`: 기본 `8`. 새 OpenAI body 요약을 시도할 최대 기사 수
- `OPENAI_DESCRIPTION_MAX_ITEMS`: 기본 `6`. 본문 없는 기사에 새로 시도할 OpenAI description 요약 최대 수
- `USE_FULL_TEXT_EXTRACTION`: 기본 `true`. 최종 후보 기사 본문 추출 사용 여부
- `ARTICLE_FETCH_TIMEOUT_MS`: 기본 `8000`. 기사 한 건의 요청 제한 시간
- `MAX_ARTICLE_FETCH_CONCURRENCY`: 기본 `3`. 기사 본문 동시 요청 수
- `MIN_ARTICLE_TEXT_LENGTH`: 기본 `300`. 본문으로 인정할 최소 글자 수
- `MAX_TITLE_FALLBACK_ITEMS`: 기본 `0`. 정말 필요한 경우에만 `1`로 설정 가능
- `FORCE_SAVE_EMPTY`: 기본 `false`. `true`일 때만 0건 결과 저장 허용
- `MAX_ITEMS_PER_CATEGORY`: 기본 `5`
- `MIN_DOMESTIC_ARTICLES`: 기본 `8`. 관련 후보가 충분할 때 확보할 국내 기사 목표
- `MIN_FINAL_ARTICLES`: 기본 `10`. 최종 저장 최소 목표
- `MAX_FINAL_ARTICLES`: 기본 `15`. 최종 저장 최대 개수
- `MAX_EXTRACTION_CANDIDATES`: 기본 `30`. 점수순으로 본문 추출·요약을 시도할 넓은 후보 상한
- `SAVE_DEBUG_CANDIDATES`: 로컬 기본 `true`. `data/debug/candidates-YYYY-MM-DD.json` 후보 리포트 저장 여부
- `ALLOW_UNLISTED_SOURCES`: 기본 `false`
- `ENABLE_DISCOVERY_FALLBACK`: 기본 `false`. 강한 연결의 국내·전체 primary 후보가 부족할 때 discovery 검색 사용
- `DISCOVERY_MAX_RESULTS_PER_QUERY`: 기본 `5`. 검색 쿼리별 후보 상한
- `DISCOVERY_MAX_TOTAL_RESULTS`: 기본 `40`. 한 번의 수집에서 discovery 전체 후보 상한
- `DISCOVERY_REQUIRE_ORIGINAL_URL`: 기본 `true`. 원문 언론사 URL을 확인한 검색 결과만 저장

API 키를 Repository Variable, 코드, 커밋, 워크플로우 본문에 직접 넣지 마세요. `USE_OPENAI_SUMMARY=true`여도 `OPENAI_API_KEY` Secret이 비어 있으면 로컬 규칙 요약만 사용합니다.

## 배포

`index.html`, `style.css`, `app.js`, `data/news.json`, `data/archive/`는 정적 파일이므로 GitHub Pages, Vercel, Netlify 등에 배포할 수 있습니다. 매일 수집은 정적 페이지가 아니라 GitHub Actions, Vercel Cron 또는 Netlify Scheduled Function이 Node.js 스크립트를 실행하도록 유지하세요.

GitHub Pages를 사용할 때는 Pages 배포 대상으로 이 프로젝트가 위치한 브랜치·폴더를 선택합니다. 저장소 루트가 이 폴더가 아니라면 배포 설정에서 해당 하위 폴더를 별도로 빌드·게시해야 합니다.

## 데이터와 저작권 주의

- 저장 항목은 제목, 발행일, 100자 이내 요약, 요약 입력 출처(`summarySource`), 언론사명, 카테고리, 원문 링크, 내부 정렬 점수로 제한합니다.
- 기사 전문, 긴 인용문, 유료 기사 본문을 저장하거나 재배포하지 마세요.
- 기사 본문은 요약 생성 중에만 일시적으로 사용하며 JSON과 화면에는 포함하지 않습니다.
- 각 기사의 저작권과 이용 조건은 원 언론사에 있습니다.
- RSS 제공 정책과 robots/이용약관이 변경되면 해당 소스를 검토하거나 제거하세요.
- 자동 요약은 오류가 있을 수 있으므로 중요한 의사결정 전에는 원문을 확인하세요.
