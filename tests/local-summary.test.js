const assert = require("node:assert/strict");
const test = require("node:test");

const {
  summarizeArticleWithMetadata,
  summarizeFreeLocal,
} = require("../scripts/summarize");
const { validateFallbackSummaryQuality } = require("../scripts/utils");
const { summarizeArticleSafely } = require("../scripts/collect-news");

test("메타 문구와 제목 복사 대신 본문의 구체적인 핵심문장을 선택한다", () => {
  const title = "로봇 스타트업, 80억 원 규모 시리즈A 투자 유치";
  const articleText = [
    "로봇 스타트업, 80억 원 규모 시리즈A 투자 유치.",
    "홍길동 기자 reporter@example.com 입력 2026년 7월 6일.",
    "무단전재 및 재배포 금지 Copyright.",
    "이 회사는 신규 생산시설 구축과 해외 시장 진출에 투자금을 활용한다고 밝혔다.",
    "투자에는 벤처캐피탈 세 곳이 참여했으며 후속 기술 실증도 지원한다.",
    "전체 맥락을 이해하려면 기사 본문을 함께 확인하는 것이 좋습니다 회사는 해외 진출을 추진한다.",
    "관련기사 인기기사 댓글 로그인 안내 구독하기.",
    "회사는 로봇 자동화 기술의 상용화를 추진한다.",
  ].join(" ").repeat(4);

  const result = summarizeFreeLocal({
    title,
    description: "로봇 스타트업이 시리즈A 투자를 유치해 사업 확장을 추진한다.",
    category: "VC / AC",
    source: "테스트매체",
    extractedArticleText: articleText,
  });

  assert.equal(result.summarySource, "local_extractive");
  assert.ok(Array.from(result.summary).length <= 100);
  assert.notEqual(result.summary.replace(/[.!?。]$/u, ""), title);
  assert.doesNotMatch(
    result.summary,
    /기자|이메일|무단전재|Copyright|관련기사|로그인|전체\s*맥락/u
  );
  assert.match(result.summary, /투자금|벤처캐피탈|기술\s*실증|상용화/u);
});

test("본문에서 완결 문장을 찾지 못하면 정제된 description을 사용한다", () => {
  const result = summarizeFreeLocal({
    title: "창업기업 지원 프로그램 참가사 모집",
    description:
      "창업지원기관은 초기 창업기업의 해외 진출을 돕는 프로그램 참가사를 모집한다.",
    category: "스타트업 / 벤처기업 / 초기창업",
    source: "테스트기관",
    extractedArticleText: "메뉴 광고 관련기사 댓글 로그인 구독하기 ".repeat(20),
  });

  assert.equal(result.summarySource, "description");
  assert.match(result.summary, /창업기업.*프로그램.*모집한다/u);
});

test("투자유치 제목은 기술 설명보다 투자 규모·투자자·자금 용도 문장을 우선한다", () => {
  const result = summarizeFreeLocal({
    title: "진료기록 자동작성 스튜디오키코, 프리 A 투자 유치",
    description: "의료 AI 스타트업이 프리 A 투자를 유치했다.",
    category: "VC / AC",
    source: "테스트매체",
    extractedArticleText: [
      "회사는 의료진과 환자의 대화를 분석하는 앰비언트 AI 기술을 상용화했다.",
      "이번 프리 A 투자에는 헬스케어 벤처캐피탈 두 곳이 참여했다.",
      "회사는 투자금을 병원 도입 확대와 해외 시장 진출에 활용할 계획이다.",
      "자체 의료 AI 엔진은 진료기록 작성 시간을 단축하는 기능을 제공한다.",
    ].join(" ").repeat(4),
  });
  assert.equal(result.summarySource, "local_extractive");
  assert.match(result.summary, /프리\s*A|투자|벤처캐피탈|투자금/u);
  assert.doesNotMatch(result.summary, /AI\s*엔진.*기능/u);
});

test("지원사업 제목은 행사 진행보다 지원 대상·내용·주관기관 문장을 우선한다", () => {
  const result = summarizeFreeLocal({
    title: "벤처블릭, 헬스케어 스타트업 글로벌 진출 지원 3자 MOU 체결",
    description: "세 기관이 헬스케어 스타트업의 해외 진출을 지원한다.",
    category: "스타트업 / 벤처기업 / 초기창업",
    source: "테스트매체",
    extractedArticleText: [
      "행사에서는 협약식과 비즈니스 네트워킹 프로그램이 진행됐다.",
      "벤처블릭과 두 기관은 헬스케어 스타트업을 대상으로 해외 파트너 발굴과 글로벌 진출을 지원한다.",
      "참여기업에는 현지 시장 검증과 투자자 연계 프로그램을 제공한다.",
      "행사 관계자와 참여자들은 기념촬영을 진행했다.",
    ].join(" ").repeat(4),
  });
  assert.equal(result.summarySource, "local_extractive");
  assert.match(result.summary, /헬스케어\s*스타트업|참여기업/u);
  assert.match(result.summary, /지원|시장\s*검증|투자자\s*연계/u);
  assert.doesNotMatch(result.summary, /협약식과.*네트워킹/u);
});

