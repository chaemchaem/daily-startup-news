const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateKstCollectionRange } = require("../scripts/collect-news");

test("KST 오전 9시 이후 실행은 당일 09:00을 종료시각으로 고정한다", () => {
  const { rangeFrom, rangeTo } = calculateKstCollectionRange(
    new Date("2026-07-06T15:42:31+09:00")
  );
  assert.equal(rangeFrom.toISOString(), "2026-07-05T00:00:00.000Z");
  assert.equal(rangeTo.toISOString(), "2026-07-06T00:00:00.000Z");
});

test("KST 오전 9시 이전 실행은 전날 09:00을 종료시각으로 사용한다", () => {
  const { rangeFrom, rangeTo } = calculateKstCollectionRange(
    new Date("2026-07-06T08:59:59+09:00")
  );
  assert.equal(rangeFrom.toISOString(), "2026-07-04T00:00:00.000Z");
  assert.equal(rangeTo.toISOString(), "2026-07-05T00:00:00.000Z");
});

test("KST 오전 9시 정각과 Actions 지연 실행은 같은 24시간 범위를 사용한다", () => {
  const atNine = calculateKstCollectionRange(new Date("2026-07-06T09:00:00+09:00"));
  const delayed = calculateKstCollectionRange(new Date("2026-07-06T09:05:00+09:00"));
  assert.equal(atNine.rangeFrom.toISOString(), delayed.rangeFrom.toISOString());
  assert.equal(atNine.rangeTo.toISOString(), delayed.rangeTo.toISOString());
  assert.equal(delayed.rangeTo.toISOString(), "2026-07-06T00:00:00.000Z");
  assert.equal(
    delayed.rangeTo.getTime() - delayed.rangeFrom.getTime(),
    24 * 60 * 60 * 1_000
  );
});
