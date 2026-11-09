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
  deck: $("#deck"),
  deckDots: $("#deck-dots"),
  deckNext: $("#deck-next"),
  deckPosition: $("#deck-position"),
  deckPrev: $("#deck-prev"),
  deckRing: $("#deck-ring"),
  deckStack: $("#deck-stack"),
  dealTicker: $("#deal-ticker"),
  dealRows: $("#deal-rows"),
  dealSummary: $("#deal-summary"),
  eventBars: $("#event-bars"),
  industryBars: $("#industry-bars"),
  issueNote: $("#issue-note"),
  latestButton: $("#latest-button"),
  newsSearch: $("#news-search"),
  newsSort: $("#news-sort"),
  periodToggle: $("#period-toggle"),
  rangeText: $("#range-text"),
  regionFilters: $("#region-filters"),
  runStatus: $("#run-status"),
  sourceBars: $("#source-bars"),
  sourceDetails: $("#source-details"),
  sourceRows: $("#source-rows"),
  statTiles: $("#stat-tiles"),
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

// 투자 단계 표시: 시드 → A → B → C 이상을 네 칸 계단으로 보여준다(사이트 아이콘의 성장 블록과 같은 모양).
// 저장된 라운드 이름만 읽고, 단계가 분명하지 않은 값(후속 투자·브릿지 등)은 계단 없이 글자만 쓴다.
function stageLevel(stage) {
  const text = String(stage || "");
  if (/시리즈\s*[C-H]|series\s*[c-h](?![a-z])|프리\s*-?\s*IPO|pre-?\s*IPO/iu.test(text)) return 4;
  if (/시리즈\s*B|series\s*b(?![a-z])|프리\s*-?\s*B|pre-?\s*B(?![a-z])/iu.test(text)) return 3;
  if (/시리즈\s*A|series\s*a(?![a-z])|프리\s*-?\s*A|pre-?\s*A(?![a-z])/iu.test(text)) return 2;
  if (/시드|seed|엔젤|angel/iu.test(text)) return 1;
  return 0;
}

function stageLabel(stage) {
  const label = el("span", "stage");
  const level = stageLevel(stage);
  if (level) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 12");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "12");
    svg.setAttribute("class", "stage-mark");
    svg.setAttribute("aria-hidden", "true");
    [4, 6, 9, 12].forEach((height, index) => {
      const bar = document.createElementNS(ns, "rect");
      bar.setAttribute("x", String(index * 4));
      bar.setAttribute("y", String(12 - height));
      bar.setAttribute("width", "3");
      bar.setAttribute("height", String(height));
      bar.setAttribute("rx", "0.5");
      if (index < level) bar.setAttribute("class", "on");
      svg.append(bar);
    });
    label.append(svg);
  }
  label.append(stage);
  return label;
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
    if (info.fundingStage) deal.append(stageLabel(info.fundingStage));
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

// ---------- 1면: 숫자 타일 · 3D 회전 카드 · 별자리 배경 · 투자 티커 ----------

const DECK_SIZE = 7;
const RING_STEP_DEG = 36;
const RING_HIDE_DEG = 100;
const DECK_PERSPECTIVE = 1400;

const deck = {
  items: [],
  cards: [],
  pos: 0,
  vel: 0,
  target: 0,
  active: -1,
  flipped: false,
  drag: null,
  suppressClick: false,
  frame: 0,
  lastTime: 0,
  cardWidth: 460,
  radius: 700,
};

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mod(value, size) {
  return ((value % size) + size) % size;
}

