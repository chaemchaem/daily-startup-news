// 수집원 점검 스크립트. 활성 수집원과 검증 대기 후보(candidate)의 실제 응답을 확인한다.
// 데이터 파일을 수정하지 않으며, 결과는 표준 출력과 GitHub Actions 요약에만 기록한다.
//
//   pnpm run probe:sources            # 활성 + 후보 전체
//   pnpm run probe:sources -- --candidates   # 후보만
const fs = require("node:fs/promises");
const Parser = require("rss-parser");

const { candidateSourceFeeds, categories, sourceFeeds } = require("./sources");
const { isUrlAllowedByRobots } = require("./article-extractor");
const { cleanText, containsKeyword, parsePublishedDate } = require("./utils");

const WINDOW_MS = 48 * 60 * 60 * 1_000;
const BROAD_KEYWORDS = [
  ...new Set([
    ...Object.values(categories).flat(),
    "스타트업",
    "창업",
    "벤처",
    "투자",
    "펀드",
  ]),
];

function sourceUrl(feed) {
  return feed.feedUrl || feed.listUrl || feed.sitemapUrl || "";
}

async function probeRss(feed) {
  const parser = new Parser({
    timeout: feed.fetchTimeoutMs || 15_000,
    headers: { "User-Agent": "DailyStartupVCBriefing/1.0 RSS Reader" },
  });
  const parsed = await parser.parseURL(feed.feedUrl);
  const items = parsed.items || [];
  const now = Date.now();
  const dated = items
    .map((item) => ({
      title: cleanText(item.title || ""),
      url: item.link || item.guid || "",
      publishedAt: parsePublishedDate(item.isoDate || item.pubDate),
    }))
    .filter((item) => item.title);
  const recent = dated.filter(
    (item) => item.publishedAt && now - item.publishedAt.getTime() <= WINDOW_MS
  );
  const patternMatched = dated.filter(
    (item) =>
      !feed.allowedUrlPatterns?.length ||
      feed.allowedUrlPatterns.some((pattern) => new RegExp(pattern, "iu").test(item.url))
  );
  const keywordMatched = recent.filter((item) =>
    BROAD_KEYWORDS.some((keyword) => containsKeyword(item.title, keyword))
  );
  const sampleUrl = patternMatched[0]?.url || dated[0]?.url || "";
  const robotsAllowed = sampleUrl
    ? await isUrlAllowedByRobots(sampleUrl, { timeoutMs: 8_000 })
    : null;
  const newest = dated
    .map((item) => item.publishedAt)
    .filter(Boolean)
    .sort((left, right) => right - left)[0];

  return {
    ok: items.length > 0,
    items: items.length,
    recent48h: recent.length,
    urlPatternMatched: patternMatched.length,
    keywordMatched48h: keywordMatched.length,
    newest: newest ? newest.toISOString() : null,
    robotsAllowed,
    samples: keywordMatched.slice(0, 3).map((item) => item.title),
  };
}

async function probeSource(feed) {
  const base = {
    name: feed.name,
    candidate: Boolean(feed.candidate),
    type: feed.type,
    url: sourceUrl(feed),
  };
  if (feed.type !== "rss") {
    return { ...base, ok: null, note: "목록형 수집원은 수집 로그의 source 진단으로 확인" };
  }
  try {
    return { ...base, ...(await probeRss(feed)) };
  } catch (error) {
    return { ...base, ok: false, error: cleanText(error.message).slice(0, 120) };
  }
}

function toMarkdown(results) {
  const lines = [
    "| 수집원 | 상태 | 전체 | 48시간 | URL 패턴 일치 | 키워드 일치(48h) | robots | 최신 기사 |",
    "|---|---|---:|---:|---:|---:|---|---|",
  ];
  for (const result of results) {
    const status =
      result.ok === null ? "—" : result.ok ? "정상" : `실패 ${result.error || "(0건)"}`;
    lines.push(
      `| ${result.candidate ? "[후보] " : ""}${result.name} | ${status} | ${result.items ?? "—"} | ${result.recent48h ?? "—"} | ${result.urlPatternMatched ?? "—"} | ${result.keywordMatched48h ?? "—"} | ${result.robotsAllowed === null || result.robotsAllowed === undefined ? "—" : result.robotsAllowed ? "허용" : "차단"} | ${result.newest || "—"} |`
    );
  }
  lines.push("", "[후보] = 검증 대기 후보(ENABLE_CANDIDATE_SOURCES=true일 때만 수집)");
  const samples = results.filter((result) => result.samples?.length);
  if (samples.length) {
    lines.push("", "### 키워드 일치 샘플");
    for (const result of samples) {
      lines.push(`- **${result.name}**: ${result.samples.join(" / ")}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const candidatesOnly = process.argv.includes("--candidates");
  const feeds = candidatesOnly
    ? candidateSourceFeeds
    : [...sourceFeeds.filter((feed) => feed.priority === "primary"), ...candidateSourceFeeds];
  const results = [];
  for (const feed of feeds) {
    results.push(await probeSource(feed));
  }
  const markdown = toMarkdown(results);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## 수집원 점검 결과\n\n${markdown}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[수집원 점검 실패] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { probeSource, toMarkdown };
