const fs = require("node:fs/promises");
const path = require("node:path");
const Parser = require("rss-parser");

const {
  allowedSources,
  categories,
  rssSources,
  startupGrowthContextKeywords,
  techCategoryName,
  techEcosystemKeywords,
} = require("./sources");
const { summarizeArticle } = require("./summarize");
const {
  cleanText,
  containsKeyword,
  createArticleId,
  deduplicateArticles,
  formatKstDate,
  formatKstIso,
  isAllowedSource,
  normalizeForMatch,
  parsePublishedDate,
} = require("./utils");

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": "DailyStartupVCBriefing/1.0 RSS Reader" },
  customFields: { item: [["source", "source"]] },
});

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_PATH = path.join(DATA_DIR, "news.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const ARCHIVE_INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");
const ADVERTISING_WORDS = ["광고", "이벤트", "할인", "무료체험", "구독 이벤트", "협찬"];
const MIN_RELEVANCE_SCORE = 12;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sourceNameFromItem(item, feedName) {
  const rawSource = item.source;
  if (typeof rawSource === "string") return cleanText(rawSource);
  if (rawSource && typeof rawSource._ === "string") return cleanText(rawSource._);
  if (rawSource && typeof rawSource["#"] === "string") return cleanText(rawSource["#"]);
  return cleanText(item.creator || item.author || feedName);
}

function stripSourceSuffix(title, source) {
  const normalizedSource = normalizeForMatch(source).replace(/[()]/g, "");
  let cleanedTitle = cleanText(title);

  while (true) {
    const match = cleanedTitle.match(/^(.*)\s[-–—]\s([^–—]{1,50})$/u);
    if (!match) break;

    const normalizedTail = normalizeForMatch(match[2]).replace(/[()]/g, "");
    const isSourceSuffix =
      normalizedTail &&
      normalizedSource &&
      (normalizedTail.includes(normalizedSource) || normalizedSource.includes(normalizedTail));
    if (!isSourceSuffix) break;

    cleanedTitle = match[1].trim();
  }

  return cleanedTitle;
}

function scoreCategories(title, description) {
  return Object.entries(categories)
    .map(([category, keywords]) => {
      const titleHits = keywords.filter((keyword) => containsKeyword(title, keyword));
      const descriptionHits = keywords.filter((keyword) =>
        containsKeyword(description, keyword)
      );
      const keywordScore =
        Math.min(titleHits.length, 3) * 7 + Math.min(descriptionHits.length, 4) * 3;

      return {
        category,
        descriptionHits,
        keywordScore,
        matched: titleHits.length + descriptionHits.length > 0,
        titleHits,
      };
    })
    .sort((left, right) => right.keywordScore - left.keywordScore);
}

function hasAnyKeyword(title, description, keywords) {
  const context = `${title} ${description}`;
  return keywords.some((keyword) => containsKeyword(context, keyword));
}

function hasTechKeyword(title, description) {
  return hasAnyKeyword(title, description, categories[techCategoryName]);
}

function hasEcosystemKeyword(title, description) {
  return hasAnyKeyword(title, description, techEcosystemKeywords);
}

function hasStartupGrowthContext(title, description) {
  return hasAnyKeyword(title, description, startupGrowthContextKeywords);
}

function isStartupEcosystemRelevant(title, description) {
  return (
    hasTechKeyword(title, description) &&
    hasEcosystemKeyword(title, description) &&
    hasStartupGrowthContext(title, description)
  );
}

function freshnessBonus(publishedAt, rangeFrom, rangeTo) {
  const age = rangeTo.getTime() - publishedAt.getTime();
  const range = rangeTo.getTime() - rangeFrom.getTime();
  return Math.max(0, Math.min(4, Math.round(4 * (1 - age / range))));
}

function calculateRelevanceScore(
  { title, description, source, publishedAt },
  bestCategory,
  rangeFrom,
  rangeTo
) {
  let relevanceScore = bestCategory.keywordScore;
  if (isAllowedSource(source, allowedSources)) relevanceScore += 5;
  relevanceScore += freshnessBonus(publishedAt, rangeFrom, rangeTo);
  if (Array.from(title).length < 12) relevanceScore -= 4;

  const adHits = ADVERTISING_WORDS.filter((word) => containsKeyword(title, word)).length;
  relevanceScore -= Math.min(adHits * 4, 8);

  if (bestCategory.category === techCategoryName) {
    const ecosystemTitleHits = techEcosystemKeywords.filter((keyword) =>
      containsKeyword(title, keyword)
    ).length;
    const ecosystemDescriptionHits = techEcosystemKeywords.filter((keyword) =>
      containsKeyword(description, keyword)
    ).length;
    relevanceScore += Math.min(
      ecosystemTitleHits * 5 + ecosystemDescriptionHits * 2,
      12
    );
  }

  return relevanceScore;
}

function scoreArticle({ title, description, source, publishedAt }, rangeFrom, rangeTo) {
  const [bestCategory] = scoreCategories(title, description);
  if (!bestCategory?.matched) return null;

  if (
    bestCategory.category === techCategoryName &&
    !isStartupEcosystemRelevant(title, description)
  ) {
    return null;
  }

  const relevanceScore = calculateRelevanceScore(
    { title, description, source, publishedAt },
    bestCategory,
    rangeFrom,
    rangeTo
  );
  if (relevanceScore < MIN_RELEVANCE_SCORE) return null;

  return { category: bestCategory.category, score: relevanceScore };
}