function countUp(node, target) {
  const value = Math.max(0, Math.round(Number(target) || 0));
  if (prefersReducedMotion() || value === 0) {
    node.textContent = value;
    return;
  }
  const duration = 900 + Math.min(value, 40) * 12;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = Math.round(value * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  node.textContent = "0";
  requestAnimationFrame(step);
}

// ----- 숫자 타일 -----

function renderStats() {
  const container = elements.statTiles;
  if (state.briefingMessage || !state.briefing) {
    container.replaceChildren();
    return;
  }
  const items = state.briefing.items || [];
  const domestic = items.filter((item) => !isOverseas(item)).length;
  const deals = items.filter((item) => structuredInfo(item).eventType === "투자유치").length;
  const categories = new Set(items.map((item) => item.category).filter(Boolean)).size;
  const tiles = [
    ["오늘 고른 기사", items.length, "건", "is-main"],
    ["국내", domestic, "건"],
    ["해외", items.length - domestic, "건"],
    ["투자유치", deals, "건"],
    ["카테고리", categories, "개"],
  ];
  container.replaceChildren(
    ...tiles.map(([label, value, unit, extra]) => {
      const tile = el("div", `stat-tile${extra ? ` ${extra}` : ""}`);
      const number = el("span", "stat-value", value);
      number.setAttribute("aria-hidden", "true");
      const figure = el("p", "stat-figure");
      figure.append(number, el("span", "stat-unit", unit));
      tile.append(figure, el("p", "stat-label", label));
      tile.append(el("span", "visually-hidden", `${label} ${value}${unit}`));
      countUp(number, value);
      return tile;
    })
  );
}

// ----- 카드 -----

function renderCardFace(article, position, total) {
  const info = structuredInfo(article);
  const url = safeUrl(article.url);

  const front = el("div", "card-face card-front");
  const top = el("p", "card-top");
  top.append(el("span", "card-category", CATEGORY_LABELS[article.category] || article.category || "기타"));
  const kicker = el("p", "kicker card-kicker");
  kicker.append(
    el("span", null, article.source || "출처 미상"),
    el("span", null, isOverseas(article) ? "해외" : "국내")
  );
  if (isIsoDate(article.publishedAt)) {
    const time = el("time", null, formatShortDate(article.publishedAt));
    time.dateTime = article.publishedAt;
    kicker.append(time);
  }
  const title = el("h3", "card-title");
  if (url) {
    const link = el("a", null, article.title || "제목 없음");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.draggable = false;
    title.append(link);
  } else {
    title.textContent = article.title || "제목 없음";
  }
  front.append(top, kicker, title);

  const facts = [
    ["기업", info.company],
    ["라운드", info.fundingStage],
    ["금액", info.fundingAmount],
    ["유형", info.fundingAmount || info.fundingStage ? null : info.eventType],
  ].filter(([, value]) => value);
  if (facts.length) {
    const list = el("dl", "card-facts");
    list.setAttribute("aria-label", "기사에 명시된 정보");
    for (const [label, value] of facts) {
      const row = el("div", label === "금액" ? "is-amount" : null);
      const valueCell = el("dd");
      valueCell.append(label === "라운드" ? stageLabel(value) : value);
      row.append(el("dt", null, label), valueCell);
      list.append(row);
    }
    front.append(list);
  }
  const flip = el("button", "card-flip", "요약 보기");
  flip.type = "button";
  flip.dataset.flip = "true";
  front.append(flip);
  front.append(el("span", "card-fog"));

  const back = el("div", "card-face card-back");
  const backTop = el("p", "card-top");
  backTop.append(el("span", "card-category", "요약"), el("span", "card-count", `${position} / ${total}`));
  const summary = el(
    "p",
    `card-summary${article.summary ? "" : " is-unavailable"}`,
    article.summary || "본문에서 안전하게 요약할 문장을 찾지 못했습니다. 원문을 확인하세요."
  );
  back.append(backTop, el("p", "card-back-title", article.title || "제목 없음"), summary);
  const actions = el("div", "card-actions");
  if (url) {
    const source = el("a", "source-link", `${article.source || "원문"}에서 읽기`);
    source.href = url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.draggable = false;
    source.setAttribute("aria-label", `${article.title || "기사"} 원문 보기 (새 탭)`);
    actions.append(source);
  }
  const flipBack = el("button", "card-flip", "앞면으로");
  flipBack.type = "button";
  flipBack.dataset.flip = "true";
  actions.append(flipBack);
  back.append(actions);
  return { front, back };
}

function renderDeck() {
  const ring = elements.deckRing;
  deck.pos = 0;
  deck.vel = 0;
  deck.target = 0;
  deck.active = -1;
  deck.flipped = false;
  deck.items = state.briefingMessage ? [] : selectFeatured(state.briefing?.items || [], DECK_SIZE);
  if (!deck.items.length) {
    deck.cards = [];
    ring.replaceChildren(
      el("p", "empty-note", state.briefingMessage || "이 날짜에는 선별된 기사가 없습니다.")
    );
    elements.deckDots.replaceChildren();
    elements.deck.classList.add("is-empty");
    elements.deckPosition.textContent = "";
    return;
  }
  elements.deck.classList.remove("is-empty");
  const total = deck.items.length;
  deck.cards = deck.items.map((article, index) => {
    const card = el("article", "deck-card");
    card.dataset.index = String(index);
    card.dataset.category = String(CATEGORY_ORDER.indexOf(article.category) + 1 || 0);
    card.setAttribute("aria-roledescription", "카드");
    card.setAttribute("aria-label", `${index + 1} / ${total}: ${article.title || "제목 없음"}`);
    const tilt = el("div", "card-tilt");
    const inner = el("div", "card-inner");
    const { front, back } = renderCardFace(article, index + 1, total);
    inner.append(front, back);
    tilt.append(el("div", "card-shade"), inner);
    card.append(tilt);
    return card;
  });
  ring.replaceChildren(...deck.cards);
  elements.deckDots.replaceChildren(
    ...deck.items.map((article, index) => {
      const dot = el("button", "deck-dot");
      dot.type = "button";
      dot.dataset.goto = String(index);
      dot.setAttribute("aria-label", `${index + 1}번째 카드: ${article.title || "제목 없음"}`);
      return dot;
    })
  );
  layoutDeck();
  paintDeck();
}

function ringWraps() {
  return deck.items.length >= 3;
}

function layoutDeck() {
  const width = elements.deckStack.clientWidth || window.innerWidth;
  const narrow = width < 640;
  deck.cardWidth = Math.round(narrow ? clamp(width - 72, 240, 420) : clamp(width * 0.4, 360, 520));
  const gap = narrow ? 16 : 30;
  deck.radius = Math.round((deck.cardWidth / 2 + gap) / Math.tan(((RING_STEP_DEG / 2) * Math.PI) / 180));
  elements.deckStack.style.setProperty("--card-w", `${deck.cardWidth}px`);
}

function relativeOffset(index) {
  const offset = index - deck.pos;
  if (!ringWraps()) return offset;
  const size = deck.items.length;
  return mod(offset + size / 2, size) - size / 2;
}

function setFaceInert(face, value) {
  if (!face) return;
  face.inert = value;
  if (value) face.setAttribute("aria-hidden", "true");
  else face.removeAttribute("aria-hidden");
}

function paintDeck() {
  const size = deck.items.length;
  if (!size) return;
  // 카드마다 원근(perspective)을 따로 주어 각자 독립된 3D 공간에 그린다.
  // 카드들이 한 3D 공간을 공유하면 Chrome이 기울어진 정면 카드 일부를 그리지 않는 문제가 있다.
  // 앞뒤 순서는 z-index로 직접 정한다.
  deck.cards.forEach((card, index) => {
    const offset = relativeOffset(index);
    const angle = offset * RING_STEP_DEG;
    const distance = Math.abs(angle);
    card.style.transform =
      `perspective(${DECK_PERSPECTIVE}px) translateZ(${-deck.radius}px) ` +
      `rotateY(${angle.toFixed(3)}deg) translateZ(${deck.radius}px)`;
    card.style.zIndex = String(1000 + Math.round(Math.cos((angle * Math.PI) / 180) * 500));
    if (distance >= RING_HIDE_DEG) {
      card.style.visibility = "hidden";
    } else {
      card.style.visibility = "";
    }
    // 옆 카드는 카드 안의 안개 레이어(.card-fog)로 흐리게 한다.
    // 카드 자체에 opacity·filter를 쓰면 반투명해지거나 브라우저의 3D 정렬이 깨진다.
    const fade = distance < 1 ? 0 : clamp(distance / RING_HIDE_DEG, 0, 1);
    card.style.setProperty("--fade", fade.toFixed(3));

  });
  const nearest = mod(Math.round(deck.pos), size);
  if (nearest !== deck.active) setActiveCard(nearest);
}

function setActiveCard(index) {
  deck.active = index;
  deck.flipped = false;
  deck.cards.forEach((card, cardIndex) => {
    const active = cardIndex === index;
    card.classList.toggle("is-active", active);
    card.classList.remove("is-flipped");
    if (active) card.removeAttribute("aria-hidden");
    else card.setAttribute("aria-hidden", "true");
    setFaceInert(card.querySelector(".card-front"), !active);
    setFaceInert(card.querySelector(".card-back"), true);
  });
  const total = deck.items.length;
  elements.deckPosition.textContent = `${index + 1} / ${total}`;
  for (const dot of elements.deckDots.querySelectorAll("[data-goto]")) {
    dot.setAttribute("aria-current", Number(dot.dataset.goto) === index ? "true" : "false");
  }
  const atStart = !ringWraps() && index === 0;
  const atEnd = !ringWraps() && index === total - 1;
  elements.deckPrev.disabled = atStart || total < 2;
  elements.deckNext.disabled = atEnd || total < 2;
}

function startDeckAnimation() {
  if (deck.frame) return;
  deck.lastTime = performance.now();
  deck.frame = requestAnimationFrame(stepDeck);
}

// 스프링 물리: 목표 위치로 끌려가며 살짝 출렁이다 멈춘다.
function stepDeck(now) {
  deck.frame = 0;
  const steps = clamp((now - deck.lastTime) / 16.667, 0.5, 3);
  deck.lastTime = now;
  if (!deck.drag?.moving) {
    // 튕기지 않고 목표 카드에 부드럽게 다가가 멈춘다(ease-out).
    deck.pos += (deck.target - deck.pos) * (1 - Math.pow(1 - 0.16, steps));
    if (Math.abs(deck.target - deck.pos) < 0.001) {
      deck.pos = deck.target;
      deck.vel = 0;
      paintDeck();
      return;
    }
  }
  paintDeck();
  deck.frame = requestAnimationFrame(stepDeck);
}

function moveDeckBy(delta) {
  const size = deck.items.length;
  if (size < 2) return;
  let target = Math.round(deck.target) + delta;
  if (!ringWraps()) target = clamp(target, 0, size - 1);
  setDeckTarget(target);
}

function moveDeckTo(index) {
  const size = deck.items.length;
  if (!size) return;
  const current = mod(Math.round(deck.target), size);
  let delta = index - current;
  if (ringWraps()) delta = mod(delta + size / 2, size) - size / 2;
  setDeckTarget(Math.round(deck.target) + Math.round(delta));
}

function setDeckTarget(target) {
  deck.target = target;
  if (prefersReducedMotion()) {
    deck.pos = target;
    deck.vel = 0;
    paintDeck();
    return;
  }
  startDeckAnimation();
}

function activeCard() {
  return deck.cards[deck.active] || null;
}

function toggleFlip() {
  const card = activeCard();
  if (!card || Math.abs(deck.pos - deck.target) > 0.05) return;
  deck.flipped = !deck.flipped;
  card.classList.toggle("is-flipped", deck.flipped);
  card.classList.add("is-lifting");
  setTimeout(() => card.classList.remove("is-lifting"), 360);
  setFaceInert(card.querySelector(".card-front"), deck.flipped);
  setFaceInert(card.querySelector(".card-back"), !deck.flipped);
  const target = deck.flipped
    ? card.querySelector(".card-back .card-flip")
    : card.querySelector(".card-front .card-flip");
  target?.focus({ preventScroll: true });
}

elements.deckStack.addEventListener("pointerdown", (event) => {
  if (!deck.items.length || event.button !== 0) return;
  if (event.target.closest("button")) return;
  deck.drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startPos: deck.pos,
    lastX: event.clientX,
    lastTime: performance.now(),
    speed: 0,
    moving: false,
  };
});

