const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateRollingCollectionRange } = require("../scripts/collect-news");

test("KST 09:00 이후 실행하면 수집 종료시각은 당일 09:00 KST이다", () => {
  const { rangeFrom, rangeTo } = calculateRollingCollectionRange(
    new Date("2026-07-07T09:15:00+09:00")
  );
  assert.equal(rangeTo.toISOString(), "2026-07-07T00:00:00.000Z");
  assert.equal(rangeFrom.toISOString(), "2026-07-05T00:00:00.000Z");
});

test("KST 09:00 이전 실행하면 수집 종료시각은 전날 09:00 KST이다", () => {
  const { rangeFrom, rangeTo } = calculateRollingCollectionRange(
    "2026-07-07T08:59:59+09:00"
  );
  assert.equal(rangeTo.toISOString(), "2026-07-06T00:00:00.000Z");
  assert.equal(rangeFrom.toISOString(), "2026-07-04T00:00:00.000Z");
});

test("수집 시작시각은 KST 09:00 종료시각에서 정확히 48시간 전이다", () => {
  const { rangeFrom, rangeTo } = calculateRollingCollectionRange(
    "2026-07-06T09:00:00+09:00"
  );
  assert.equal(rangeTo.toISOString(), "2026-07-06T00:00:00.000Z");
  assert.equal(rangeTo.getTime() - rangeFrom.getTime(), 48 * 60 * 60 * 1_000);
});

test("실행 시각의 타임존 표기가 달라도 같은 절대시각이면 같은 범위를 계산한다", () => {
  const kst = calculateRollingCollectionRange("2026-07-06T09:00:00+09:00");
  const utc = calculateRollingCollectionRange("2026-07-06T00:00:00Z");
  assert.equal(kst.rangeFrom.toISOString(), utc.rangeFrom.toISOString());
  assert.equal(kst.rangeTo.toISOString(), utc.rangeTo.toISOString());
});
