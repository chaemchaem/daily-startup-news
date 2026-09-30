const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appendBufferedEntries,
  isBufferableFeed,
  mergeIntoBuffer,
} = require("../scripts/feed-buffer");
const { runSnapshotCli, snapshotFeeds } = require("../scripts/snapshot-feeds");

const now = new Date("2026-09-30T05:00:00Z"); // KST 14:00 — 실제 예약 실행이 도는 시각대
const rssFeed = { name: "연합뉴스 산업", type: "rss", priority: "primary", feedUrl: "https://example.com/rss", region: "domestic" };
const hoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();

test("버퍼 대상은 추가 요청이 없는 기본 RSS만이다", () => {
  assert.equal(isBufferableFeed(rssFeed), true);
  assert.equal(isBufferableFeed({ ...rssFeed, dateFromArticlePage: true }), false);
  assert.equal(isBufferableFeed({ ...rssFeed, type: "html_list" }), false);
  assert.equal(isBufferableFeed({ ...rssFeed, priority: "discovery" }), false);
});

test("스냅샷은 72시간 안의 항목만 중복 없이 보관한다", () => {
  const result = {
    feed: rssFeed,
    succeeded: true,
    entries: [
      { item: { title: "새 기사", link: "https://example.com/1", isoDate: hoursAgo(1) } },
      { item: { title: "같은 기사", link: "https://example.com/1", isoDate: hoursAgo(1) } },
      { item: { title: "오래된 기사", link: "https://example.com/old", isoDate: hoursAgo(80) } },
      { item: { title: "날짜 없음", link: "https://example.com/nodate" } },
    ],
  };
  const previous = {
    items: [
      { feedName: rssFeed.name, title: "지난 스냅샷", link: "https://example.com/0", publishedAt: hoursAgo(10) },
      { feedName: rssFeed.name, title: "만료", link: "https://example.com/expired", publishedAt: hoursAgo(73) },
    ],
  };
  const { buffer, added } = mergeIntoBuffer(previous, [result], now);
  assert.equal(added, 1);
  assert.deepEqual(buffer.items.map((item) => item.link).sort(), ["https://example.com/0", "https://example.com/1"]);
});

test("수집 시 RSS에서 이미 밀려난 기사만 버퍼에서 보충한다", () => {
  const results = [
    {
      feed: rssFeed,
      succeeded: true,
      entries: [{ item: { title: "오후 기사", link: "https://example.com/after", isoDate: hoursAgo(1) }, feed: rssFeed }],
    },
  ];
  const buffer = {
    items: [
      { feedName: rssFeed.name, title: "오후 기사", link: "https://example.com/after", publishedAt: hoursAgo(1) },
      { feedName: rssFeed.name, title: "오전 8시 스타트업 투자 기사", link: "https://example.com/before", publishedAt: hoursAgo(6), description: "설명" },
      { feedName: "다른 수집원", title: "무관", link: "https://example.com/other", publishedAt: hoursAgo(6) },
    ],
  };
  const added = appendBufferedEntries(results, buffer);
  assert.equal(added, 1);
  assert.equal(results[0].bufferedCount, 1);
  const extra = results[0].entries.at(-1);
  assert.equal(extra.item.link, "https://example.com/before");
  assert.equal(extra.item.isoDate, hoursAgo(6));
  assert.equal(extra.feed, rssFeed);
});

test("스냅샷 스크립트는 버퍼 파일을 만들고 실패한 수집원을 알려 준다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feed-buffer-"));
  const previousPath = process.env.FEED_BUFFER_PATH;
  process.env.FEED_BUFFER_PATH = path.join(dir, "feed-buffer.json");
  try {
    const failing = { ...rssFeed, name: "실패 수집원", feedUrl: "https://example.com/fail" };
    const summary = await snapshotFeeds({
      feeds: [rssFeed, failing, { ...rssFeed, name: "목록형", type: "html_list" }],
      now,
      fetchSource: async (feed) =>
        feed.name === failing.name
          ? { feed, succeeded: false, entries: [] }
          : { feed, succeeded: true, entries: [{ item: { title: "기사", link: "https://example.com/a", isoDate: hoursAgo(2) }, feed }] },
    });
    assert.equal(summary.feeds, 2);
    assert.deepEqual(summary.failed, ["실패 수집원"]);
    assert.equal(summary.total, 1);
    const saved = JSON.parse(fs.readFileSync(process.env.FEED_BUFFER_PATH, "utf8"));
    assert.equal(saved.items[0].link, "https://example.com/a");
  } finally {
    if (previousPath === undefined) delete process.env.FEED_BUFFER_PATH;
    else process.env.FEED_BUFFER_PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("스냅샷 CLI는 작업 후 반드시 종료하고, 실패해도 종료 코드 0을 쓴다", async () => {
  const codes = [];
  const logs = [];
  await runSnapshotCli({
    snapshot: async () => ({ feeds: 2, failed: ["전자신문"], added: 3, pruned: 0, total: 3, previousTotal: 0 }),
    terminate: (code) => codes.push(code),
    log: (line) => logs.push(line),
  });
  await runSnapshotCli({
    snapshot: async () => {
      throw new Error("network down");
    },
    terminate: (code) => codes.push(code),
    logError: (line) => logs.push(line),
  });
  assert.deepEqual(codes, [0, 0]);
  assert.match(logs[0], /보관 0→3건/u);
  assert.match(logs.at(-1), /스냅샷 실패/u);
});