elements.deckStack.addEventListener("pointermove", (event) => {
  const drag = deck.drag;
  if (drag && drag.id === event.pointerId) {
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moving && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      drag.moving = true;
      elements.deckStack.classList.add("is-dragging");
      elements.deckStack.setPointerCapture?.(event.pointerId);
      if (deck.flipped) toggleFlipSilently();
    }
    if (drag.moving) {
      const now = performance.now();
      const spacing = deck.cardWidth * 0.85;
      const elapsed = Math.max(1, now - drag.lastTime);
      drag.speed = drag.speed * 0.6 + (-(event.clientX - drag.lastX) / spacing / elapsed) * 0.4;
      drag.lastX = event.clientX;
      drag.lastTime = now;
      let next = drag.startPos - dx / spacing;
      if (!ringWraps()) {
        const max = deck.items.length - 1;
        if (next < 0) next *= 0.3;
        if (next > max) next = max + (next - max) * 0.3;
      }
      deck.pos = next;
      deck.vel = 0;
      paintDeck();
    }
    return;
  }
});

function toggleFlipSilently() {
  const card = activeCard();
  deck.flipped = false;
  card?.classList.remove("is-flipped");
  setFaceInert(card?.querySelector(".card-front"), false);
  setFaceInert(card?.querySelector(".card-back"), true);
}

