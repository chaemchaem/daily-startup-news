const CATEGORY_LABELS = {
  "VC / AC": "VC / AC",
  "TIPS / LIPS": "TIPS / LIPS",
  "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": "딥테크/AI/ESG",
  "스타트업 / 벤처기업 / 초기창업": "스타트업/초기창업",
  "세컨더리 / 구주매각": "세컨더리",
  "해외 VC": "해외 VC",
};

const filters = [
  { label: "전체", value: "all" },
  { label: "VC/AC", value: "VC / AC" },
  { label: "스타트업/초기창업", value: "스타트업 / 벤처기업 / 초기창업" },
  { label: "TIPS/LIPS", value: "TIPS / LIPS" },
  { label: "딥테크/AI/ESG", value: "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주" },
  { label: "해외 VC", value: "해외 VC" },
];

const OVERSEAS_SOURCE_HINTS = [
  "TechCrunch",
  "Crunchbase",
  "VentureBeat",
  "Sifted",
  "EU-Startups",
  "PitchBook",
  "CB Insights",
];

const OVERSEAS_HOST_HINTS = [
  "techcrunch.com",
  "crunchbase.com",
  "venturebeat.com",
  "sifted.eu",
  "eu-startups.com",
  "pitchbook.com",
  "cbinsights.com",
];

const elements = {
  archiveStatus: document.querySelector("#archive-status"),
  archiveTabs: document.querySelector("#archive-tabs"),
  briefingDate: document.querySelector("#briefing-date"),
  collectionHealth: document.querySelector("#collection-health"),
  collectionRange: document.querySelector("#collection-range"),
  dataStatus: document.querySelector("#data-status"),
  featuredGrid: document.querySelector("#featured-grid"),
  filters: document.querySelector("#filters"),
  generatedAt: document.querySelector("#generated-at"),
  latestBadge: document.querySelector("#latest-badge"),
  latestButton: document.querySelector("#latest-button"),
  newsGrid: document.querySelector("#news-grid"),
  newsSearch: document.querySelector("#news-search"),
  newsSort: document.querySelector("#news-sort"),
  regionFilters: document.querySelector("#region-filters"),
  statistics: document.querySelector("#statistics"),
  totalCount: document.querySelector("#total-count"),
  visibleCount: document.querySelector("#visible-count"),
  viewingDate: document.querySelector("#viewing-date"),
};

let briefing = null;
let activeFilter = "all";
let archiveIndex = { dates: [], latest: null };
let currentDate = null;
let briefingMessage = null;
let loadSequence = 0;
let activeRegion = "all";
let searchQuery = "";
let sortMode = "importance";
let collectionStatus = null;

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatRange(range) {
  if (!range?.from || !range?.to) return "—";
  return `${formatDateTime(range.from)} ~ ${formatDateTime(range.to)}`;
}

function formatBriefingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || "")) return "날짜 미상";
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function formatShortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || "")) return value || "날짜";
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function getBriefingDate(data) {
  const generatedDate = String(data?.generatedAt || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(generatedDate) ? generatedDate : null;
}

function normalizeBriefingData(data) {
  if (!data || typeof data !== "object") throw new Error("브리핑 데이터 형식이 올바르지 않습니다.");
  const items = Array.isArray(data.items)
    ? data.items.filter((item) => item && typeof item === "object")
    : [];
  const categoryCounts = Object.fromEntries(
    Object.keys(CATEGORY_LABELS).map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ])
  );
  return {
    ...data,
    totalCount: items.length,
    categoryCounts,
    items,
  };
}

function hasBriefingItems(data) {
  return Array.isArray(data?.items) && data.items.length > 0;
}

function configureDatePicker() {
  const dates = [...archiveIndex.dates].sort((left, right) => left.localeCompare(right));
  elements.briefingDate.min = dates[0] || "";
  elements.briefingDate.max = dates.at(-1) || "";
  if (currentDate) elements.briefingDate.value = currentDate;
  elements.latestButton.disabled = Boolean(
    briefing && currentDate && currentDate === archiveIndex.latest
  );
}

