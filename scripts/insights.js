// 날짜별 아카이브를 모아 최근 7일·30일 추세(data/insights.json)를 만든다.
// 서버·DB 없이 정적 JSON만 사용하며, 구조화 정보는 제목·요약에 명시된 값만 집계한다.
//
//   pnpm run insights   # 아카이브에서 insights.json을 다시 생성
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  canonicalizeUrl,
  cleanText,
  extractStructuredArticleInfo,
  normalizeForMatch,
} = require("./utils");

const DATA_DIR = path.join(__dirname, "..", "data");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const INSIGHTS_PATH = path.join(DATA_DIR, "insights.json");
const DAY_MS = 24 * 60 * 60 * 1_000;
const OVERSEAS_SOURCES = [
  "TechCrunch",
  "Crunchbase",
  "VentureBeat",
  "Sifted",
  "EU-Startups",
  "PitchBook",
  "CB Insights",
];

function isOverseasItem(item) {
  if (item?.category === "해외 VC") return true;
  const source = String(item?.source || "");
  return OVERSEAS_SOURCES.some((hint) => source.includes(hint));
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko"));
}

// "30억5000만 원", "1조 2000억 원" 같은 원화 금액을 억 원 단위 숫자로 바꾼다. 해석이 불확실하면 null.
function parseKrwToEok(value) {
  const text = cleanText(value).replace(/,/gu, "").replace(/^(?:약|총)\s*/u, "");
  if (!/원$/u.test(text)) return null;
  const match = text.match(/^(?:(\d+(?:\.\d+)?)\s*조)?\s*(?:(\d+(?:\.\d+)?)\s*억)?\s*(?:(\d+(?:\.\d+)?)\s*(천만|만))?\s*원$/u);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const jo = Number(match[1] || 0) * 10_000;
  const eok = Number(match[2] || 0);
  const man = match[3] ? Number(match[3]) * (match[4] === "천만" ? 1_000 : 1) / 10_000 : 0;
  const total = jo + eok + man;
  return Number.isFinite(total) && total > 0 ? Math.round(total * 10) / 10 : null;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function loadArchives(dates) {
  const archives = [];
  for (const date of dates) {
    const data = await readJson(path.join(ARCHIVE_DIR, `${date}.json`));
    if (data && Array.isArray(data.items)) archives.push({ date, items: data.items });
  }
  return archives;
}

function itemKey(item) {
  return canonicalizeUrl(item.url) || normalizeForMatch(item.title || "");
}

// 48시간 수집 창 때문에 같은 기사가 이틀 연속 실릴 수 있으므로 URL 기준으로 한 번만 센다.
function uniqueItems(archives) {
  const seen = new Map();
  for (const archive of archives) {
    for (const item of archive.items) {
      const key = itemKey(item);
      if (!key || seen.has(key)) continue;
      const structured = extractStructuredArticleInfo({
        title: item.title || "",
        summary: item.summary || "",
      });
      seen.set(key, {
        briefingDate: archive.date,
        title: cleanText(item.title || ""),
        url: item.url,
        source: cleanText(item.source || ""),
        category: item.category || null,
        publishedAt: item.publishedAt || archive.date,
        overseas: isOverseasItem(item),
        ...structured,
      });
    }
  }
  return [...seen.values()];
}

function summarizeWindow(archives, from, to) {
  const inWindow = archives.filter((archive) => archive.date >= from && archive.date <= to);
  const items = uniqueItems(inWindow);
  const deals = items.filter(
    (item) => item.eventType === "투자유치" && item.company && (item.fundingAmount || item.fundingStage)
  );
  const dealsByCompany = new Map();
  for (const deal of deals.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))) {
    const key = normalizeForMatch(deal.company);
    if (!dealsByCompany.has(key)) dealsByCompany.set(key, deal);
  }
  const uniqueDeals = [...dealsByCompany.values()];
  const krwDeals = uniqueDeals
    .map((deal) => ({ deal, eok: deal.fundingAmount ? parseKrwToEok(deal.fundingAmount) : null }))
    .filter((entry) => entry.eok !== null);

  return {
    from,
    to,
    briefingDays: inWindow.length,
    articleCount: items.length,
    domesticCount: items.filter((item) => !item.overseas).length,
    overseasCount: items.filter((item) => item.overseas).length,
    dealCount: uniqueDeals.length,
    disclosedKrwDealCount: krwDeals.length,
    disclosedKrwTotalEok: Math.round(krwDeals.reduce((sum, entry) => sum + entry.eok, 0) * 10) / 10,
    byCategory: countBy(items.map((item) => item.category)),
    byEventType: countBy(items.map((item) => item.eventType)),
    byIndustry: countBy(items.map((item) => item.industry)),
    byStage: countBy(uniqueDeals.map((deal) => deal.fundingStage)),
    topSources: countBy(items.map((item) => item.source)).slice(0, 8),
    daily: inWindow.map((archive) => ({
      date: archive.date,
      total: archive.items.length,
      overseas: archive.items.filter(isOverseasItem).length,
    })),
    deals: uniqueDeals.slice(0, 20).map((deal) => ({
      date: deal.publishedAt,
      company: deal.company,
      fundingAmount: deal.fundingAmount || null,
      fundingStage: deal.fundingStage || null,
      industry: deal.industry || null,
      overseas: deal.overseas,
      title: deal.title,
      url: deal.url,
      source: deal.source,
    })),
  };
}