function endDrag(event) {
  const drag = deck.drag;
  if (!drag || drag.id !== event.pointerId) return;
  deck.drag = null;
  elements.deckStack.classList.remove("is-dragging");
  if (!drag.moving) return;
  deck.suppressClick = true;
  setTimeout(() => {
    deck.suppressClick = false;
  }, 0);
  // 놓는 순간의 속도만큼 더 돌아간 뒤 가장 가까운 카드에 멈춘다.
  const projected = deck.pos + clamp(drag.speed * 180, -2.5, 2.5);
  let target = Math.round(projected);
  if (!ringWraps()) target = clamp(target, 0, deck.items.length - 1);
  setDeckTarget(target);
}

elements.deckStack.addEventListener("pointerup", endDrag);
elements.deckStack.addEventListener("pointercancel", endDrag);
// 트랙패드 두 손가락 가로 스와이프(가로 휠)와 Shift+휠로도 카드를 돌린다.
// 손가락을 따라 연속으로 돌다가, 입력이 멈추면 가장 가까운 카드에 스프링으로 멈춘다.
let wheelSettleTimer = 0;
elements.deckStack.addEventListener(
  "wheel",
  (event) => {
    if (!deck.items.length || deck.drag?.moving) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2;
    const shiftWheel = event.shiftKey && !event.deltaX && event.deltaY;
    if (!horizontal && !shiftWheel) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? deck.cardWidth : 1;
    const delta = (horizontal ? event.deltaX : event.deltaY) * unit;
    if (deck.frame) {
      cancelAnimationFrame(deck.frame);
      deck.frame = 0;
    }
    deck.vel = 0;
    if (deck.flipped) toggleFlipSilently();
    deck.pos += delta / (deck.cardWidth * 0.85);
    if (!ringWraps()) deck.pos = clamp(deck.pos, -0.3, deck.items.length - 0.7);
    deck.target = deck.pos;
    paintDeck();
    clearTimeout(wheelSettleTimer);
    wheelSettleTimer = setTimeout(() => {
      let target = Math.round(deck.pos);
      if (!ringWraps()) target = clamp(target, 0, deck.items.length - 1);
      setDeckTarget(target);
    }, 140);
  },
  { passive: false }
);

