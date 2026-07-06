const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateArticle,
  evaluateStrongConnectionArticle,
  finalHardExcludeReason,
  fillCandidatesByPriority,
  selectFinalBriefingItems,
} = require("../scripts/collect-news");

const rangeTo = new Date("2026-07-04T09:00:00+09:00");
const rangeFrom = new Date(rangeTo.getTime() - 24 * 60 * 60 * 1_000);
const baseArticle = {
  source: "테스트매체",
  publishedAt: rangeTo,
  feedPriority: "primary",
  sourceWeight: 6,
  isDomestic: true,
  categoryHints: [],
};

const includedTypes = [
  ["스타트업 투자유치", "로봇 스타트업이 80억 원 규모 시리즈A 투자 유치", "생산 자동화 사업 확장에 활용한다."],
  ["VC 펀드 결성", "벤처캐피탈이 초기기업 대상 신규 벤처펀드 결성", "기관투자자 출자를 받아 후속 투자를 추진한다."],
  ["TIPS/LIPS 선정", "중기부가 스케일업 팁스 운영사 5곳 선정", "기술 창업기업의 연구개발과 사업화를 지원한다."],
  ["공공기관 지원사업", "창업지원기관이 창업기업 글로벌 진출 지원사업 참가사를 모집", "해외 판로와 사업화를 지원한다."],
  ["오픈이노베이션", "대기업과 공공기관이 스타트업 오픈이노베이션 협력", "참여기업의 기술검증과 판로를 지원한다."],
  ["PoC/실증", "AI 스타트업이 공공기관과 물류 PoC 실증 협약", "현장 기술검증 후 사업화를 추진한다."],
  ["창업 생태계 정책", "정부가 창업 생태계 인프라 지원 정책을 개편", "지역 창업기업의 성장 기반을 확대한다."],
  ["벤처투자 제도", "금융당국이 벤처기업 자금조달 제도를 개선", "벤처투자와 후속 자금 유입을 촉진한다."],
  ["회수시장 환경", "벤처 회수시장 활성화를 위한 세컨더리 제도 개편", "구주 거래와 스타트업 자금조달 여건 개선을 추진한다."],
  ["딥테크 사업화", "딥테크 스타트업의 반도체 기술 사업화 지원 확대", "실증과 글로벌 시장 진입을 연계한다."],
];

const excludedTypes = [
  ["주가 기사", "[특징주] 반도체 기업 주가 장중 급등", "코스닥 지수가 상승했다."],
  ["단순 실적", "대기업 2분기 실적 발표, 영업이익 증가", "매출과 공급 확대 계획을 공개했다."],
  ["대기업 일반 신사업", "대기업의 AI 신사업 확대", "일반 제품 전략과 설비 투자 계획을 발표했다."],
  ["산업 전망", "AI 데이터센터 산업 전망과 시장 트렌드", "시장 규모가 커질 것으로 전망된다."],
  ["일반 AI", "새로운 생성형 AI 검색 서비스 출시", "일반 소비자용 검색 기능을 제공한다."],
  ["조언성 칼럼", "[칼럼] 창업자가 알아야 할 경영 체크리스트", "스타트업 운영 조언을 소개한다."],
];

test("브리핑 관련 사건 유형을 넓게 후보로 유지한다", () => {
  for (const [type, title, description] of includedTypes) {
    const result = evaluateArticle(
      { ...baseArticle, title, description },
      rangeFrom,
      rangeTo
    );
    assert.ok(result.classification, `${type} 유형이 제외됨: ${result.reason}`);
    assert.ok(result.classification.score >= 12, `${type} 점수가 너무 낮음`);
    const strong = evaluateStrongConnectionArticle({ title, description });
    assert.ok(strong.strongConnectionType, `${type} 강한 연결이 없음`);
    assert.equal(strong.excludeReason, null, `${type} 최종 제외: ${strong.excludeReason}`);
  }
});

test("명백히 무관하거나 저품질인 유형은 제외한다", () => {
  for (const [type, title, description] of excludedTypes) {
    const result = evaluateStrongConnectionArticle({ title, description });
    assert.equal(result.strongConnectionType, null, `${type} 강한 연결로 오인됨`);
    assert.ok(result.excludeReason, `${type} 제외 사유가 없음`);
  }
});