async function buildInsights({ archiveDir = ARCHIVE_DIR } = {}) {
  const index = await readJson(path.join(archiveDir, "index.json"));
  let dates = Array.isArray(index?.dates) ? index.dates : [];
  if (!dates.length) {
    const files = await fs.readdir(archiveDir).catch(() => []);
    dates = files.map((file) => file.match(/^(\d{4}-\d{2}-\d{2})\.json$/u)?.[1]).filter(Boolean);
  }
  dates = [...new Set(dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date)).sort();
  const latestDate = dates.at(-1) || null;
  if (!latestDate) return null;

  const archives = await loadArchives(dates.filter((date) => date >= shiftDate(latestDate, -59)));
  const weekly = summarizeWindow(archives, shiftDate(latestDate, -6), latestDate);
  const previousWeek = summarizeWindow(archives, shiftDate(latestDate, -13), shiftDate(latestDate, -7));
  const monthly = summarizeWindow(archives, shiftDate(latestDate, -29), latestDate);
  const previousMonth = summarizeWindow(archives, shiftDate(latestDate, -59), shiftDate(latestDate, -30));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    latestDate,
    weekly: {
      ...weekly,
      previous: {
        articleCount: previousWeek.articleCount,
        dealCount: previousWeek.dealCount,
        briefingDays: previousWeek.briefingDays,
      },
    },
    monthly: {
      ...monthly,
      previous: {
        articleCount: previousMonth.articleCount,
        dealCount: previousMonth.dealCount,
        briefingDays: previousMonth.briefingDays,
      },
    },
  };
}

async function saveInsights(options = {}) {
  const insights = await buildInsights(options);
  if (!insights) return null;
  await fs.writeFile(
    options.outputPath || INSIGHTS_PATH,
    `${JSON.stringify(insights, null, 2)}\n`,
    "utf8"
  );
  return insights;
}

if (require.main === module) {
  saveInsights()
    .then((insights) => {
      if (!insights) {
        console.warn("[인사이트] 아카이브가 없어 생성하지 않았습니다.");
        return;
      }
      console.log(
        `[인사이트] ${insights.latestDate} 기준 7일 ${insights.weekly.articleCount}건·투자 ${insights.weekly.dealCount}건 / 30일 ${insights.monthly.articleCount}건·투자 ${insights.monthly.dealCount}건`
      );
    })
    .catch((error) => {
      console.error(`[인사이트 생성 실패] ${error.stack || error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { buildInsights, parseKrwToEok, saveInsights, summarizeWindow };