elements.deckStack.addEventListener("click", (event) => {
  if (deck.suppressClick) {
    event.preventDefault();
    return;
  }
  const card = event.target.closest(".deck-card");
  if (!card) return;
  const index = Number(card.dataset.index);
  if (index !== deck.active) {
    event.preventDefault();
    moveDeckTo(index);
    return;
  }
  if (event.target.closest("[data-flip]")) {
    toggleFlip();
    return;
  }
  if (event.target.closest("a, button")) return;
  // 카드 안의 글자를 드래그해 고르는 중일 때만 뒤집지 않는다(다른 곳의 선택은 무시).
  const selection = window.getSelection?.();
  if (selection?.toString() && card.contains(selection.anchorNode)) return;
  toggleFlip();
});

elements.deck.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea")) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    moveDeckBy(event.key === "ArrowRight" ? 1 : -1);
    requestAnimationFrame(() =>
      activeCard()?.querySelector(".card-title a, .card-flip")?.focus({ preventScroll: true })
    );
  }
});

elements.deckPrev.addEventListener("click", () => moveDeckBy(-1));
elements.deckNext.addEventListener("click", () => moveDeckBy(1));
elements.deckDots.addEventListener("click", (event) => {
  const dot = event.target.closest("[data-goto]");
  if (dot) moveDeckTo(Number(dot.dataset.goto));
});

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    layoutDeck();
    paintDeck();
  });
});