function renderArchiveTabs() {
  const dates = [...archiveIndex.dates].sort((left, right) => right.localeCompare(left));
  if (!elements.archiveTabs) return;

  if (!dates.length) {
    elements.archiveTabs.replaceChildren(
      createElement("span", "archive-tab-empty", "저장된 날짜 없음")
    );
    return;
  }

  elements.archiveTabs.replaceChildren(
    ...dates.slice(0, 12).map((date) => {
      const button = createElement("button", "archive-tab", formatShortDate(date));
      button.type = "button";
      button.dataset.date = date;
      button.title = `${formatBriefingDate(date)} 브리핑 보기`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(date === currentDate));
      button.addEventListener("click", () => loadArchiveDate(date));
      return button;
    })
  );
}

function renderArchiveHeading({ isLatest = false } = {}) {
  elements.viewingDate.textContent = currentDate
    ? `${formatBriefingDate(currentDate)} 브리핑`
    : "최신 브리핑";
  elements.latestBadge.hidden = !isLatest;
  elements.archiveStatus.textContent = archiveIndex.dates.length
    ? `저장된 브리핑 ${archiveIndex.dates.length}일 · 날짜 탭 또는 달력에서 선택하세요.`
    : "저장된 과거 브리핑이 아직 없습니다.";
  configureDatePicker();
  renderArchiveTabs();
}

function safeArticleUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isOverseasArticle(article) {
  if (article?.category === "해외 VC") return true;
  const source = String(article?.source || "");
  if (OVERSEAS_SOURCE_HINTS.some((hint) => source.includes(hint))) return true;

  try {
    const host = new URL(article?.url || "").hostname.replace(/^www\./u, "");
    return OVERSEAS_HOST_HINTS.some((hint) => host.endsWith(hint));
  } catch {
    return false;
  }
}

function extractClientStructuredInfo(article) {
  const context = `${article?.title || ""} ${article?.summary || ""}`;
  const firstMatch = (pattern) => context.match(pattern)?.[1]?.trim() || null;
  return {
    company:
      article?.company ||
      firstMatch(/\b([A-Z0-9][A-Za-z0-9&._-]{1,39})\s+(?:raises?|raised|secures?|secured)\b/u) ||
      firstMatch(/(?:^|[.!?]\s*)([A-Za-z0-9가-힣][A-Za-z0-9가-힣&·._-]{1,39})(?:은|는|이|가)\s/u),
    fundingAmount:
      article?.fundingAmount ||
      firstMatch(/((?:약\s*|총\s*)?\d[\d,.]*\s*(?:조|억|만)\s*원)/iu) ||
      firstMatch(/([€$£]\s*\d+(?:[.,]\d+)?\s*(?:million|billion|m|bn)?)/iu),
    fundingStage:
      article?.fundingStage ||
      firstMatch(/((?:pre[-\s]?)?seed(?:\s+round)?|(?:series|시리즈)\s*[A-H]|프리[-\s]?[A-H]|시드)/iu),
    eventType:
      article?.eventType ||
      (/(?:투자\s*유치|투자유치|\braises?\b|\braised\b)/iu.test(context)
        ? "투자유치"
        : /(?:TIPS|팁스|LIPS|립스).{0,30}(?:선정|선발)/iu.test(context)
          ? "TIPS·LIPS 선정"
          : /펀드\s*(?:결성|조성)|(?:first|final)\s+close/iu.test(context)
            ? "펀드결성"
            : /실증|\bPoC\b/iu.test(context)
              ? "실증·PoC"
              : /모집/iu.test(context)
                ? "모집"
                : /선정|선발/iu.test(context)
                  ? "선정"
                  : /협약|MOU|맞손/iu.test(context)
                    ? "협약"
                    : null),
    industry: article?.industry || null,
  };
}

