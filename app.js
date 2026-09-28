// Daily Startup & VC Briefing — 정적 페이지 렌더러
// 데이터: data/news.json, data/archive/*.json, data/status.json, data/insights.json
// 이 파일을 수정하면 index.html의 ?v= 값(ASSET_VERSION)을 함께 올린다.

const CATEGORY_LABELS = {
  "VC / AC": "VC/AC",
  "TIPS / LIPS": "TIPS/LIPS",
  "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": "딥테크·AI·ESG",
  "스타트업 / 벤처기업 / 초기창업": "스타트업·초기창업",
  "세컨더리 / 구주매각": "세컨더리·회수",
  "해외 VC": "해외 VC",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

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

const SKIP_REASON_LABELS = {
  olderThanRange: "기간 이전",
  newerThanRange: "기간 이후",
  dateMissing: "날짜 없음",
  urlMissing: "링크 없음",
  urlPatternMismatch: "링크 형식 불일치",
  keywordMissing: "키워드 없음",
  robotsDisallowed: "robots 차단",
  detailFailed: "상세 페이지 실패",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const $ = (selector) => document.querySelector(selector);

const elements = {
  archiveStatus: $("#archive-status"),
  archiveStrip: $("#archive-strip"),
  briefingDate: $("#briefing-date"),
  categoryTabs: $("#category-tabs"),
  dailyChart: $("#daily-chart"),
  dateline: $("#dateline"),
  dealRows: $("#deal-rows"),
  dealSummary: $("#deal-summary"),
  eventBars: $("#event-bars"),
  frontGrid: $("#front-grid"),
  industryBars: $("#industry-bars"),
  issueNote: $("#issue-note"),
  latestButton: $("#latest-button"),
  newsSearch: $("#news-search"),
  newsSort: $("#news-sort"),
  numbersLine: $("#numbers-line"),
  periodToggle: $("#period-toggle"),
  rangeText: $("#range-text"),
  regionFilters: $("#region-filters"),
  runStatus: $("#run-status"),
  sourceBars: $("#source-bars"),
  sourceDetails: $("#source-details"),
  sourceRows: $("#source-rows"),
  statusSummary: $("#status-summary"),
  storyList: $("#story-list"),
  trendSummary: $("#trend-summary"),
  visibleCount: $("#visible-count"),
};

const state = {
  briefing: null,
  briefingMessage: null,
  currentDate: null,
  isLatest: false,
  archiveIndex: { dates: [], latest: null },
  status: null,
  insights: null,
  period: "weekly",
  category: "all",
  region: "all",
  search: "",
  sort: "importance",
  loadSequence: 0,
};

// ---------- 공통 유틸 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value || "");
}

function kstParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return parts;
}

