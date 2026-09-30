// RSS 기사 목록 버퍼.
// GitHub 예약 실행이 몇 시간씩 늦어지면, 기사량이 많은 RSS(연합뉴스 등)는 최근 기사만 남아
// 브리핑 기준 시각(KST 09:00) 이전 기사가 이미 밀려나 있다. 그래서 별도 워크플로가 2시간마다
// RSS 항목의 제목·링크·발행일·설명만 이 버퍼에 모아 두고, 수집 스크립트가 합쳐 쓴다.
// 버퍼는 저장소에 커밋하지 않고 GitHub Actions 캐시로만 주고받는다(.cache/는 .gitignore 대상).
const fs = require("node:fs/promises");
const path = require("node:path");

const { cleanText, parseFeedItemDate } = require("./utils");

const DEFAULT_BUFFER_PATH = path.join(__dirname, "..", ".cache", "feed-buffer.json");
const BUFFER_RETENTION_MS = 72 * 60 * 60 * 1_000;
const MAX_FUTURE_MS = 60 * 60 * 1_000;

function bufferPath(env = process.env) {
  return env.FEED_BUFFER_PATH
    ? path.resolve(env.FEED_BUFFER_PATH)
    : DEFAULT_BUFFER_PATH;
}

// 버퍼에 담을 수 있는 수집원: 기사 페이지를 따로 읽어야 하는 방식(목록형·발행일 보완)은
// 2시간마다 돌리기엔 요청이 많으므로 제외한다.
function isBufferableFeed(feed) {
  return (
    feed?.type === "rss" &&
    feed.priority === "primary" &&
    !feed.dateFromArticlePage &&
    Boolean(feed.feedUrl)
  );
}

async function loadFeedBuffer(filePath = bufferPath()) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { version: 1, updatedAt: null, items: [] };
  }
}

async function saveFeedBuffer(buffer, filePath = bufferPath()) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(buffer)}\n`, "utf8");
}

function bufferKey(feedName, link) {
  return `${feedName}|${String(link || "").trim()}`;
}

// 수집 결과(fetchSource)를 버퍼 항목으로 바꿔 합친다. 오래된 항목은 버린다.
function mergeIntoBuffer(buffer, results, now = new Date()) {
  const nowMs = now.getTime();
  const byKey = new Map(
    (buffer?.items || []).map((item) => [bufferKey(item.feedName, item.link), item])
  );
  let added = 0;
  for (const result of results) {
    if (!result?.succeeded || !isBufferableFeed(result.feed)) continue;
    for (const { item } of result.entries || []) {
      const link = item.link || item.guid;
      const publishedAt = parseFeedItemDate(item, {
        assumeKst: result.feed.region !== "global",
      });
      if (!link || !publishedAt) continue;
      const time = publishedAt.getTime();
      if (time < nowMs - BUFFER_RETENTION_MS || time > nowMs + MAX_FUTURE_MS) continue;
      const key = bufferKey(result.feed.name, link);
      if (!byKey.has(key)) added += 1;
      byKey.set(key, {
        feedName: result.feed.name,
        title: cleanText(item.title || ""),
        link,
        publishedAt: publishedAt.toISOString(),
        description: cleanText(item.contentSnippet || item.description || item.summary || "").slice(0, 500),
        firstSeenAt: byKey.get(key)?.firstSeenAt || now.toISOString(),
      });
    }
  }
  const items = [...byKey.values()].filter((item) => {
    const time = Date.parse(item.publishedAt);
    return Number.isFinite(time) && time >= nowMs - BUFFER_RETENTION_MS;
  });
  return {
    buffer: { version: 1, updatedAt: now.toISOString(), items },
    added,
    pruned: (buffer?.items?.length || 0) + added - items.length,
  };
}

// 이번 실행에서 RSS가 이미 준 항목 외에, 버퍼에만 남아 있는 항목을 수집 결과에 더한다.
function appendBufferedEntries(results, buffer) {
  const bufferedByFeed = new Map();
  for (const item of buffer?.items || []) {
    if (!bufferedByFeed.has(item.feedName)) bufferedByFeed.set(item.feedName, []);
    bufferedByFeed.get(item.feedName).push(item);
  }
  let total = 0;
  for (const result of results) {
    const buffered = bufferedByFeed.get(result.feed?.name);
    if (!buffered?.length || !isBufferableFeed(result.feed)) continue;
    const seen = new Set(
      (result.entries || []).map(({ item }) => String(item.link || item.guid || "").trim())
    );
    const extra = buffered
      .filter((item) => !seen.has(String(item.link).trim()))
      .map((item) => ({
        item: {
          title: item.title,
          link: item.link,
          isoDate: item.publishedAt,
          contentSnippet: item.description,
          _fromBuffer: true,
        },
        feed: result.feed,
      }));
    result.entries = [...(result.entries || []), ...extra];
    result.bufferedCount = extra.length;
    total += extra.length;
  }
  return total;
}

module.exports = {
  appendBufferedEntries,
  bufferPath,
  isBufferableFeed,
  loadFeedBuffer,
  mergeIntoBuffer,
  saveFeedBuffer,
};