test("일반 정책 성과와 상장사 산업 투자를 VC/AC로 오분류하지 않는다", () => {
  const examples = [
    [
      "국토부, 모두의 카드 500만 돌파 등 국민체감 성과 17건 특별 포상",
      "일반 정책 성과를 포상했다.",
    ],
    [
      "에코프로비엠 창사 10주년…유상증자로 인니 니켈 제련소 투자 속도",
      "상장사의 산업 설비 투자를 확대한다.",
    ],
    ["소상공인 제품, 광고대행사가 육성", "소상공인 제품 홍보를 지원한다."],
  ];
  for (const [title, description] of examples) {
    const result = evaluateStrongConnectionArticle({ title, description });
    assert.equal(result.strongConnectionType, null);
    assert.notEqual(result.category, "VC / AC");
    assert.ok(result.excludeReason);
  }
});

test("검증에서 발견된 정부 포상·상장사 제련소 기사를 최종 hard exclude한다", () => {
  const blocked = [
    {
      title: "국토부, 모두의 카드 500만 돌파 등 국민체감 성과 17건 특별 포상",
      articleBody: "국민 체감 성과를 낸 17명에게 포상금을 지급한다.",
      summary: "모두의 카드 이용 성과를 특별 포상함",
      expected: "hard_exclude_government_promotion_award",
    },
    {
      title: "에코프로비엠 창사 10주년…유상증자로 인니 니켈 제련소 투자 속도",
      articleBody: "코스닥 상장사가 유상증자로 제련소와 생산 설비에 투자한다.",
      summary: "인도네시아 니켈 제련소 투자를 확대함",
      expected: "hard_exclude_public_company_rights_issue",
    },
  ];
  for (const article of blocked) {
    assert.equal(finalHardExcludeReason(article), article.expected);
    const result = evaluateStrongConnectionArticle(article);
    assert.ok(result.excludeReason?.startsWith("hard_exclude_"));
  }
  assert.equal(
    finalHardExcludeReason({
      title: "반도체 스타트업이 시리즈A 투자 유치 후 시험 생산시설 구축",
      articleBody: "창업기업이 투자금으로 기술 실증용 소규모 생산시설을 마련한다.",
    }),
    null
  );
  for (const article of [
    {
      title: "‘인공태양’ 상용화 도전…이터나퓨전, 시드 투자 23억 유치",
      articleBody:
        "핵융합 스타트업이 시드 투자를 유치했으며 투자금을 연구 설비와 상용화에 활용한다.",
    },
    {
      title: "기후테크 씨이엘랩, 크립톤 투자 유치…분리막 양산 설비 구축",
      articleBody:
        "씨이엘랩은 크립톤에서 투자를 유치해 CCUS 분리막 사업화와 양산 설비 구축을 추진한다.",
    },
  ]) {
    assert.equal(finalHardExcludeReason(article), null);
  }
});

test("description의 약한 단어만으로 강한 생태계 연결을 만들지 않는다", () => {
  const result = evaluateStrongConnectionArticle({
    title: "지역 산업 성과 발표와 우수 사례 포상",
    description:
      "과거 벤처기업의 투자 성과와 정책 지원, 회수시장 동향도 자료에서 언급했다.",
  });
  assert.equal(result.strongConnectionType, null);
  assert.ok(result.excludeReason);
});

test("투자 사건은 VC/AC, 기술 사업화 사건만 딥테크 카테고리로 분류한다", () => {
  const funding = evaluateStrongConnectionArticle({
    title: "AI 스타트업이 100억 원 규모 시리즈A 투자 유치",
    description: "벤처캐피탈 투자를 바탕으로 서비스를 확장한다.",
  });
  assert.equal(funding.category, "VC / AC");

  const commercialization = evaluateStrongConnectionArticle({
    title: "초격차 반도체 스타트업 12곳 기술 실증·사업화 지원",
    description: "공공기관이 제품 상용화를 지원한다.",
  });
  assert.equal(
    commercialization.category,
    "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주"
  );

  for (const title of [
    "벤처블릭, 헬스케어 스타트업 글로벌 진출 지원 3자 MOU 체결",
    "AWS, 창업부터 클라우드 이전까지 AI가 돕는다…스타트업 전용 기능 공개",
    "롯데벤처스 10년째 부산 스타트업 육성…34개사에 투자",
  ]) {
    const support = evaluateStrongConnectionArticle({
      title,
      articleBody: "스타트업의 사업화와 글로벌 진출을 지원하는 프로그램을 운영한다.",
    });
    assert.equal(support.category, "스타트업 / 벤처기업 / 초기창업");
  }
});

