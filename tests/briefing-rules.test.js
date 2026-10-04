const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateStrongConnectionArticle,
  fillCandidatesByPriority,
  finalHardExcludeReason,
  selectFinalBriefingItems,
  stripSourceSuffix,
  summarizeSourceDiagnostics,
} = require("../scripts/collect-news");
const { summarizeFreeLocal } = require("../scripts/summarize");
const { resolveSourceFeeds, sourceFeeds } = require("../scripts/sources");

test("스폰서 기사·영문 라운드업·거시 통상 기사는 최종 제외한다", () => {
  assert.equal(
    finalHardExcludeReason({
      title: "NUS Enterprise launches Nova - an AI platform for research commercialisation (Sponsored)",
    }),
    "hard_exclude_sponsored_content"
  );
  assert.equal(
    finalHardExcludeReason({
      title: "Weekly funding round-up! All of the European startup funding rounds we tracked this week",
    }),
    "hard_exclude_roundup_listicle"
  );
  assert.equal(
    finalHardExcludeReason({ title: "10 European funding vehicles dedicated to women founders" }),
    "hard_exclude_roundup_listicle"
  );
  assert.equal(
    finalHardExcludeReason({ title: "[대미투자 청구서③] \"상업적 합리성 있는 사업만\"… 李, 강조한 '안전판'은" }),
    "hard_exclude_macro_trade_policy"
  );
  // 스타트업이 주체인 통상 대응 기사는 막지 않는다.
  assert.equal(
    finalHardExcludeReason({ title: "관세 대응 스타트업 50곳 수출 바우처 지원 선정" }),
    null
  );
  // 국내 주간 투자 동향은 영문 라운드업 규칙 대상이 아니다.
  assert.equal(finalHardExcludeReason({ title: "주간 스타트업 투자 동향: 시리즈A 12건" }), null);
});

test("해외 기사는 제목에 투자 사건이 있어야 선정 대상이 된다", () => {
  const background = evaluateStrongConnectionArticle({
    title: "Crusoe abandons $1.25B plan to use Boom turbines at AI data centers",
    description: "Crusoe, a startup that recently raised $3.4 billion, dropped the plan.",
    articleBody: "The startup recently raised funding from investors.",
    isDomestic: false,
    categoryHints: ["해외 VC", "스타트업 / 벤처기업 / 초기창업"],
  });
  assert.equal(background.excludeReason, "overseas_vc_signal_missing");

  const funding = evaluateStrongConnectionArticle({
    title: "Stockholm’s Spiich raises €3 million to let AI handle admin work",
    description: "Spiich has raised a €3 million Seed round.",
    articleBody: "The startup raised a Seed round led by venture capital investors.",
    isDomestic: false,
    categoryHints: ["해외 VC"],
  });
  assert.equal(funding.category, "해외 VC");
  assert.equal(funding.excludeReason, null);
});

test("본문 추출 후보에서 해외 비중을 제한해 국내 후보 자리를 남긴다", () => {
  const make = (prefix, count, isDomestic, score) =>
    Array.from({ length: count }, (_, index) => ({
      title: `${prefix} ${index}`,
      score: score - index,
      category: isDomestic ? "스타트업 / 벤처기업 / 초기창업" : "해외 VC",
      strongConnectionType: "A",
      feedPriority: "primary",
      isDomestic,
      publishedAt: new Date("2026-09-24T09:00:00+09:00"),
    }));
  const overseas = make("overseas", 15, false, 90);
  const domestic = make("domestic", 15, true, 60);
  const selected = fillCandidatesByPriority([...overseas, ...domestic], [], 20, 20, 6);
  assert.equal(selected.length, 20);
  assert.equal(selected.filter((article) => !article.isDomestic).length, 6);
  assert.equal(selected.filter((article) => article.isDomestic).length, 14);
});

