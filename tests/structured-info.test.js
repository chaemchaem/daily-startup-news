const assert = require("node:assert/strict");
const test = require("node:test");

const { extractStructuredArticleInfo } = require("../scripts/utils");

test("제목과 요약에 명시된 구조화 정보만 추출한다", () => {
  const info = extractStructuredArticleInfo({
    title: "핵융합 스타트업 이터나퓨전, 23억 원 시드 투자 유치",
    summary:
      "이터나퓨전이 23억 원 규모 시드 투자를 유치해 핵융합 기술 사업화를 추진함",
  });
  assert.equal(info.company, "이터나퓨전");
  assert.equal(info.fundingAmount, "23억 원");
  assert.match(info.fundingStage, /시드/u);
  assert.equal(info.eventType, "투자유치");
});

test("본문에 없는 금액과 라운드는 구조화 필드로 만들지 않는다", () => {
  const info = extractStructuredArticleInfo({
    title: "창업진흥원이 딥테크 스타트업 실증 지원기업 모집",
    summary: "창업진흥원이 기술 사업화를 위한 실증 지원기업을 모집함",
  });
  assert.equal(info.fundingAmount, null);
  assert.equal(info.fundingStage, null);
  assert.equal(info.eventType, "모집");
});