async function fetchSource(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    console.log(`[수집 완료] ${feed.name}: ${parsed.items?.length || 0}건`);
    return (parsed.items || []).map((item) => ({ item, feedName: feed.name }));
  } catch (error) {
    console.warn(`[수집 실패] ${feed.name}: ${error.message}`);
    return [];
  }
}

function normalizeFeedItem(entry, rangeFrom, rangeTo, includeUnlisted) {
  const { item, feedName } = entry;
  const publishedAt = parsePublishedDate(item.isoDate || item.pubDate || item.published);
  const url = item.link || item.guid;
  if (!publishedAt || publishedAt < rangeFrom || publishedAt > rangeTo || !url) return null;

  const source = sourceNameFromItem(item, feedName);
  const title = stripSourceSuffix(item.title, source);
  const description = cleanText(
    item.contentSnippet || item.description || item.summary || ""
  ).slice(0, 1_000);
  if (!title || (!includeUnlisted && !isAllowedSource(source, allowedSources))) return null;

  const classification = scoreArticle(
    { title, description, source, publishedAt },
    rangeFrom,
    rangeTo
  );
  if (!classification) return null;

  return {
    ...classification,
    title,
    description,
    source,
    url,
    publishedAt,
  };
}

function compareForDedup(left, right) {
  return right.score - left.score || right.publishedAt - left.publishedAt;
}

function compareForOutput(left, right) {
  const leftDate = formatKstDate(left.publishedAt);
  const rightDate = formatKstDate(right.publishedAt);
  return (
    rightDate.localeCompare(leftDate) ||
    right.score - left.score ||
    right.publishedAt - left.publishedAt
  );
}

function limitByCategory(articles, maxItemsPerCategory) {
  const counts = Object.fromEntries(Object.keys(categories).map((category) => [category, 0]));

  return articles.filter((article) => {
    if (counts[article.category] >= maxItemsPerCategory) return false;
    counts[article.category] += 1;
    return true;
  });
}

async function readArchiveDates() {
  const dates = new Set();

  try {
    const savedIndex = JSON.parse(await fs.readFile(ARCHIVE_INDEX_PATH, "utf8"));
    for (const date of savedIndex.dates || []) {
      if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) dates.add(date);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[아카이브 인덱스 재구성] ${error.message}`);
    }
  }

  try {
    const files = await fs.readdir(ARCHIVE_DIR);
    for (const file of files) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/u);
      if (match) dates.add(match[1]);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return [...dates].sort((left, right) => left.localeCompare(right));
}

async function saveBriefing(output, generatedDate) {
  const archivePath = path.join(ARCHIVE_DIR, `${generatedDate}.json`);
  const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(OUTPUT_PATH, serializedOutput, "utf8"),
    fs.writeFile(archivePath, serializedOutput, "utf8"),
  ]);

  const dates = await readArchiveDates();
  if (!dates.includes(generatedDate)) {
    dates.push(generatedDate);
    dates.sort((left, right) => left.localeCompare(right));
  }
  const archiveIndex = {
    dates,
    latest: dates.at(-1) || generatedDate,
  };
  await fs.writeFile(
    ARCHIVE_INDEX_PATH,
    `${JSON.stringify(archiveIndex, null, 2)}\n`,
    "utf8"
  );

  return { archivePath, archiveIndex };
}

async function collectNews() {
  const rangeTo = new Date();
  const rangeFrom = new Date(rangeTo.getTime() - 24 * 60 * 60 * 1_000);
  const includeUnlisted = /^true$/i.test(process.env.ALLOW_UNLISTED_SOURCES || "false");
  const maxItemsPerCategory = readPositiveInteger(
    process.env.MAX_ITEMS_PER_CATEGORY,
    5
  );

  console.log(
    `[수집 시작] ${formatKstIso(rangeFrom)} ~ ${formatKstIso(rangeTo)} / 카테고리당 최대 ${maxItemsPerCategory}건`
  );

  const fetched = (await Promise.all(rssSources.map(fetchSource))).flat();
  const normalized = fetched
    .map((entry) => normalizeFeedItem(entry, rangeFrom, rangeTo, includeUnlisted))
    .filter(Boolean)
    .sort(compareForDedup);
  const selected = limitByCategory(
    deduplicateArticles(normalized).sort(compareForOutput),
    maxItemsPerCategory
  );

  const items = [];
  for (const article of selected) {
    const summary = await summarizeArticle(article);
    items.push({
      id: createArticleId(article),
      category: article.category,
      title: article.title,
      publishedAt: formatKstDate(article.publishedAt),
      summary,
      source: article.source,
      url: article.url,
      score: article.score,
    });
  }

  const categoryCounts = Object.fromEntries(
    Object.keys(categories).map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ])
  );
  const output = {
    generatedAt: formatKstIso(rangeTo),
    range: {
      from: formatKstIso(rangeFrom),
      to: formatKstIso(rangeTo),
    },
    totalCount: items.length,
    categoryCounts,
    items,
  };

  const generatedDate = formatKstDate(rangeTo);
  const { archivePath, archiveIndex } = await saveBriefing(output, generatedDate);
  console.log(`[저장 완료] ${OUTPUT_PATH} (${items.length}건)`);
  console.log(`[아카이브 저장] ${archivePath}`);
  console.log(`[아카이브 인덱스] ${archiveIndex.dates.length}일 / 최신 ${archiveIndex.latest}`);
}

if (require.main === module) {
  collectNews().catch((error) => {
    console.error(`[치명적 오류] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  calculateRelevanceScore,
  collectNews,
  hasEcosystemKeyword,
  hasTechKeyword,
  isStartupEcosystemRelevant,
  scoreArticle,
};
