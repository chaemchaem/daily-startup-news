const assert = require("node:assert/strict");
const test = require("node:test");

const { cleanText, extractStructuredArticleInfo } = require("../scripts/utils");

const info = (title, summary = "") => extractStructuredArticleInfo({ title, summary });

test("영문 단어 안의 ai(raised, Spain)를 AI 산업으로 보지 않는다", () => {
  assert.equal(info("Nernst Electric raised funding from investors in Spain").industry, null);
  assert.equal(info("에임인텔리전스, AI 보안 기술로 엔비디아 챌린지 선정").industry, "AI");
});

test("산업은 제목에서만 판단하고 요약의 부수적인 언급은 쓰지 않는다", () => {
  const result = info(
    "마케마케, 프리A 30억 원 투자 유치",
    "마케마케는 AI 기반 피부 진단 서비스도 준비하고 있다."
  );
  assert.equal(result.industry, null);
});

test("잘린 금액과 기업가치 금액은 투자금으로 저장하지 않는다", () => {
  assert.equal(
    info("Crusoe abandons $1.25B plan", "Crusoe recently raised $3.").fundingAmount,
    null
  );
  const horizon = info("Horizon3 hits $2 billion valuation with $250M Series E");
  assert.equal(horizon.fundingAmount, "$250M");
  assert.equal(horizon.fundingStage, "Series E");
  assert.equal(info("리벨리온, 기업가치 1조 원에 300억 원 투자 유치").fundingAmount, "300억 원");
});

test("투자 사건이 아닌 기사에는 금액·라운드를 붙이지 않는다", () => {
  const result = info("중기부, 오픈이노베이션 마친 스타트업에 사업화 자금 최대 2억 원 지원");
  assert.equal(result.fundingAmount, null);
  assert.equal(result.fundingStage, null);
});

test("과거 투자 이력만 언급한 요약은 투자유치 사건으로 보지 않는다", () => {
  const result = info(
    "Crusoe abandons plan to use Boom turbines at data centers",
    "Crusoe, a startup that recently raised $3.4 billion, said it would drop the plan."
  );
  assert.equal(result.eventType, null);
  assert.equal(result.fundingAmount, null);
});

test("원화 복합 금액과 금액 뒤 라운드 표기를 정확히 읽는다", () => {
  assert.equal(info("마케마케, 프리A 30억5000만 원 투자 유치").fundingAmount, "30억5000만 원");
  const seed = info("‘인공태양’ 상용화 도전…이터나퓨전, 시드 투자 23억 유치");
  assert.equal(seed.eventType, "투자유치");
  assert.equal(seed.fundingAmount, "23억 원");
  assert.equal(seed.company, "이터나퓨전");
});

test("펀드 결성·클로징은 펀드결성으로 분류한다", () => {
  const result = info("A16z closes $1.2B fund for AI startups");
  assert.equal(result.eventType, "펀드결성");
  assert.equal(result.fundingAmount, "$1.2B");
});

test("문장 조각·서비스명·인물·수식어를 회사명으로 저장하지 않는다", () => {
  const cases = [
    ["[대미투자 청구서③] \"상업적 합리성 있는 사업만\"… 李, 강조한 '안전판'은", "양국 정부가 업무협약을 체결했다.", null],
    ["의사가 차트 대신 환자 본다…’니어닥’ 운영사 스튜디오키코, Pre-A 투자 유치", "", "스튜디오키코"],
    ["AI로 의료관광 바꾸는 ‘이뿌다’…킵코퍼레이션, 시드 투자 10억 확보", "", "킵코퍼레이션"],
    ["데이원컴퍼니의 새 성장동력, '팔란티어식' AX 스타트업 인수", "", null],
    ["하늘은 드론, 땅은 로봇…엑스업·메이사, AI 기반 현장관리 시장 공략", "", null],
    ["Repeat founder Ryan Williams raises $10M seed for an AI startup", "", null],
    [
      "에임인텔리전스, AI가 행동하기 전부터 실행 이후까지 지킨다…엔비디아 챌린지 Top 10",
      "AI 보안 전문기업 에임인텔리전스가 최종 Top 10에 선정됐다.",
      "에임인텔리전스",
    ],
    ["Profitable Belgian CleanTech Octave.energy raises €10 million", "", "Octave.energy"],
    ["Madrid-based Buenavista Equity Partners secures €75 million fund", "", "Buenavista Equity Partners"],
  ];
  for (const [title, summary, expected] of cases) {
    assert.equal(info(title, summary).company, expected, title);
  }
});

test("HTML 엔티티(&ndash; 등)를 텍스트로 복원한다", () => {
  assert.equal(cleanText("AI 모델 JEV &ndash; 바이라인네트워크"), "AI 모델 JEV – 바이라인네트워크");
});
