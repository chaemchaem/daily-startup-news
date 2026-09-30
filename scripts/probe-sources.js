// 수집원 점검 스크립트. 활성 수집원과 검증 대기 후보(candidate)의 실제 응답을 확인한다.
// 데이터 파일을 수정하지 않으며, 결과는 표준 출력과 GitHub Actions 요약에만 기록한다.
//
//   pnpm run probe:sources            # 활성 + 후보 전체
//   pnpm run probe:sources -- --candidates   # 후보만
//
// 후보 수집원에 rssGuideUrl이 있으면 해당 언론사의 공식 RSS 안내 페이지에서 피드 주소를 찾아
// 함께 점검한다(주소 변경 확인용). 발행일을 읽지 못하는 피드는 날짜 원문 샘플을 보여 준다.
const fs = require("node:fs/promises");
const Parser = require("rss-parser");

const { candidateSourceFeeds, categories, sourceFeeds } = require("./sources");
const { isUrlAllowedByRobots, requestHtml } = require("./article-extractor");
const { cleanText, containsKeyword, parseFeedItemDate } = require("./utils");

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
  const rawDateSamples = items.slice(0, 2).map((item) =>
    JSON.stringify({
      pubDate: item.pubDate ?? null,
      isoDate: item.isoDate ?? null,
      dcDate: item["dc:date"] ?? null,
      published: item.published ?? null,
      updated: item.updated ?? null,
    })
  );
  const now = Date.now();
  const dated = items
    .map((item) => ({
      title: cleanText(item.title || ""),
      url: item.link || item.guid || "",
      publishedAt: parseFeedItemDate(item, { assumeKst: feed.region !== "global" }),
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
    rawDateSamples,
    firstTitle: dated[0]?.title || null,
    firstUrl: dated[0]?.url || null,
  };
}

// 공식 RSS 안내 페이지에서 피드로 보이는 링크를 찾는다.
async function discoverFeedLinks(guideUrl) {
  if (!(await isUrlAllowedByRobots(guideUrl, { timeoutMs: 10_000 }))) {
    return { guideUrl, error: "robots_disallowed", links: [] };
  }
  const page = await requestHtml(guideUrl, 20_000, "guide_");
  if (!page.ok) return { guideUrl, error: page.reason, links: [] };
  const links = new Set();
  for (const match of page.html.matchAll(/(?:href|value|data-url)\s*=\s*["']([^"']+)["']/giu)) {
    const raw = match[1].replace(/&amp;/gu, "&");
    if (!/rss|\.xml|\/feed|outboundfeeds/iu.test(raw)) continue;
    try {
      const url = new URL(raw, page.finalUrl || guideUrl).href;
      if (/^https?:/u.test(url)) links.add(url);
    } catch {
      // 잘못된 링크는 건너뛴다.
    }
  }
  return { guideUrl, links: [...links].slice(0, 40) };
}

// 후보 수집원은 실제 수집 로직(fetchSource)을 그대로 돌려 목록형·기사 페이지 날짜 보완까지 확인한다.
async function probeViaCollector(feed) {
  const { fetchSource } = require("./collect-news");
  const result = await fetchSource(feed);
  if (!result.succeeded) throw new Error(result.error || "fetch_failed");
  const now = Date.now();
  const dated = result.entries.map(({ item }) => ({
    title: cleanText(item.title || ""),
    url: item.link || item.guid || "",
    publishedAt: parseFeedItemDate(item, { assumeKst: feed.region !== "global" }),
  }));
  const recent = dated.filter(
    (item) => item.publishedAt && now - item.publishedAt.getTime() <= WINDOW_MS
  );
  const keywordMatched = recent.filter((item) =>
    BROAD_KEYWORDS.some((keyword) => containsKeyword(item.title, keyword))
  );
  const sampleUrl = dated[0]?.url || "";
  const newest = dated
    .map((item) => item.publishedAt)
    .filter(Boolean)
    .sort((left, right) => right - left)[0];
  return {
    ok: dated.length > 0,
    items: result.rawCount,
    recent48h: recent.length,
    urlPatternMatched: dated.length,
    keywordMatched48h: keywordMatched.length,
    newest: newest ? newest.toISOString() : null,
    robotsAllowed: sampleUrl ? await isUrlAllowedByRobots(sampleUrl, { timeoutMs: 8_000 }) : null,
    samples: keywordMatched.slice(0, 3).map((item) => item.title),
    rawDateSamples: dated.slice(0, 2).map((item) => `${item.title.slice(0, 30)} → ${item.publishedAt?.toISOString() || "날짜 없음"}`),
    firstTitle: dated[0]?.title || null,
    firstUrl: dated[0]?.url || null,
    skipped: result.skipped || null,
  };
}

async function probeSource(feed) {
  const base = {
    name: feed.name,
    candidate: Boolean(feed.candidate),
    type: feed.type,
    url: sourceUrl(feed),
  };
  if (feed.candidate && !feed.probeUrlOnly) {
    try {
      return { ...base, ...(await probeViaCollector({ ...feed, enabled: true })) };
    } catch (error) {
      return { ...base, ok: false, error: cleanText(error.message).slice(0, 120) };
    }
  }
  if (feed.type !== "rss") {
    return { ...base, ok: null, note: "목록형 수집원은 수집 로그의 source 진단으로 확인" };
  }
  try {
    return { ...base, ...(await probeRss(feed)) };
  } catch (error) {
    return { ...base, ok: false, error: cleanText(error.message).slice(0, 120) };
  }
}

function discoveryMarkdown(discoveries) {
  if (!discoveries.length) return "";
  const lines = ["", "### RSS 안내 페이지에서 찾은 주소"];
  for (const discovery of discoveries) {
    lines.push("", `**${discovery.name}** — ${discovery.guideUrl}${discovery.error ? ` (실패: ${discovery.error})` : ""}`);
    if (!discovery.results.length && !discovery.error) lines.push("- 피드 링크를 찾지 못함");
    for (const result of discovery.results) {
      const status = result.ok ? `정상 ${result.items}건 · 48시간 ${result.recent48h}건 · 최신 ${result.newest || "—"}` : `실패 ${result.error || "(0건)"}`;
      lines.push(`- ${result.url} → ${status}${result.firstTitle ? ` · 예: ${result.firstTitle.slice(0, 40)}` : ""}`);
    }
  }
  return lines.join("\n");
}

function dateDetailMarkdown(results) {
  const targets = results.filter(
    (result) => result.ok && (result.candidate || !result.recent48h) && result.rawDateSamples?.length
  );
  if (!targets.length) return "";
  const lines = ["", "### 날짜 원문 샘플 (최근 48시간 0건이거나 후보인 피드)"];
  for (const result of targets) {
    lines.push(`- **${result.name}**: ${result.rawDateSamples.join(" / ")}${result.firstUrl ? ` · 예시 링크 ${result.firstUrl}` : ""}`);
  }
  return lines.join("\n");
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
  const discoveries = [];
  for (const feed of candidateSourceFeeds.filter((candidate) => candidate.rssGuideUrls?.length)) {
    for (const guideUrl of feed.rssGuideUrls) {
      const discovery = await discoverFeedLinks(guideUrl);
      const preferred = discovery.links.filter((url) => (feed.rssGuideKeywords || []).some((keyword) => url.toLowerCase().includes(keyword)));
      const toProbe = [...new Set([...preferred, ...discovery.links])].slice(0, 12);
      const probed = [];
      for (const url of toProbe) {
        probed.push(
          await probeSource({ ...feed, name: url, type: "rss", feedUrl: url, fetchTimeoutMs: 20_000, probeUrlOnly: true })
        );
      }
      discoveries.push({ name: feed.name, ...discovery, results: probed.map((result) => ({ ...result, url: result.url })) });
    }
  }
  const markdown = `${toMarkdown(results)}${discoveryMarkdown(discoveries)}${dateDetailMarkdown(results)}`;
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