// ----- 투자 티커 -----

function renderTicker() {
  const ticker = elements.dealTicker;
  const items = state.briefingMessage ? [] : state.briefing?.items || [];
  const deals = sortArticles(items, "importance").filter((item) => {
    const info = structuredInfo(item);
    return info.company && (info.fundingAmount || info.fundingStage);
  });
  if (deals.length < 2) {
    ticker.hidden = true;
    ticker.replaceChildren();
    return;
  }
  ticker.hidden = false;
  // 흐르는 애니메이션 없이 한 줄로 두고, 넘치면 옆으로 넘겨 본다.
  const list = el("ul", "ticker-track");
  for (const article of deals) {
    const info = structuredInfo(article);
    const item = el("li", "ticker-item");
    item.dataset.category = String(CATEGORY_ORDER.indexOf(article.category) + 1 || 0);
    const url = safeUrl(article.url);
    const label = el(url ? "a" : "span", "ticker-link");
    if (url) {
      label.href = url;
      label.target = "_blank";
      label.rel = "noopener noreferrer";
      label.title = article.title || "";
    }
    label.append(el("strong", null, info.company));
    if (info.fundingStage) label.append(stageLabel(info.fundingStage));
    if (info.fundingAmount) label.append(el("span", "ticker-amount", info.fundingAmount));
    item.append(label);
    list.append(item);
  }
  const viewport = el("div", "ticker-viewport");
  viewport.append(list);
  ticker.replaceChildren(el("p", "ticker-label", "오늘의 투자"), viewport);
  ticker.setAttribute("aria-label", `오늘 기사에 명시된 투자 ${deals.length}건`);
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
      const buffered = source.buffered ? [`미리 담은 기사 ${source.buffered}`] : [];
      const note = source.ok
        ? [...buffered, ...skipped].join(", ")
        : [...buffered, source.error || ""].filter(Boolean).join(", ");
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
        (() => {
          const cell = el("td");
          cell.append(deal.fundingStage ? stageLabel(deal.fundingStage) : "—");
          return cell;
        })(),
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
  renderStats();
  renderDeck();
  renderTicker();
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