test("전문 매체는 출처별 상한 3건, 일반 매체는 2건을 적용한다", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`,
    title: `기사 ${index}`,
    source: index < 4 ? "벤처스퀘어" : "매일경제",
    publishedAt: "2026-09-24",
    score: 50 - index,
    category: index % 2 ? "VC / AC" : "스타트업 / 벤처기업 / 초기창업",
    _isDomestic: true,
    _strongConnectionType: "A",
    _maxPerSource: index < 4 ? 3 : undefined,
  }));
  const result = selectFinalBriefingItems(items, {
    minDomestic: 0,
    minFinal: 1,
    maxFinal: 15,
    maxPerCategory: 10,
  });
  const counts = result.items.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});
  assert.equal(counts["벤처스퀘어"], 3);
  assert.equal(counts["매일경제"], 2);
});

test("제목 끝 매체명만 제거하고 제목 본문의 대시 구간은 보존한다", () => {
  assert.equal(
    stripSourceSuffix(
      "Weekly funding round-up! All of the European startup funding rounds we tracked this week (Sept. 21 – Sept. 25) | EU-Startups",
      "EU-Startups"
    ),
    "Weekly funding round-up! All of the European startup funding rounds we tracked this week (Sept. 21 – Sept. 25)"
  );
  assert.equal(
    stripSourceSuffix("[그게 뭔가요] 떠들지 않는 AI 모델 JEV – 바이라인네트워크", "바이라인네트워크"),
    "[그게 뭔가요] 떠들지 않는 AI 모델 JEV"
  );
  assert.equal(stripSourceSuffix("로봇 스타트업, 시리즈A 유치 - 뉴시스", "뉴시스"), "로봇 스타트업, 시리즈A 유치");
});

test("영문 본문 요약은 소수점 금액에서 문장을 자르지 않는다", () => {
  const body = [
    "Home Funding CLUB Germany-Startups",
    "Berlin-based Acme raised €3.4 million in a Seed round to expand its logistics software.",
    "The company was founded in 2021 by two former engineers and has 20 employees across Europe.",
  ].join(" ").repeat(3);
  const result = summarizeFreeLocal({
    title: "Berlin-based Acme raises €3.4 million to expand logistics software",
    category: "해외 VC",
    source: "EU-Startups",
    extractedArticleText: body,
  });
  assert.equal(result.summarySource, "local_extractive");
  assert.match(result.summary, /€3\.4 million in a Seed round/u);
});

test("수집원 진단은 실행된 수집원만 국내 우선으로 정리한다", () => {
  const diagnostics = {
    bySource: new Map([
      ["TechCrunch", { name: "TechCrunch", region: "global", ok: true, final: 1, passed: 3, skipped: {} }],
      ["벤처스퀘어", { name: "벤처스퀘어", region: "domestic", ok: true, final: 2, passed: 5, skipped: { olderThanRange: 3, dateMissing: 0 } }],
      ["미실행", { name: "미실행", region: "domestic", ok: null, final: 0, passed: 0, skipped: {} }],
    ]),
  };
  const summary = summarizeSourceDiagnostics(diagnostics);
  assert.deepEqual(summary.map((record) => record.name), ["벤처스퀘어", "TechCrunch"]);
  assert.deepEqual(summary[0].skipped, { olderThanRange: 3 });
});

test("검증 대기 후보 수집원은 ENABLE_CANDIDATE_SOURCES=true일 때만 포함된다", () => {
  const defaults = resolveSourceFeeds({});
  assert.equal(defaults.length, sourceFeeds.length);
  assert.ok(defaults.every((feed) => !feed.candidate));
  const withCandidates = resolveSourceFeeds({ ENABLE_CANDIDATE_SOURCES: "true" });
  const candidates = withCandidates.filter((feed) => feed.candidate);
  assert.ok(candidates.length > 0);
  assert.ok(
    candidates.every(
      (feed) => feed.enabled && (feed.feedUrl || feed.listUrl) && feed.allowedUrlPatterns.length
    )
  );
  assert.ok(candidates.some((feed) => feed.sourceName === "중앙일보"));
});

test("점검을 통과한 대형 언론사는 기본 수집원에 포함되고 옛 전자신문 섹션 피드는 빠진다", () => {
  const names = new Set(sourceFeeds.map((feed) => feed.sourceName));
  for (const outlet of [
    "연합뉴스", "조선일보", "중앙일보", "동아일보", "한국경제", "한겨레", "경향신문", "ZDNet Korea", "AI타임스", "스타트업투데이",
    "머니투데이", "서울경제", "아시아경제", "파이낸셜뉴스", "헤럴드경제", "이투데이", "아주경제", "조선비즈",
    "서울신문", "세계일보", "블로터", "테크M", "IT조선", "SBS", "연합뉴스TV",
  ]) {
    assert.ok(names.has(outlet), `${outlet} 누락`);
  }
  const etnews = sourceFeeds.filter((feed) => feed.sourceName === "전자신문");
  assert.deepEqual(etnews.map((feed) => feed.feedUrl), ["http://rss.etnews.com/Section901.xml"]);
  // 응답 없는 옛 중앙일보 RSS는 후보로만 남고, 실제 수집은 목록형으로 한다.
  assert.ok(!sourceFeeds.some((feed) => feed.feedUrl === "https://rss.joins.com/joins_money_list.xml"));
  assert.equal(sourceFeeds.find((feed) => feed.sourceName === "중앙일보").type, "html_list");
  assert.equal(sourceFeeds.find((feed) => feed.sourceName === "한겨레").dateFromArticlePage, true);
});