function formatKstDateTime(value) {
  const parts = kstParts(value);
  if (!parts) return "—";
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatLongDate(isoDate) {
  if (!isIsoDate(isoDate)) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}년 ${month}월 ${day}일 ${weekday}요일`;
}

function formatShortDate(isoDate) {
  if (!isIsoDate(isoDate)) return isoDate || "";
  const [, month, day] = isoDate.split("-").map(Number);
  return `${month}.${day}`;
}

function weekdayOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, " ")
    .trim();
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

// ---------- 기사 해석 ----------

function isOverseas(article) {
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

// 구조화 정보는 수집 단계에서 저장된 값만 쓴다. 브라우저에서 추정하지 않는다.
function structuredInfo(article) {
  return {
    company: article?.company || null,
    fundingAmount: article?.fundingAmount || null,
    fundingStage: article?.fundingStage || null,
    eventType: article?.eventType || null,
    industry: article?.industry || null,
  };
}

function importance(article) {
  const info = structuredInfo(article);
  return (
    Number(article?.score || 0) +
    (isOverseas(article) ? 0 : 8) +
    (info.fundingAmount ? 8 : 0) +
    (info.fundingStage ? 6 : 0) +
    (info.eventType ? 4 : 0) +
    (info.company ? 2 : 0) +
    (article?.summary ? 0 : -12)
  );
}

function sortArticles(items, mode) {
  return [...items].sort((left, right) => {
    if (mode === "latest") {
      return (
        String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")) ||
        Number(isOverseas(left)) - Number(isOverseas(right)) ||
        importance(right) - importance(left)
      );
    }
    return (
      Number(isOverseas(left)) - Number(isOverseas(right)) ||
      importance(right) - importance(left) ||
      String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""))
    );
  });
}

function eventKey(article) {
  const info = structuredInfo(article);
  if (info.company && (info.fundingAmount || info.eventType)) {
    return normalizeSearch([info.company, info.fundingAmount, info.eventType].filter(Boolean).join("|"));
  }
  return normalizeSearch(article.title).replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 36);
}

// 오늘의 핵심: 중요도 + 국내 우선 + 카테고리 다양성 + 같은 사건 중복 제거.
function selectFeatured(items, limit = 3) {
  const pool = sortArticles(items, "importance");
  const selected = [];
  const usedKeys = new Set();
  const usedCategories = new Set();
  const hasDomestic = pool.some((article) => !isOverseas(article));
  while (selected.length < limit) {
    const candidate = pool
      .filter((article) => !usedKeys.has(eventKey(article)))
      // 1면 첫 기사는 국내 기사가 있으면 국내 기사로 고정한다.
      .filter((article) => selected.length > 0 || !hasDomestic || !isOverseas(article))
      .sort(
        (left, right) =>
          importance(right) + (usedCategories.has(right.category) ? 0 : 7) -
          (importance(left) + (usedCategories.has(left.category) ? 0 : 7))
      )[0];
    if (!candidate) break;
    selected.push(candidate);
    usedKeys.add(eventKey(candidate));
    usedCategories.add(candidate.category);
    pool.splice(pool.indexOf(candidate), 1);
  }
  return selected;
}

function matchesSearch(article) {
  if (!state.search) return true;
  const info = structuredInfo(article);
  return normalizeSearch(
    [article.title, article.summary, article.source, info.company, CATEGORY_LABELS[article.category]]
      .filter(Boolean)
      .join(" ")
  ).includes(state.search);
}

// ---------- 기사 렌더링 ----------

function renderStory(article, { headingLevel = "h3" } = {}) {
  const fragment = document.createDocumentFragment();
  const info = structuredInfo(article);

  const kicker = el("p", "kicker");
  kicker.append(
    el("span", "kicker-category", CATEGORY_LABELS[article.category] || article.category || "기타"),
    el("span", null, article.source || "출처 미상"),
    el("span", null, isOverseas(article) ? "해외" : "국내")
  );
  if (isIsoDate(article.publishedAt)) {
    const time = el("time", null, formatShortDate(article.publishedAt));
    time.dateTime = article.publishedAt;
    kicker.append(time);
  }

  const title = el(headingLevel, "story-title");
  const url = safeUrl(article.url);
  if (url) {
    const link = el("a", null, article.title || "제목 없음");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    title.append(link);
  } else {
    title.textContent = article.title || "제목 없음";
  }

  const summary = el(
    "p",
    `story-summary${article.summary ? "" : " is-unavailable"}`,
    article.summary || "본문에서 안전하게 요약할 문장을 찾지 못했습니다. 원문을 확인하세요."
  );

  fragment.append(kicker, title, summary);

  const dealParts = [
    info.eventType,
    info.company,
    info.fundingStage,
    info.fundingAmount,
  ].filter(Boolean);
  if (dealParts.length >= 2 || info.fundingAmount || info.fundingStage) {
    const deal = el("p", "deal-line");
    deal.setAttribute("aria-label", "기사에 명시된 정보");
    if (info.eventType) deal.append(el("span", null, info.eventType));
    if (info.company) deal.append(el("span", null, info.company));
    if (info.fundingStage) deal.append(el("span", null, info.fundingStage));
    if (info.fundingAmount) deal.append(el("span", "deal-amount", info.fundingAmount));
    fragment.append(deal);
  }

  if (url) {
    const source = el("a", "source-link", `${article.source || "원문"}에서 읽기`);
    source.href = url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.setAttribute("aria-label", `${article.title || "기사"} 원문 보기 (새 탭)`);
    fragment.append(source);
  }
  return fragment;
}

function renderFront() {
  const grid = elements.frontGrid;
  if (state.briefingMessage) {
    grid.replaceChildren(el("p", "empty-note", state.briefingMessage));
    elements.numbersLine.replaceChildren();
    return;
  }
  const items = state.briefing?.items || [];
  const featured = selectFeatured(items);
  if (!featured.length) {
    grid.replaceChildren(el("p", "empty-note", "이 날짜에는 선별된 기사가 없습니다."));
  } else {
    const lead = el("article", "front-story front-lead");
    lead.append(renderStory(featured[0]));
    const side = el("div", "front-side");
    for (const article of featured.slice(1)) {
      const story = el("article", "front-story");
      story.append(renderStory(article));
      side.append(story);
    }
    grid.replaceChildren(lead, side);
  }

  const domestic = items.filter((item) => !isOverseas(item)).length;
  const deals = items.filter((item) => structuredInfo(item).eventType === "투자유치").length;
  const categories = new Set(items.map((item) => item.category).filter(Boolean)).size;
  const parts = [
    ["기사", items.length, "건"],
    ["국내", domestic, "건"],
    ["해외", items.length - domestic, "건"],
    ["투자유치", deals, "건"],
    ["카테고리", categories, "개"],
  ];
  const line = elements.numbersLine;
  line.replaceChildren();
  parts.forEach(([label, value, unit], index) => {
    if (index) line.append(el("span", "sep", "|"));
    const chunk = el("span");
    chunk.append(`${label} `, el("strong", null, value), unit);
    line.append(chunk);
  });
}

function renderCategoryTabs() {
  const items = state.briefing?.items || [];
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ])
  );
  const tabs = [["all", "전체", items.length]].concat(
    CATEGORY_ORDER.map((category) => [category, CATEGORY_LABELS[category], counts[category]])
  );
  elements.categoryTabs.replaceChildren(
    ...tabs.map(([value, label, count]) => {
      const button = el("button", null, label);
      button.type = "button";
      button.dataset.category = value;
      button.setAttribute("aria-pressed", String(state.category === value));
      button.append(el("span", "count", count));
      return button;
    })
  );
}

function renderStoryList() {
  const list = elements.storyList;
  if (state.briefingMessage) {
    elements.visibleCount.textContent = "";
    list.replaceChildren(el("li", "empty-note", state.briefingMessage));
    return;
  }
  const items = state.briefing?.items || [];
  const visible = sortArticles(
    items.filter((item) => {
      if (state.category !== "all" && item.category !== state.category) return false;
      if (state.region === "domestic" && isOverseas(item)) return false;
      if (state.region === "overseas" && !isOverseas(item)) return false;
      return matchesSearch(item);
    }),
    state.sort
  );
  elements.visibleCount.textContent = `${visible.length}건 / 전체 ${items.length}건`;
  if (!visible.length) {
    list.replaceChildren(el("li", "empty-note", "조건에 맞는 기사가 없습니다."));
    return;
  }
  list.replaceChildren(
    ...visible.map((article) => {
      const item = el("li");
      item.append(renderStory(article));
      return item;
    })
  );
}

function renderMasthead() {
  const briefing = state.briefing;
  const date = state.currentDate;
  const dateline = elements.dateline;
  dateline.replaceChildren();
  if (isIsoDate(date)) {
    dateline.append(el("strong", null, formatLongDate(date)));
    const issueIndex = state.archiveIndex.dates.indexOf(date);
    if (issueIndex >= 0) dateline.append(`  ·  제${issueIndex + 1}호`);
    if (!state.isLatest) dateline.append("  ·  지난 브리핑");
  } else {
    dateline.textContent = "—";
  }
  const range = briefing?.range;
  elements.rangeText.textContent =
    range?.from && range?.to
      ? `수집 기간 ${formatKstDateTime(range.from)} – ${formatKstDateTime(range.to)} (KST).`
      : "";
  elements.issueNote.textContent = briefing?.collectedAt
    ? `${formatKstDateTime(briefing.collectedAt)} 수집`
    : "";
}

// ---------- 수집 상태 ----------

function renderRunStatus() {
  const status = state.status;
  const node = elements.runStatus;
  if (!status) {
    node.className = "run-status";
    node.textContent = "수집 상태 정보 없음";
    elements.statusSummary.textContent = "수집 상태 파일(data/status.json)을 읽지 못했습니다.";
    return;
  }
  const lastRun = new Date(status.lastRunAt);
  const ageHours = (Date.now() - lastRun.getTime()) / 3_600_000;
  const recent = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= 36;
  let tone = "is-ok";
  let text = `${formatKstDateTime(status.lastRunAt)} 수집 완료`;
  if (!recent) {
    tone = "is-bad";
    text = `갱신 지연 · 마지막 실행 ${formatKstDateTime(status.lastRunAt)}`;
  } else if (!status.success && status.message === "empty_result_preserved") {
    tone = "is-warn";
    text = `${formatKstDateTime(status.lastRunAt)} 수집 · 새로 선별된 기사 없음`;
  } else if (!status.success) {
    tone = "is-bad";
    text = `${formatKstDateTime(status.lastRunAt)} 수집 실패`;
  } else if (Number(status.sourceFailureCount) > 0) {
    tone = "is-warn";
    text = `${formatKstDateTime(status.lastRunAt)} 수집 · 일부 수집원 실패 ${status.sourceFailureCount}곳`;
  }
  node.className = `run-status ${tone}`;
  node.textContent = text;

  const summary = [
    `마지막 실행 ${formatKstDateTime(status.lastRunAt)}`,
    status.lastSuccessfulRunAt ? `마지막 저장 ${formatKstDateTime(status.lastSuccessfulRunAt)}` : null,
    `원본 ${status.rawArticleCount ?? 0}건 → 본문 확인 ${status.candidateArticleCount ?? 0}건 → 최종 ${status.finalArticleCount ?? 0}건`,
    `수집원 ${status.sourceSuccessCount ?? 0}곳 정상, ${status.sourceFailureCount ?? 0}곳 실패`,
  ].filter(Boolean);
  elements.statusSummary.textContent = `${summary.join(". ")}.`;
  if (status.message === "empty_result_preserved") {
    elements.statusSummary.textContent +=
      " 마지막 실행에서 기준을 통과한 기사가 없어 이전 브리핑을 그대로 두었습니다.";
  }
  renderSourceTable(status.sources);
}

function renderSourceTable(sources) {
  if (!Array.isArray(sources) || !sources.length) {
    const row = el("tr");
    const cell = el("td", "source-note", "다음 수집부터 수집원별 결과가 표시됩니다.");
    cell.colSpan = 7;
    row.append(cell);
    elements.sourceRows.replaceChildren(row);
    return;
  }
  elements.sourceRows.replaceChildren(
    ...sources.map((source) => {
      const row = el("tr");
      const name = el("td", null, source.name);
      if (source.candidate) name.append(el("span", "source-note", " (검증 중)"));
      if (source.region === "global") name.append(el("span", "source-note", " · 해외"));
      let stateText = "정상";
      let stateClass = "state-ok";
      if (!source.ok) {
        stateText = "실패";
        stateClass = "state-bad";
      } else if (!source.inRange) {
        stateText = "기사 없음";
        stateClass = "state-warn";
      }
      const stateCell = el("td", stateClass, stateText);
      const skipped = Object.entries(source.skipped || {})
        .sort((left, right) => right[1] - left[1])
        .slice(0, 2)
        .map(([reason, count]) => `${SKIP_REASON_LABELS[reason] || reason} ${count}`);
      const note = source.ok ? skipped.join(", ") : source.error || "";
      row.append(
        name,
        stateCell,
        el("td", "num", source.fetched ?? 0),
        el("td", "num", source.inRange ?? 0),
        el("td", "num", source.passed ?? 0),
        el("td", "num", source.final ?? 0),
        el("td", "source-note", note)
      );
      return row;
    })
  );
}

// ---------- 인사이트 ----------

function formatEok(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 10_000) return `약 ${(value / 10_000).toFixed(1).replace(/\.0$/u, "")}조 원`;
  return `약 ${Math.round(value).toLocaleString("ko-KR")}억 원`;
}

function renderDeals(window) {
  const deals = window?.deals || [];
  const periodLabel = state.period === "weekly" ? "최근 7일" : "최근 30일";
  const previous = window?.previous?.dealCount;
  const pieces = [`${periodLabel} 투자유치 기사 ${window?.dealCount ?? 0}건`];
  if (Number.isFinite(previous) && window?.previous?.briefingDays) {
    const diff = window.dealCount - previous;
    pieces.push(`직전 기간 ${previous}건${diff ? ` (${diff > 0 ? "+" : ""}${diff})` : ""}`);
  }
  const total = formatEok(window?.disclosedKrwTotalEok);
  if (total) pieces.push(`국내 공개 금액 합계 ${total}(${window.disclosedKrwDealCount}건 기준)`);
  elements.dealSummary.textContent = `${pieces.join(" · ")}.`;

  if (!deals.length) {
    const row = el("tr");
    const cell = el("td", "source-note", "금액이나 라운드가 명시된 투자 기사가 없습니다.");
    cell.colSpan = 3;
    row.append(cell);
    elements.dealRows.replaceChildren(row);
    return;
  }
  const limit = state.period === "weekly" ? 10 : 15;
  elements.dealRows.replaceChildren(
    ...deals.slice(0, limit).map((deal) => {
      const row = el("tr");
      const companyCell = el("td");
      const url = safeUrl(deal.url);
      const name = url ? el("a", null, deal.company) : el("span", null, deal.company);
      if (url) {
        name.href = url;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        name.title = deal.title || "";
      }
      companyCell.append(name);
      if (deal.overseas) companyCell.append(el("span", "is-overseas-tag", "해외"));
      companyCell.append(el("span", "deal-date", `${formatShortDate(deal.date)} · ${deal.source}`));
      row.append(
        companyCell,
        el("td", null, deal.fundingStage || "—"),
        el("td", "num", deal.fundingAmount || "—")
      );
      return row;
    })
  );
}

function showTip(container, target, text) {
  let tip = container.querySelector(".chart-tip");
  if (!tip) {
    tip = el("div", "chart-tip");
    tip.setAttribute("role", "presentation");
    container.append(tip);
  }
  tip.textContent = text;
  const containerBox = container.getBoundingClientRect();
  const targetBox = target.getBoundingClientRect();
  const left = targetBox.left - containerBox.left + targetBox.width / 2;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const width = tip.offsetWidth;
  const clamped = Math.max(0, Math.min(containerBox.width - width, left - width / 2));
  tip.style.left = `${clamped}px`;
  tip.style.top = `${Math.max(0, targetBox.top - containerBox.top - tip.offsetHeight - 6)}px`;
}

function hideTip(container) {
  container.querySelector(".chart-tip")?.remove();
}

function renderDailyChart(daily) {
  const chart = elements.dailyChart;
  const series = Array.isArray(daily) ? daily : [];
  if (!series.length) {
    chart.replaceChildren(el("p", "chart-empty", "표시할 데이터가 없습니다."));
    chart.nextElementSibling?.classList?.contains("column-axis") && chart.nextElementSibling.remove();
    return;
  }
  const max = Math.max(1, ...series.map((day) => day.total));
  const maxIndex = series.findIndex((day) => day.total === max);
  const lastIndex = series.length - 1;
  chart.setAttribute(
    "aria-label",
    `일별 기사 수: ${series.map((day) => `${formatShortDate(day.date)} ${day.total}건`).join(", ")}`
  );
  chart.setAttribute("role", "img");
  chart.replaceChildren(
    ...series.map((day, index) => {
      const column = el("div", `column${index === lastIndex ? "" : " is-dim"}`);
      column.tabIndex = 0;
      const bar = el("div", "column-bar");
      bar.style.height = `${Math.max(2, (day.total / max) * 100)}%`;
      column.append(bar);
      if (index === lastIndex || index === maxIndex) {
        const value = el("span", "column-value", day.total);
        value.style.bottom = `calc(${(day.total / max) * 100}% + 2px)`;
        column.append(value);
      }
      const tipText = `${formatShortDate(day.date)}(${weekdayOf(day.date)}) ${day.total}건 · 해외 ${day.overseas}건`;
      column.addEventListener("mouseenter", () => showTip(chart, column, tipText));
      column.addEventListener("focus", () => showTip(chart, column, tipText));
      column.addEventListener("mouseleave", () => hideTip(chart));
      column.addEventListener("blur", () => hideTip(chart));
      return column;
    })
  );

  let axis = chart.nextElementSibling;
  if (!axis?.classList?.contains("column-axis")) {
    axis = el("div", "column-axis");
    axis.setAttribute("aria-hidden", "true");
    chart.after(axis);
  }
  const step = series.length > 10 ? Math.ceil(series.length / 6) : 1;
  axis.replaceChildren(
    ...series.map((day, index) =>
      el(
        "span",
        null,
        index % step === 0 || index === lastIndex ? formatShortDate(day.date) : ""
      )
    )
  );
}

function renderBarList(container, entries, { limit = 6, empty = "데이터가 없습니다." } = {}) {
  const rows = (entries || []).slice(0, limit);
  if (!rows.length) {
    container.replaceChildren(el("p", "chart-empty", empty));
    return;
  }
  const max = Math.max(1, ...rows.map((entry) => entry.count));
  container.replaceChildren(
    ...rows.map((entry) => {
      const row = el("div", "bar-row");
      row.append(el("span", "bar-label", entry.label));
      const track = el("span", "bar-track");
      const fill = el("span", "bar-fill");
      fill.style.width = `calc(${(entry.count / max) * 100}% - 28px)`;
      track.append(fill, el("span", "bar-value", entry.count));
      row.append(track);
      row.title = `${entry.label} ${entry.count}건`;
      return row;
    })
  );
}

function renderInsights() {
  const window = state.insights?.[state.period];
  for (const button of elements.periodToggle.querySelectorAll("[data-period]")) {
    button.setAttribute("aria-pressed", String(button.dataset.period === state.period));
  }
  if (!window) {
    elements.dealSummary.textContent = "아직 집계된 데이터가 없습니다.";
    elements.dealRows.replaceChildren();
    elements.trendSummary.textContent = "";
    renderDailyChart([]);
    renderBarList(elements.industryBars, []);
    renderBarList(elements.eventBars, []);
    renderBarList(elements.sourceBars, []);
    return;
  }
  renderDeals(window);
  const overseasShare = window.articleCount
    ? Math.round((window.overseasCount / window.articleCount) * 100)
    : 0;
  elements.trendSummary.textContent =
    `${formatShortDate(window.from)}–${formatShortDate(window.to)} 브리핑 ${window.briefingDays}회, ` +
    `중복을 뺀 기사 ${window.articleCount}건 (해외 비중 ${overseasShare}%).`;
  renderDailyChart(window.daily);
  renderBarList(elements.industryBars, window.byIndustry, {
    empty: "제목에서 분야가 확인된 기사가 없습니다.",
  });
  renderBarList(elements.eventBars, window.byEventType);
  renderBarList(elements.sourceBars, window.topSources);
}

// ---------- 아카이브 ----------

function renderArchive() {
  const dates = [...state.archiveIndex.dates].sort((left, right) => right.localeCompare(left));
  elements.archiveStatus.textContent = dates.length
    ? `저장된 브리핑 ${dates.length}일 · ${formatShortDate(dates.at(-1))}부터`
    : "저장된 브리핑이 아직 없습니다.";
  elements.archiveStrip.replaceChildren(
    ...dates.slice(0, 21).map((date) => {
      const button = el("button", "archive-day");
      button.type = "button";
      button.dataset.date = date;
      button.setAttribute("aria-label", `${formatLongDate(date)} 브리핑`);
      if (date === state.currentDate) button.setAttribute("aria-current", "true");
      button.append(el("span", "weekday", weekdayOf(date)), el("span", "day", formatShortDate(date)));
      return button;
    })
  );
  const sorted = [...dates].sort();
  elements.briefingDate.min = sorted[0] || "";
  elements.briefingDate.max = sorted.at(-1) || "";
  if (state.currentDate) elements.briefingDate.value = state.currentDate;
  elements.latestButton.disabled = Boolean(state.isLatest && state.briefing);
}

// ---------- 전체 렌더 ----------

function renderAll() {
  renderMasthead();
  renderFront();
  renderCategoryTabs();
  renderStoryList();
  renderArchive();
}

function normalizeBriefing(data) {
  if (!data || typeof data !== "object") throw new Error("브리핑 데이터 형식이 올바르지 않습니다.");
  const items = Array.isArray(data.items)
    ? data.items.filter((item) => item && typeof item === "object")
    : [];
  return { ...data, items };
}

function briefingDateOf(data) {
  const date = String(data?.generatedAt || "").slice(0, 10);
  return isIsoDate(date) ? date : null;
}

function hasItems(data) {
  return Array.isArray(data?.items) && data.items.length > 0;
}

async function loadLatest() {
  const sequence = ++state.loadSequence;
  try {
    let data = null;
    let isLatest = true;
    try {
      data = await fetchJson("data/news.json");
    } catch (error) {
      console.warn("최신 JSON을 불러오지 못해 아카이브를 확인합니다.", error);
    }
    if (!hasItems(data)) {
      for (const date of [...state.archiveIndex.dates].sort().reverse()) {
        try {
          const archived = await fetchJson(`data/archive/${date}.json`);
          if (!hasItems(archived)) continue;
          data = archived;
          isLatest = false;
          break;
        } catch (error) {
          console.warn(`${date} 아카이브를 불러오지 못했습니다.`, error);
        }
      }
    }
    if (!data) throw new Error("표시할 데이터가 없습니다.");
    if (sequence !== state.loadSequence) return;
    state.briefing = normalizeBriefing(data);
    state.briefingMessage = null;
    state.currentDate = briefingDateOf(data) || state.archiveIndex.latest;
    state.isLatest = isLatest;
  } catch (error) {
    if (sequence !== state.loadSequence) return;
    console.error("뉴스 데이터를 불러오지 못했습니다.", error);
    state.briefing = null;
    state.briefingMessage = "뉴스 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  renderAll();
}

async function loadArchiveDate(date) {
  if (!isIsoDate(date)) return;
  const sequence = ++state.loadSequence;
  try {
    let data;
    let isLatest = false;
    try {
      data = await fetchJson(`data/archive/${date}.json`);
    } catch (error) {
      if (date !== state.archiveIndex.latest) throw error;
      data = await fetchJson("data/news.json");
      isLatest = true;
    }
    if (sequence !== state.loadSequence) return;
    state.briefing = normalizeBriefing(data);
    state.briefingMessage = null;
    state.currentDate = briefingDateOf(data) || date;
    state.isLatest = isLatest || state.currentDate === state.archiveIndex.latest;
  } catch (error) {
    if (sequence !== state.loadSequence) return;
    if (error.status !== 404) console.error("아카이브를 불러오지 못했습니다.", error);
    state.briefing = null;
    state.currentDate = date;
    state.isLatest = false;
    state.briefingMessage = `${formatLongDate(date)} 브리핑은 저장되어 있지 않습니다.`;
  }
  renderAll();
  document.getElementById("front")?.scrollIntoView({ block: "start" });
}

async function loadArchiveIndex() {
  try {
    const data = await fetchJson("data/archive/index.json");
    const dates = Array.isArray(data.dates) ? data.dates.filter(isIsoDate).sort() : [];
    state.archiveIndex = { dates, latest: isIsoDate(data.latest) ? data.latest : dates.at(-1) || null };
  } catch (error) {
    console.warn("아카이브 목록을 불러오지 못했습니다.", error);
    state.archiveIndex = { dates: [], latest: null };
  }
}

async function loadStatus() {
  try {
    state.status = await fetchJson("data/status.json");
  } catch (error) {
    console.warn("수집 상태를 불러오지 못했습니다.", error);
    state.status = null;
  }
  renderRunStatus();
}

async function loadInsights() {
  try {
    state.insights = await fetchJson("data/insights.json");
  } catch (error) {
    console.warn("인사이트 데이터를 불러오지 못했습니다.", error);
    state.insights = null;
  }
  renderInsights();
}

// ---------- 이벤트 ----------

elements.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderCategoryTabs();
  renderStoryList();
});

elements.regionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region]");
  if (!button) return;
  state.region = ["domestic", "overseas"].includes(button.dataset.region)
    ? button.dataset.region
    : "all";
  for (const item of elements.regionFilters.querySelectorAll("[data-region]")) {
    item.setAttribute("aria-pressed", String(item.dataset.region === state.region));
  }
  renderStoryList();
});

elements.newsSearch.addEventListener("input", (event) => {
  state.search = normalizeSearch(event.target.value);
  renderStoryList();
});

elements.newsSort.addEventListener("change", (event) => {
  state.sort = event.target.value === "latest" ? "latest" : "importance";
  renderStoryList();
});

elements.periodToggle.addEventListener("click", (event) => {
  const button = event.target.closest("[data-period]");
  if (!button) return;
  state.period = button.dataset.period === "monthly" ? "monthly" : "weekly";
  renderInsights();
});

elements.archiveStrip.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");
  if (button) loadArchiveDate(button.dataset.date);
});

elements.briefingDate.addEventListener("change", (event) => {
  if (event.target.value) loadArchiveDate(event.target.value);
});

elements.latestButton.addEventListener("click", () => loadLatest());

async function initialize() {
  renderCategoryTabs();
  await Promise.all([loadArchiveIndex(), loadStatus(), loadInsights()]);
  await loadLatest();
}

initialize();
