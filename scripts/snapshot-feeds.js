// RSS 기사 목록 스냅샷. "Feed snapshot" 워크플로가 2시간마다 실행한다.
// 데이터 파일(data/)은 건드리지 않고 .cache/feed-buffer.json만 갱신한다.
//
//   pnpm run snapshot:feeds
const { sourceFeeds } = require("./sources");
const {
  bufferPath,
  isBufferableFeed,
  loadFeedBuffer,
  mergeIntoBuffer,
  saveFeedBuffer,
} = require("./feed-buffer");

async function snapshotFeeds({ feeds = sourceFeeds, now = new Date(), fetchSource } = {}) {
  const fetcher = fetchSource || require("./collect-news").fetchSource;
  const targets = feeds.filter(isBufferableFeed);
  const results = [];
  // 언론사에 부담을 주지 않도록 동시에 4곳까지만 요청한다.
  for (let index = 0; index < targets.length; index += 4) {
    results.push(...(await Promise.all(targets.slice(index, index + 4).map(fetcher))));
  }
  const filePath = bufferPath();
  const previous = await loadFeedBuffer(filePath);
  const { buffer, added, pruned } = mergeIntoBuffer(previous, results, now);
  await saveFeedBuffer(buffer, filePath);
  return {
    feeds: targets.length,
    failed: results.filter((result) => !result.succeeded).map((result) => result.feed.name),
    added,
    pruned,
    total: buffer.items.length,
    previousTotal: previous.items.length,
  };
}

if (require.main === module) {
  snapshotFeeds()
    .then((summary) => {
      console.log(
        `[스냅샷] 수집원 ${summary.feeds}곳 · 새 항목 ${summary.added}건 · 정리 ${summary.pruned}건 · 보관 ${summary.previousTotal}→${summary.total}건`
      );
      if (summary.failed.length) console.log(`[스냅샷 실패 수집원] ${summary.failed.join(", ")}`);
    })
    .catch((error) => {
      // 스냅샷 실패는 브리핑에 영향을 주지 않는다. 로그만 남기고 정상 종료한다.
      console.error(`[스냅샷 실패] ${error.stack || error.message}`);
    });
}

module.exports = { snapshotFeeds };
