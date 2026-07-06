const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateRollingCollectionRange } = require("../scripts/collect-news");

test("수집 종료시각은 실제 실행 시각을 그대로 사용한다", () => {
  const { rangeFrom, rangeTo } = calculateRollingCollectionRange(
    new Date("2026-07-06T15:42:31+09:00")
  );
  assert.equal(rangeTo.toISOString(), "2026-07-06T06:42:31.000Z");
  assert.equal(rangeFrom.toISOString(), "2026-07-04T06:42:31.000Z");
});

test("수집 시작시각은 실행 시각에서 정확히 48시간 전이다", () => {
  const { rangeFrom, rangeTo } = calculateRollingCollectionRange(
    "2026-07-06T09:05:12+09:00"
  );
  assert.equal(rangeFrom.toISOString(), "2026-07-04T00:05:12.000Z");
  assert.equal(rangeTo.getTime() - rangeFrom.getTime(), 48 * 60 * 60 * 1_000);
});

test("실행 시각의 타임존 표기가 달라도 같은 절대시각이면 같은 범위를 계산한다", () => {
  const kst = calculateRollingCollectionRange("2026-07-06T09:00:00+09:00");
  const utc = calculateRollingCollectionRange("2026-07-06T00:00:00Z");
  assert.equal(kst.rangeFrom.toISOString(), utc.rangeFrom.toISOString());
  assert.equal(kst.rangeTo.toISOString(), utc.rangeTo.toISOString());
});