function articleImportance(article) {
  const info = extractClientStructuredInfo(article);
  return (
    Number(article?.score || 0) +
    (isOverseasArticle(article) ? 0 : 8) +
    (info.fundingAmount ? 8 : 0) +
    (info.fundingStage ? 6 : 0) +
    (info.eventType ? 4 : 0) +
    (info.company ? 2 : 0)
  );
}

function sortArticlesForDisplay(items, mode = sortMode) {
  return [...items].sort((left, right) => {
    if (mode === "latest") {
      return (
        String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")) ||
        Number(isOverseasArticle(left)) - Number(isOverseasArticle(right)) ||
        articleImportance(right) - articleImportance(left)
      );
    }
    return (
      Number(isOverseasArticle(left)) - Number(isOverseasArticle(right)) ||
      articleImportance(right) - articleImportance(left) ||
      String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""))
    );
  });
}

function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, " ")
    .trim();
}

function articleMatchesSearch(article) {
  if (!searchQuery) return true;
  const info = extractClientStructuredInfo(article);
  return normalizedSearchText(
    [article.title, article.summary, article.source, info.company].filter(Boolean).join(" ")
  ).includes(searchQuery);
}

function featuredEventKey(article) {
  const info = extractClientStructuredInfo(article);
  if (info.company && (info.fundingAmount || info.eventType)) {
    return normalizedSearchText(
      [info.company, info.fundingAmount, info.fundingStage, info.eventType]
        .filter(Boolean)
        .join("|")
    );
  }
  return normalizedSearchText(article.title)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 36);
}

function selectFeaturedArticles(items, limit = 3) {
  const pool = sortArticlesForDisplay(items, "importance");
  const selected = [];
  const eventKeys = new Set();
  const usedCategories = new Set();

  while (selected.length < limit) {
    const candidate = pool
      .filter((article) => !eventKeys.has(featuredEventKey(article)))
      .sort(
        (left, right) =>
          articleImportance(right) +
            (usedCategories.has(right.category) ? 0 : 7) -
            (articleImportance(left) +
              (usedCategories.has(left.category) ? 0 : 7))
      )[0];
    if (!candidate) break;
    selected.push(candidate);
    eventKeys.add(featuredEventKey(candidate));
    usedCategories.add(candidate.category);
    pool.splice(pool.indexOf(candidate), 1);
  }
  return selected;
}

function renderFilters() {
  elements.filters.replaceChildren(
    ...filters.map((filter) => {
      const button = createElement("button", "filter-button", filter.label);
      button.type = "button";
      button.dataset.filter = filter.value;
      button.setAttribute("aria-pressed", String(filter.value === activeFilter));
      button.addEventListener("click", () => {
        activeFilter = filter.value;
        renderFilters();
        renderArticles();
      });
      return button;
    })
  );
}

function renderRegionFilters() {
  if (!elements.regionFilters) return;
  for (const button of elements.regionFilters.querySelectorAll("[data-region]")) {
    button.setAttribute("aria-pressed", String(button.dataset.region === activeRegion));
  }
}

function renderStatistics() {
  const counts = briefing?.categoryCounts || {};
  const items = Array.isArray(briefing?.items) ? briefing.items : [];
  const domesticCount = items.filter((item) => !isOverseasArticle(item)).length;
  const overseasCount = items.length - domesticCount;
  const activeCategoryCount = Object.values(counts).filter((count) => count > 0).length;
  const stats = [
    { label: "전체 기사 수", value: items.length, unit: "건" },
    { label: "국내 기사 수", value: domesticCount, unit: "건" },
    { label: "해외 기사 수", value: overseasCount, unit: "건" },
    { label: "VC/AC 기사 수", value: counts["VC / AC"] || 0, unit: "건" },
    { label: "주요 카테고리 수", value: activeCategoryCount, unit: "개" },
  ];

  const cards = stats.map((stat) => {
    const card = createElement("article", "stat-card");
    card.append(createElement("p", "stat-label", stat.label));

    const value = createElement("p", "stat-value", String(stat.value));
    value.append(createElement("span", "stat-unit", stat.unit));
    card.append(value);
    return card;
  });

  elements.statistics.replaceChildren(...cards);
}

