const CATEGORY_LABELS = {
  "VC / AC": "VC / AC",
  "TIPS / LIPS": "TIPS / LIPS",
  "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": "딥테크·AI",
  "스타트업 / 벤처기업 / 초기창업": "스타트업",
  "세컨더리 / 구주매각": "세컨더리",
  "해외 VC": "해외 VC",
};

const filters = [
  { label: "전체", value: "all" },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value })),
];

const elements = {
  archiveStatus: document.querySelector("#archive-status"),
  briefingDate: document.querySelector("#briefing-date"),
  collectionRange: document.querySelector("#collection-range"),
  dataStatus: document.querySelector("#data-status"),
  filters: document.querySelector("#filters"),
  generatedAt: document.querySelector("#generated-at"),
  latestBadge: document.querySelector("#latest-badge"),
  latestButton: document.querySelector("#latest-button"),
  newsGrid: document.querySelector("#news-grid"),
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

function getBriefingDate(data) {
  const generatedDate = String(data?.generatedAt || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(generatedDate) ? generatedDate : null;
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

function renderArchiveHeading({ isLatest = false } = {}) {
  elements.viewingDate.textContent = currentDate
    ? `${formatBriefingDate(currentDate)} 브리핑`
    : "최신 브리핑";
  elements.latestBadge.hidden = !isLatest;
  elements.archiveStatus.textContent = archiveIndex.dates.length
    ? `저장된 브리핑 ${archiveIndex.dates.length}일 · 달력에서 날짜를 선택하세요.`
    : "저장된 과거 브리핑이 아직 없습니다.";
  configureDatePicker();
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

function renderStatistics() {
  const counts = briefing?.categoryCounts || {};
  const cards = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
    const card = createElement("article", "stat-card");
    card.append(createElement("p", "stat-label", label));

    const value = createElement("p", "stat-value", String(counts[category] || 0));
    value.append(createElement("span", "stat-unit", "건"));
    card.append(value);
    return card;
  });

  elements.statistics.replaceChildren(...cards);
}

function createArticleCard(article) {
  const card = createElement("article", "news-card");
  const topLine = createElement("div", "card-topline");
  topLine.append(
    createElement(
      "span",
      "category-badge",
      CATEGORY_LABELS[article.category] || article.category || "기타"
    ),
    createElement("time", "card-date", article.publishedAt || "날짜 미상")
  );

  const title = createElement("h3", "card-title", article.title || "제목 없음");
  const source = createElement("p", "card-source", article.source || "출처 미상");
  const summary = createElement("p", "card-summary", article.summary || "요약이 없습니다.");
  card.append(topLine, title, source, summary);

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

function renderArticles() {
  if (briefingMessage) {
    elements.visibleCount.textContent = "0건 표시";
    elements.newsGrid.replaceChildren(
      createElement("div", "state-panel", briefingMessage)
    );
    return;
  }

  const allItems = Array.isArray(briefing?.items) ? briefing.items : [];
  const visibleItems =
    activeFilter === "all"
      ? allItems
      : allItems.filter((item) => item.category === activeFilter);

  elements.visibleCount.textContent = `${visibleItems.length}건 표시`;

  if (!visibleItems.length) {
    elements.newsGrid.replaceChildren(
      createElement("div", "state-panel", "선택한 카테고리의 신규 기사가 없습니다.")
    );
    return;
  }

  elements.newsGrid.replaceChildren(...visibleItems.map(createArticleCard));
}

function renderBriefing({ isLatest = false } = {}) {
  briefingMessage = null;
  elements.generatedAt.textContent = formatDateTime(briefing.generatedAt);
  elements.collectionRange.textContent = formatRange(briefing.range);
  elements.totalCount.textContent = String(briefing.totalCount || 0);
  elements.dataStatus.textContent = isLatest
    ? "최신 수집 데이터"
    : `${formatBriefingDate(currentDate)} 아카이브`;
  renderArchiveHeading({ isLatest });
  renderStatistics();
  renderFilters();
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
  renderFilters();
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
    let data;
    try {
      data = await fetchJson("data/news.json");
    } catch (error) {
      if (!archiveIndex.latest) throw error;
      data = await fetchJson(`data/archive/${archiveIndex.latest}.json`);
    }
    if (sequence !== loadSequence) return;

    briefing = data;
    currentDate = getBriefingDate(data) || archiveIndex.latest;
    renderBriefing({ isLatest: true });
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error("최신 뉴스 데이터를 불러오지 못했습니다.", error);
    briefingMessage = "뉴스 데이터를 불러오지 못했습니다. 로컬 서버로 다시 확인해 주세요.";
    elements.dataStatus.textContent = "데이터 로드 실패";
    renderArchiveHeading();
    renderStatistics();
    renderFilters();
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
    const data = await fetchJson(`data/archive/${date}.json`);
    if (sequence !== loadSequence) return;

    briefing = data;
    renderBriefing({ isLatest: date === archiveIndex.latest });
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

renderFilters();

async function initialize() {
  await loadArchiveIndex();
  await loadLatestBriefing();
}

initialize();