test("명확한 투자유치 기사를 VC 후보 상한 전에 보호한다", () => {
  const ordinary = Array.from({ length: 10 }, (_, index) => ({
    title: `벤처투자 일반 후보 ${index}`,
    score: 80 - index,
    category: "VC / AC",
    strongConnectionType: "A",
    feedPriority: "primary",
    publishedAt: new Date("2026-07-06T09:00:00+09:00"),
  }));
  const directFunding = [
    {
      title: "대동로보틱스 50억 원 투자 유치…AI로봇 사업 고도화 추진",
      score: 41,
    },
    {
      title: "CCUS 분리막 개발 씨이엘랩, 크립톤서 투자유치",
      score: 40,
    },
  ].map((article) => ({
    ...article,
    category: "VC / AC",
    strongConnectionType: "C",
    feedPriority: "discovery",
    publishedAt: new Date("2026-07-06T09:00:00+09:00"),
  }));
  const selected = fillCandidatesByPriority(ordinary, directFunding, 10, 12);
  assert.equal(selected.length, 12);
  assert.ok(selected.some((article) => article.title.startsWith("대동로보틱스")));
  assert.ok(selected.some((article) => article.title.startsWith("CCUS")));
});

test("제목이 약해도 본문에 직접 대상이 확인되면 강한 연결로 복구한다", () => {
  const result = evaluateStrongConnectionArticle({
    title: "지역 혁신 사업 참여기업 모집",
    description: "사업 참여 대상을 모집한다.",
    articleBody:
      "지역 창업기업과 초기 스타트업을 대상으로 공공기관이 PoC 실증과 사업화 지원을 제공한다.",
  });
  assert.ok(["B", "D", "E"].includes(result.strongConnectionType));
  assert.equal(result.excludeReason, null);
  assert.equal(result.isStartupEcosystemRelated, true);
});

test("AI 스타트업의 일반 소송·제품 이슈를 해외 VC로 분류하지 않는다", () => {
  const result = evaluateStrongConnectionArticle({
    title: "AI startup faces copyright lawsuit over consumer product",
    description: "The startup said it would respond to the lawsuit.",
    isDomestic: false,
    categoryHints: [
      "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주",
      "해외 VC",
    ],
  });
  assert.notEqual(result.category, "해외 VC");
});

test("국내 8건과 전체 10건 목표를 보충하되 최대 15건을 넘지 않는다", () => {
  const categoryNames = [
    "VC / AC",
    "TIPS / LIPS",
    "스타트업 / 벤처기업 / 초기창업",
    "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주",
  ];
  const candidates = [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `domestic-${index}`,
      title: `국내 후보 ${index}`,
      publishedAt: "2026-07-04",
      score: 8,
      category: categoryNames[index % categoryNames.length],
      _isDomestic: true,
      _strongConnectionType: "A",
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `global-${index}`,
      title: `해외 후보 ${index}`,
      publishedAt: "2026-07-04",
      score: 13,
      category: "해외 VC",
      _isDomestic: false,
      _strongConnectionType: "C",
    })),
  ];

  const result = selectFinalBriefingItems(candidates, {
    minDomestic: 8,
    minFinal: 10,
    maxFinal: 15,
    maxPerCategory: 5,
  });
  assert.equal(result.domesticCount, 8);
  assert.ok(result.items.length >= 10 && result.items.length <= 15);
  assert.equal(result.supplementalApplied, true);
});

test("allowlist 밖의 강한 국내 후보를 목표 미달 시 보충한다", () => {
  const allowed = Array.from({ length: 4 }, (_, index) => ({
    id: `allowed-${index}`,
    title: `허용 출처 기사 ${index}`,
    publishedAt: "2026-07-06",
    score: 20,
    category: "스타트업 / 벤처기업 / 초기창업",
    _isDomestic: true,
    _strongConnectionType: "A",
    _sourceAllowed: true,
  }));
  const recovery = Array.from({ length: 6 }, (_, index) => ({
    id: `recovery-${index}`,
    title: `강한 연결 보충 기사 ${index}`,
    publishedAt: "2026-07-06",
    score: 16,
    category: index < 3 ? "VC / AC" : "TIPS / LIPS",
    _isDomestic: true,
    _strongConnectionType: index < 3 ? "C" : "B",
    _sourceAllowed: false,
    _sourceRecovery: true,
  }));
  const result = selectFinalBriefingItems([...allowed, ...recovery], {
    minDomestic: 8,
    minFinal: 10,
    maxFinal: 15,
    maxPerCategory: 5,
  });
  assert.equal(result.items.length, 10);
  assert.equal(result.domesticCount, 10);
  assert.equal(result.sourceRecoverySupplementCount, 6);
});