function createArticleCard(article, { featuredRank = null } = {}) {
  const card = createElement(
    "article",
    `news-card${featuredRank ? " featured-card" : ""}`
  );
  const badgeLine = createElement("div", "card-badges");
  const sourceText = article.source || "출처 미상";
  const countryText = isOverseasArticle(article) ? "해외" : "국내";
  const structuredInfo = extractClientStructuredInfo(article);

  if (featuredRank) {
    badgeLine.append(createElement("span", "featured-rank", `핵심 ${featuredRank}`));
  }
  badgeLine.append(
    createElement(
      "span",
      "category-badge",
      CATEGORY_LABELS[article.category] || article.category || "기타"
    ),
    createElement("span", "source-badge", sourceText),
    createElement(
      "span",
      `country-badge ${countryText === "해외" ? "is-overseas" : ""}`,
      countryText
    )
  );

  const title = createElement("h3", "card-title", article.title || "제목 없음");
  const meta = createElement("div", "card-meta");
  meta.append(createElement("time", "card-date", article.publishedAt || "날짜 미상"));
  const detailBadges = createElement("div", "detail-badges");
  for (const [className, value] of [
    ["amount", structuredInfo.fundingAmount],
    ["stage", structuredInfo.fundingStage],
    ["event", structuredInfo.eventType],
  ]) {
    if (value) {
      detailBadges.append(
        createElement("span", `detail-badge is-${className}`, value)
      );
    }
  }
  const summary = createElement(
    "p",
    `card-summary${article.summary ? "" : " is-unavailable"}`,
    article.summary || "본문 요약을 제공할 수 없는 기사입니다."
  );
  card.append(badgeLine, title, meta);
  if (detailBadges.childElementCount) card.append(detailBadges);
  card.append(summary);

  const url = safeArticleUrl(article.url);
  if (url) {
    const link = createElement("a", "article-link", "원문 보기");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${article.title || "기사"} 원문 보기 (새 탭)`);
    card.append(link);
  }

  return card;
}

function renderFeaturedArticles() {
  if (!elements.featuredGrid) return;
  if (briefingMessage) {
    elements.featuredGrid.replaceChildren(
      createElement("div", "state-panel compact", briefingMessage)
    );
    return;
  }
  const items = Array.isArray(briefing?.items) ? briefing.items : [];
  const featured = selectFeaturedArticles(items);
  if (!featured.length) {
    elements.featuredGrid.replaceChildren(
      createElement("div", "state-panel compact", "선정할 핵심 기사가 없습니다.")
    );
    return;
  }
  elements.featuredGrid.replaceChildren(
    ...featured.map((article, index) =>
      createArticleCard(article, { featuredRank: index + 1 })
    )
  );
}

function renderArticles() {
  if (briefingMessage) {
    elements.visibleCount.textContent = "0건 표시";
    elements.newsGrid.replaceChildren(
      createElement("div", "state-panel", briefingMessage)
    );
    return;
  }

  const allItems = Array.isArray(briefing?.items) ? briefing.items : [];
  const visibleItems = sortArticlesForDisplay(
    allItems.filter((item) => {
      if (activeFilter !== "all" && item.category !== activeFilter) return false;
      if (activeRegion === "domestic" && isOverseasArticle(item)) return false;
      if (activeRegion === "overseas" && !isOverseasArticle(item)) return false;
      return articleMatchesSearch(item);
    }),
    sortMode
  );

  elements.visibleCount.textContent = `${visibleItems.length}건 표시`;

  if (!visibleItems.length) {
    elements.newsGrid.replaceChildren(
      createElement("div", "state-panel", "선택한 카테고리의 신규 기사가 없습니다.")
    );
    return;
  }

  elements.newsGrid.replaceChildren(...visibleItems.map(createArticleCard));
}

function renderBriefing({ isLatest = false, statusText = "" } = {}) {
  briefingMessage = null;
  elements.generatedAt.textContent = formatDateTime(briefing.generatedAt);
  elements.collectionRange.textContent = formatRange(briefing.range);
  elements.totalCount.textContent = String(briefing.items.length);
  elements.dataStatus.textContent =
    statusText ||
    (isLatest ? "최신 수집 데이터" : `${formatBriefingDate(currentDate)} 아카이브`);
  renderArchiveHeading({ isLatest });
  renderStatistics();
  renderFeaturedArticles();
  renderFilters();
  renderRegionFilters();
  renderArticles();
}

function renderMissingArchive(date) {
  briefing = null;
  currentDate = date;
  briefingMessage = "해당 날짜의 브리핑 데이터가 없습니다.";
  elements.generatedAt.textContent = "—";
  elements.collectionRange.textContent = "—";
  elements.totalCount.textContent = "0";
  elements.dataStatus.textContent = "아카이브 없음";
  renderArchiveHeading();
  renderStatistics();
  renderFeaturedArticles();
  renderFilters();
  renderRegionFilters();
  renderArticles();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function renderCollectionStatus() {
  if (!elements.collectionHealth) return;
  const lastRun = new Date(collectionStatus?.lastRunAt || "");
  const ageMs = Date.now() - lastRun.getTime();
  const isRecent = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 36 * 60 * 60 * 1_000;
  const healthy = collectionStatus?.success === true && isRecent;

  elements.collectionHealth.className = `collection-health ${
    healthy ? "is-healthy" : "is-delayed"
  }`;
  elements.collectionHealth.textContent = healthy ? "정상 업데이트" : "갱신 지연";
  const statusDetails = collectionStatus
    ? [
        `마지막 실행 ${formatDateTime(collectionStatus.lastRunAt)}`,
        ...(Number.isFinite(collectionStatus.rawArticleCount)
          ? [`원본 ${collectionStatus.rawArticleCount}건`]
          : []),
        ...(Number.isFinite(collectionStatus.candidateArticleCount)
          ? [`후보 ${collectionStatus.candidateArticleCount}건`]
          : []),
        ...(Number.isFinite(collectionStatus.finalArticleCount)
          ? [`최종 ${collectionStatus.finalArticleCount}건`]
          : []),
      ]
    : [];
  elements.collectionHealth.title = statusDetails.length
    ? statusDetails.join(" · ")
    : "수집 상태 파일을 확인할 수 없습니다.";
}

async function loadCollectionStatus() {
  try {
    collectionStatus = await fetchJson("data/status.json");
  } catch (error) {
    console.warn("수집 상태 데이터를 불러오지 못했습니다.", error);
    collectionStatus = null;
  }
  renderCollectionStatus();
}

async function loadArchiveIndex() {
  try {
    const data = await fetchJson("data/archive/index.json");
    archiveIndex = {
      dates: Array.isArray(data.dates)
        ? data.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date)).sort()
        : [],
      latest: /^\d{4}-\d{2}-\d{2}$/u.test(data.latest || "") ? data.latest : null,
    };
  } catch (error) {
    console.warn("아카이브 날짜 목록을 불러오지 못했습니다.", error);
    archiveIndex = { dates: [], latest: null };
  }
  configureDatePicker();
}

async function loadLatestBriefing() {
  const sequence = ++loadSequence;
  elements.dataStatus.textContent = "최신 브리핑을 불러오는 중입니다.";
  try {
    let data = null;
    let statusText = "";
    let isLatestData = true;
    try {
      data = await fetchJson("data/news.json");
    } catch (error) {
      console.warn("최신 JSON을 불러오지 못해 아카이브를 확인합니다.", error);
    }

    if (!hasBriefingItems(data)) {
      const archiveDates = [...archiveIndex.dates].sort((left, right) => right.localeCompare(left));
      for (const date of archiveDates) {
        try {
          const archived = await fetchJson(`data/archive/${date}.json`);
          if (!hasBriefingItems(archived)) continue;
          data = archived;
          isLatestData = false;
          statusText = "최신 수집이 비어 있어 최근 보존 데이터를 표시 중";
          break;
        } catch (error) {
          console.warn(`${date} 아카이브 fallback을 불러오지 못했습니다.`, error);
        }
      }
    }
    if (!data) throw new Error("표시할 최신 또는 아카이브 데이터가 없습니다.");
    if (sequence !== loadSequence) return;

    briefing = normalizeBriefingData(data);
    currentDate = getBriefingDate(data) || archiveIndex.latest;
    renderBriefing({ isLatest: isLatestData, statusText });
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error("최신 뉴스 데이터를 불러오지 못했습니다.", error);
    briefingMessage = "뉴스 데이터를 불러오지 못했습니다. 로컬 서버로 다시 확인해 주세요.";
    elements.dataStatus.textContent = "데이터 로드 실패";
    renderArchiveHeading();
    renderStatistics();
    renderFeaturedArticles();
    renderFilters();
    renderRegionFilters();
    renderArticles();
  }
}

async function loadArchiveDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date || "")) return;

  const sequence = ++loadSequence;
  currentDate = date;
  elements.viewingDate.textContent = `${formatBriefingDate(date)} 브리핑`;
  elements.dataStatus.textContent = "선택한 브리핑을 불러오는 중입니다.";
  elements.briefingDate.value = date;

  try {
    let data;
    let usedLatestFallback = false;
    try {
      data = await fetchJson(`data/archive/${date}.json`);
    } catch (error) {
      if (date !== archiveIndex.latest) throw error;
      data = await fetchJson("data/news.json");
      usedLatestFallback = true;
    }
    if (date === archiveIndex.latest && !hasBriefingItems(data)) {
      const latestData = await fetchJson("data/news.json");
      if (hasBriefingItems(latestData) || !data) {
        data = latestData;
        usedLatestFallback = true;
      }
    }
    if (sequence !== loadSequence) return;

    briefing = normalizeBriefingData(data);
    currentDate = getBriefingDate(data) || date;
    renderBriefing({
      isLatest: usedLatestFallback,
      statusText: usedLatestFallback ? "최신 JSON fallback 데이터" : "",
    });
  } catch (error) {
    if (sequence !== loadSequence) return;
    if (error.status !== 404) console.error("아카이브를 불러오지 못했습니다.", error);
    renderMissingArchive(date);
  }
}

elements.briefingDate.addEventListener("change", (event) => {
  const date = event.target.value;
  if (date) loadArchiveDate(date);
});

elements.latestButton.addEventListener("click", () => loadLatestBriefing());
elements.newsSearch?.addEventListener("input", (event) => {
  searchQuery = normalizedSearchText(event.target.value);
  renderArticles();
});
elements.newsSort?.addEventListener("change", (event) => {
  sortMode = event.target.value === "latest" ? "latest" : "importance";
  renderArticles();
});
elements.regionFilters?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region]");
  if (!button || !elements.regionFilters.contains(button)) return;
  activeRegion = ["domestic", "overseas"].includes(button.dataset.region)
    ? button.dataset.region
    : "all";
  renderRegionFilters();
  renderArticles();
});

renderFilters();
renderRegionFilters();

async function initialize() {
  await Promise.all([loadArchiveIndex(), loadCollectionStatus()]);
  await loadLatestBriefing();
}

initialize();