test("스타트업 글로벌 진출 지원 MOU는 명확한 협력 사건 fallback으로 인정한다", () => {
  const title = "벤처블릭, 헬스케어 스타트업 글로벌 진출 지원 3자 MOU 체결";
  const result = summarizeFreeLocal({
    title,
    description: "",
    category: "스타트업 / 벤처기업 / 초기창업",
    source: "병원신문",
    extractedArticleText:
      "행사에서는 협약식과 글로벌 마스터클래스 및 네트워킹 프로그램이 진행됐다. ".repeat(5),
  });
  assert.equal(result.summarySource, "titleFallback");
  assert.match(result.summary, /벤처블릭.*스타트업.*글로벌\s*진출.*협력\s*체계/u);
  assert.equal(
    validateFallbackSummaryQuality({
      title,
      summary: result.summary,
      source: "병원신문",
      summarySource: result.summarySource,
    }).isValid,
    true
  );
});

test("OpenAI 사용 설정에 키가 없어도 local_extractive로 안전하게 전환한다", async () => {
  const previousUseOpenAI = process.env.USE_OPENAI_SUMMARY;
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.USE_OPENAI_SUMMARY = "true";
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await summarizeArticleWithMetadata({
      title: "딥테크 스타트업이 공공기관과 기술 실증을 추진",
      description: "공공기관은 창업기업의 사업화를 위한 실증을 지원한다.",
      category: "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주",
      source: "테스트기관",
      extractedArticleText:
        "딥테크 스타트업은 공공기관과 현장 기술 실증을 진행한다고 밝혔다. 실증 결과는 제품 상용화와 후속 사업화에 활용한다. ".repeat(6),
    });
    assert.equal(result.summarySource, "local_extractive");
    assert.equal(result.openAIAttempted, false);
    assert.equal(result.usedOpenAI, false);
  } finally {
    if (previousUseOpenAI === undefined) delete process.env.USE_OPENAI_SUMMARY;
    else process.env.USE_OPENAI_SUMMARY = previousUseOpenAI;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test("기사별 요약 처리 오류가 나면 local_extractive와 description 순서로 복구한다", async () => {
  const throwingSummarizer = async () => {
    throw new Error("synthetic summary failure");
  };
  const bodyResult = await summarizeArticleSafely(
    {
      title: "AI 스타트업이 공공 물류 현장에서 PoC 실증을 추진",
      description: "창업기업이 물류 자동화 기술의 사업성을 검증한다.",
      category: "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주",
      source: "테스트매체",
      extractedArticleText:
        "해당 스타트업은 공공 물류 현장에 자동화 기술을 적용해 성능과 사업성을 검증한다. 실증 결과를 바탕으로 제품 상용화와 후속 사업화를 추진한다. ".repeat(5),
    },
    {},
    throwingSummarizer
  );
  assert.equal(bodyResult.summarySource, "local_extractive");
  assert.equal(bodyResult.usedLocalFallback, true);

  const descriptionResult = await summarizeArticleSafely(
    {
      title: "초기 창업기업 해외 진출 프로그램 참가사 모집",
      description:
        "창업지원기관이 초기 창업기업의 해외 판로 개척을 돕는 프로그램 참가사를 모집한다.",
      category: "스타트업 / 벤처기업 / 초기창업",
      source: "테스트기관",
      extractedArticleText: "메뉴 광고 로그인 안내 ".repeat(20),
    },
    {},
    throwingSummarizer
  );
  assert.equal(descriptionResult.summarySource, "description");

  const missingResult = await summarizeArticleSafely(
    {
      title: "창업기업 사업화 지원 프로그램 참여기업 모집",
      description:
        "창업지원기관이 초기기업의 제품 사업화를 돕는 프로그램 참여기업을 모집한다.",
      category: "스타트업 / 벤처기업 / 초기창업",
      source: "테스트기관",
      extractedArticleText: "",
    },
    {},
    async () => undefined
  );
  assert.equal(missingResult.summarySource, "description");
});
