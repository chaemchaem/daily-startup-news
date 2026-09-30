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

// 스냅샷은 부가 작업이므로 실패해도 브리핑에 영향을 주지 않도록 항상 정상 종료(0)한다.
// 네트워크 연결이 남아 프로세스가 끝나지 않는 일을 막기 위해 출력을 비운 뒤 명시적으로 종료한다.
async function runSnapshotCli({
  snapshot = snapshotFeeds,
  terminate = (code) => process.exit(code),
  log = console.log,
  logError = console.error,
} = {}) {
  try {
    const summary = await snapshot();
    log(
      `[스냅샷] 수집원 ${summary.feeds}곳 · 새 항목 ${summary.added}건 · 정리 ${summary.pruned}건 · 보관 ${summary.previousTotal}→${summary.total}건`
    );
    if (summary.failed.length) log(`[스냅샷 실패 수집원] ${summary.failed.join(", ")}`);
  } catch (error) {
    logError(`[스냅샷 실패] ${error.stack || error.message}`);
  }
  await new Promise((resolve) => {
    if (!process.stdout.writable) return resolve();
    process.stdout.write("", resolve);
  });
  terminate(0);
  return 0;
}

if (require.main === module) {
  void runSnapshotCli();
}

module.exports = { runSnapshotCli, snapshotFeeds };
