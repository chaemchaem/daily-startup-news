const { cleanText } = require("./utils");

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MIN_TEXT_LENGTH = 300;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_SUMMARY_INPUT_CHARS = 12_000;
const ROBOTS_USER_AGENT = "DailyStartupVCBriefing";
const robotsRulesCache = new Map();

const BOILERPLATE_PATTERNS = [
  /무단\s*(?:전재|복제|배포)/iu,
  /저작권(?:자)?\s*[©ⓒ]?/iu,
  /copyright\s*[©(]?/iu,
  /관련\s*기사/iu,
  /추천\s*기사/iu,
  /인기\s*기사/iu,
  /많이\s*본\s*기사/iu,
  /기사\s*제보/iu,
  /기사\s*원문\s*보기|원문\s*보기|제보하기/iu,
  /댓글\s*(?:쓰기|보기|정책)?/iu,
  /SNS\s*(?:공유|기사보내기)/iu,
  /(?:페이스북|트위터|카카오톡|네이버)\s*(?:공유|보내기)/iu,
  /구독(?:하기|신청)/iu,
  /뉴스레터\s*(?:구독|신청)/iu,
  /로그인\s*(?:안내|후)|회원가입/iu,
  /광고\s*(?:문의|안내)|사이트\s*메뉴/iu,
  /기자의\s*다른\s*기사/iu,
  /(?:입력|수정|승인)\s*[:=]?\s*20\d{2}[.\-/년]/iu,
  /조회(?:수)?\s*[:=]?\s*[\d,]+/iu,
  /(?:사진|자료)\s*=/iu,
  /재배포\s*금지/iu,
];

const PAYWALL_PATTERNS = [
  /구독자만\s*(?:볼|읽을)\s*수/iu,
  /유료\s*회원(?:만|에게)/iu,
  /로그인\s*후\s*(?:기사|전체)/iu,
  /기사\s*전문을\s*보려면/iu,
  /계속\s*읽으시려면\s*구독/iu,
];

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isSafeArticleUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./u.test(host) ||
      /^10\./u.test(host) ||
      /^192\.168\./u.test(host) ||
      /^169\.254\./u.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function removeNoiseHtml(html) {
  return String(html)
    .replace(/<(script|style|noscript|iframe|form|nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--?[\s\S]*?-->/gu, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectorDescriptor(selector) {
  const token = String(selector || "").trim().split(/\s+/u).at(-1) || "";
  const match = token.match(/^(?:([a-z][\w-]*))?(?:#([\w-]+)|\.([\w-]+))?$/iu);
  if (!match) return null;
  return { tag: match[1] || "[a-z][\\w-]*", id: match[2] || "", className: match[3] || "" };
}

function elementPatternForSelector(selector) {
  const descriptor = selectorDescriptor(selector);
  if (!descriptor) return null;
  const attributeCheck = descriptor.id
    ? `(?=[^>]*\\bid=["']${escapeRegExp(descriptor.id)}["'])`
    : descriptor.className
      ? `(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegExp(descriptor.className)}\\b[^"']*["'])`
      : "";
  return new RegExp(
    `<(${descriptor.tag})\\b${attributeCheck}[^>]*>[\\s\\S]*?<\\/\\1>`,
    "giu"
  );
}

function removeConfiguredSelectors(html, selectors = []) {
  let output = String(html || "");
  for (const selector of selectors) {
    const pattern = elementPatternForSelector(selector);
    if (pattern) output = output.replace(pattern, " ");
  }
  return output;
}

function extractConfiguredBodyHtml(html, selectorList = "") {
  const matches = [];
  for (const selector of String(selectorList).split(",")) {
    const pattern = elementPatternForSelector(selector.trim());
    if (!pattern) continue;
    matches.push(...(String(html).match(pattern) || []));
  }
  return matches.join("\n");
}

function isBoilerplate(text) {
  if (!text) return true;
  if (/^[가-힣A-Za-z·]{2,20}\s*(?:기자|특파원)\s*=?$/u.test(text)) return true;
  if (/^20\d{2}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*\d{1,2}:\d{2})?$/u.test(text)) return true;
  if (/^[▶◆■●※]/u.test(text) && Array.from(text).length < 100) return true;
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text));
}

function stripArticleMetadata(text) {
  return cleanText(text)
    .replace(/^\s*\[(?:[^\]]{1,40})\]\s*/u, "")
    .replace(/^\s*\([^)]{0,40}=(?:연합뉴스|뉴스1|뉴시스|[^)]*기자)\)\s*/u, "")
    .replace(/^\s*(?:입력|수정|승인)\s*[:=]?\s*20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}(?:일)?(?:\s*\d{1,2}:\d{2})?\s*/u, "")
    .replace(/\s+[A-Za-z0-9가-힣·._-]{2,30}\s*(?:기자|특파원)\s*$/u, "")
    .replace(/\s*(?:사진|자료)\s*=\s*[^.!?。]{1,80}(?=$|[.!?。])/giu, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleBlocksFromHtml(content) {
  return removeNoiseHtml(content)
    .replace(/<\/(?:p|h[1-6]|li|blockquote|div|section|article)>/giu, "\n")
    .split(/\n+/u)
    .map((block) => stripArticleMetadata(block))
    .filter((text) => Array.from(text).length >= 15 && !isBoilerplate(text));
}

function cleanArticleText(content, fallbackText = "") {
  const blocks = articleBlocksFromHtml(content);
  if (!blocks.length && fallbackText) {
    blocks.push(
      ...String(fallbackText)
        .split(/\n+/u)
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter((text) => Array.from(text).length >= 15 && !isBoilerplate(text))
    );
  }

  const uniqueBlocks = [];
  const seen = new Set();
  for (const block of blocks) {
    const withoutEmail = stripArticleMetadata(block);
    if (!withoutEmail || isBoilerplate(withoutEmail)) continue;

    const fingerprint = withoutEmail.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    uniqueBlocks.push(withoutEmail);
  }

  return uniqueBlocks.join(" ").replace(/\s+/g, " ").trim();
}

function trimSummaryInput(text, maxLength = MAX_SUMMARY_INPUT_CHARS) {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;

  const clipped = chars.slice(0, maxLength).join("");
  const lastBoundary = Math.max(
    clipped.lastIndexOf("다."),
    clipped.lastIndexOf("요."),
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!")
  );
  return lastBoundary >= maxLength * 0.65
    ? clipped.slice(0, lastBoundary + 1).trim()
    : clipped.trim();
}

function hasPaywallSignal(text) {
  return PAYWALL_PATTERNS.some((pattern) => pattern.test(text));
}

function extractBasicArticleHtml(html) {
  const cleaned = removeNoiseHtml(html);
  return (
    cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1] ||
    cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] ||
    cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ||
    cleaned
  );
}

function isGoogleNewsUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "news.google.com" || host === "google.com" || host.endsWith(".google.com");
  } catch {
    return false;
  }
}

function decodeAttribute(value = "") {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .trim();
}

function readTagAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "iu");
  const match = tag.match(pattern);
  return decodeAttribute(match?.[1] || match?.[2] || "");
}

function unwrapGoogleRedirect(value) {
  try {
    const url = new URL(value);
    if (!isGoogleNewsUrl(url.href)) return url.href;
    const nested = url.searchParams.get("url") || url.searchParams.get("q");
    return nested && isSafeArticleUrl(nested) ? nested : url.href;
  } catch {
    return value;
  }
}

function normalizeCandidateUrl(value, baseUrl) {
  try {
    const url = unwrapGoogleRedirect(new URL(decodeAttribute(value), baseUrl).href);
    return isSafeArticleUrl(url) && !isGoogleNewsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function extractOriginalUrlFromHtml(html, baseUrl) {
  const candidates = [];
  const tags = String(html).match(/<(?:link|meta|a)\b[^>]*>/giu) || [];

  for (const tag of tags) {
    const name = tag.match(/^<\s*([a-z]+)/iu)?.[1]?.toLowerCase();
    if (name === "link" && /\bcanonical\b/iu.test(readTagAttribute(tag, "rel"))) {
      candidates.push({ priority: 100, url: readTagAttribute(tag, "href") });
    } else if (
      name === "meta" &&
      /^og:url$/iu.test(readTagAttribute(tag, "property") || readTagAttribute(tag, "name"))
    ) {
      candidates.push({ priority: 90, url: readTagAttribute(tag, "content") });
    } else if (
      name === "meta" &&
      /^refresh$/iu.test(readTagAttribute(tag, "http-equiv"))
    ) {
      const refreshUrl = readTagAttribute(tag, "content").match(/url\s*=\s*(.+)$/iu)?.[1];
      if (refreshUrl) candidates.push({ priority: 80, url: refreshUrl });
    } else if (name === "a") {
      const href = readTagAttribute(tag, "href");
      if (href) candidates.push({ priority: 20, url: href });
    }
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      url: normalizeCandidateUrl(candidate.url, baseUrl),
    }))
    .filter((candidate) => candidate.url)
    .sort((left, right) => right.priority - left.priority)[0]?.url || null;
}

function normalizeSearchTitle(value = "") {
  return cleanText(value)
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:nbsp|quot|amp|lt|gt);/giu, " ")
    .replace(/[^0-9a-z가-힣]+/giu, "")
    .toLocaleLowerCase("ko-KR");
}

function searchTitleSimilarity(left, right) {
  const a = normalizeSearchTitle(left);
  const b = normalizeSearchTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const bigrams = (value) => {
    const result = new Set();
    for (let index = 0; index < value.length - 1; index += 1) {
      result.add(value.slice(index, index + 2));
    }
    return result;
  };
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  if (!leftPairs.size || !rightPairs.size) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function matchesConfiguredArticleUrl(url, patterns = []) {
  if (!patterns.length) return true;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "iu").test(url);
    } catch {
      return false;
    }
  });
}

async function resolveByPublisherTitleSearch(options = {}) {
  const title = cleanText(options.title || "");
  const publisherBaseUrl = options.publisherBaseUrl;
  if (!title || !publisherBaseUrl || !isSafeArticleUrl(publisherBaseUrl)) {
    return { ok: false, reason: "publisher_search_base_unavailable", detail: "" };
  }

  let searchUrl;
  try {
    searchUrl = options.publisherSearchUrl
      ? new URL(options.publisherSearchUrl).href
      : new URL(`?s=${encodeURIComponent(title)}`, publisherBaseUrl).href;
  } catch {
    return { ok: false, reason: "publisher_search_url_invalid", detail: publisherBaseUrl };
  }
  if (!(await isUrlAllowedByRobots(searchUrl, { timeoutMs: options.timeoutMs }))) {
    return { ok: false, reason: "publisher_search_robots_disallowed", detail: searchUrl };
  }

  const page = await requestHtml(searchUrl, options.timeoutMs, "publisher_search_");
  if (!page.ok) return page;
  const baseHost = new URL(publisherBaseUrl).hostname.replace(/^www\./u, "");
  const candidates = [];
  for (const match of page.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const candidateUrl = normalizeCandidateUrl(match[1], page.finalUrl);
    if (!candidateUrl) continue;
    const candidateHost = new URL(candidateUrl).hostname.replace(/^www\./u, "");
    if (candidateHost !== baseHost && !candidateHost.endsWith(`.${baseHost}`)) continue;
    if (!matchesConfiguredArticleUrl(candidateUrl, options.allowedUrlPatterns || [])) continue;
    const anchorTitle = cleanText(match[2].replace(/<[^>]+>/gu, " "));
    const similarity = searchTitleSimilarity(title, anchorTitle);
    if (similarity >= 0.48) candidates.push({ candidateUrl, similarity, anchorTitle });
  }
  candidates.sort((left, right) => right.similarity - left.similarity);
  if (!candidates.length) {
    return { ok: false, reason: "publisher_title_search_no_match", detail: searchUrl };
  }
  return {
    ok: true,
    resolvedUrl: candidates[0].candidateUrl,
    detail: `publisher_title_search:${candidates[0].similarity.toFixed(3)}`,
  };
}

function extractGoogleArticleId(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    const articlesIndex = parts.lastIndexOf("articles");
    return articlesIndex >= 0 ? parts[articlesIndex + 1] || null : null;
  } catch {
    return null;
  }
}

function decodeLegacyGoogleNewsUrl(value) {
  const id = extractGoogleArticleId(value);
  if (!id) return null;

  try {
    const padded = id
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(id.length / 4) * 4, "=");
    let decoded = Buffer.from(padded, "base64").toString("latin1");
    const prefix = Buffer.from([0x08, 0x13, 0x22]).toString("latin1");
    const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString("latin1");
    if (decoded.startsWith(prefix)) decoded = decoded.slice(prefix.length);
    if (decoded.endsWith(suffix)) decoded = decoded.slice(0, -suffix.length);

    const bytes = Buffer.from(decoded, "latin1");
    if (!bytes.length) return null;
    const length = bytes[0];
    decoded = length >= 0x80 ? decoded.slice(2, length + 2) : decoded.slice(1, length + 1);
    return isSafeArticleUrl(decoded) && !isGoogleNewsUrl(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function requestFailureReason(error, prefix = "") {
  if (error?.name === "AbortError") return `${prefix}timeout`;
  const code = error?.cause?.code || error?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `${prefix}dns_error`;
  return `${prefix}network_error`;
}

async function resolveGoogleNewsBatch(value, timeoutMs) {
  const id = extractGoogleArticleId(value);
  if (!id) return { ok: false, reason: "google_article_id_missing", detail: "" };

  const innerRequest = [
    "garturlreq",
    [
      ["ko", "KR", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "KR:ko", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
      "ko",
      "KR",
      1,
      [2, 3, 4, 8],
      1,
      0,
      "655000234",
      0,
      0,
      null,
      0,
    ],
    id,
  ];
  const request = JSON.stringify([
    [["Fbv4je", JSON.stringify(innerRequest), null, "generic"]],
  ]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
      {
        method: "POST",
        redirect: "follow",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Referer: "https://news.google.com/",
          "User-Agent": "DailyStartupVCBriefing/1.0 (Google News URL resolver)",
        },
        body: `f.req=${encodeURIComponent(request)}`,
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        reason: `google_batch_http_${response.status}`,
        detail: response.statusText,
      };
    }

    const body = await response.text();
    const marker = '[\\"garturlres\\",\\"';
    const markerIndex = body.indexOf(marker);
    if (markerIndex < 0) {
      return {
        ok: false,
        reason: "google_news_redirect_unresolved",
        detail: "batch response missing URL",
      };
    }
    const escaped = body.slice(markerIndex + marker.length).split('\\",')[0];
    let resolvedUrl;
    try {
      resolvedUrl = JSON.parse(`"${escaped}"`);
    } catch {
      resolvedUrl = escaped
        .replace(/\\u003d/giu, "=")
        .replace(/\\u0026/giu, "&")
        .replace(/\\\//gu, "/");
    }
    if (!isSafeArticleUrl(resolvedUrl) || isGoogleNewsUrl(resolvedUrl)) {
      return {
        ok: false,
        reason: "google_news_redirect_unresolved",
        detail: "batch returned invalid URL",
      };
    }
    return { ok: true, resolvedUrl };
  } catch (error) {
    return {
      ok: false,
      reason: requestFailureReason(error, "google_batch_"),
      detail: error?.cause?.code || error?.message || "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestHtml(url, timeoutMs, reasonPrefix = "") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
        "User-Agent": "DailyStartupVCBriefing/1.0 (RSS article summarizer)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: `${reasonPrefix}http_${response.status}`, detail: response.statusText };
    }
    const finalUrl = response.url || url;
    if (!isSafeArticleUrl(finalUrl)) {
      return { ok: false, reason: `${reasonPrefix}unsafe_redirect`, detail: finalUrl };
    }
    const contentType = response.headers.get("content-type") || "";
    if (
      !/(?:text\/html|application\/xhtml\+xml|application\/xml|text\/xml)/iu.test(
        contentType
      )
    ) {
      return { ok: false, reason: `${reasonPrefix}unsupported_content_type`, detail: contentType };
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
    if (declaredLength > MAX_HTML_BYTES) {
      return { ok: false, reason: `${reasonPrefix}html_too_large`, detail: `${declaredLength}` };
    }

    const html = await response.text();
    if (!html) return { ok: false, reason: `${reasonPrefix}empty_html`, detail: "" };
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      return { ok: false, reason: `${reasonPrefix}html_too_large`, detail: "actual body" };
    }

    return { ok: true, finalUrl, html };
  } catch (error) {
    return {
      ok: false,
      reason: requestFailureReason(error, reasonPrefix),
      detail: error?.cause?.code || error?.message || "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRobotsRules(text, userAgent = ROBOTS_USER_AGENT) {
  const groups = [];
  let agents = [];
  let rules = [];

  function flush() {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  }

  for (const rawLine of String(text || "").split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      if (value) rules.push({ type: field, path: value });
    }
  }
  flush();

  const normalizedAgent = userAgent.toLowerCase();
  const matched = groups.filter(({ agents: groupAgents }) =>
    groupAgents.some((agent) => agent === "*" || normalizedAgent.includes(agent))
  );
  return matched.flatMap((group) => group.rules);
}

async function loadRobotsRules(url, timeoutMs) {
  const origin = new URL(url).origin;
  if (robotsRulesCache.has(origin)) return robotsRulesCache.get(origin);

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5_000));
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: { "User-Agent": `${ROBOTS_USER_AGENT}/1.0` },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return parseRobotsRules(await response.text());
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  })();
  robotsRulesCache.set(origin, promise);
  return promise;
}

async function isUrlAllowedByRobots(url, options = {}) {
  if (!isSafeArticleUrl(url)) return false;
  const timeoutMs = readPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const rules = await loadRobotsRules(url, timeoutMs);
  const target = new URL(url);
  const path = `${target.pathname}${target.search}`;
  const matches = rules
    .filter((rule) => path.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length);
  return !matches.length || matches[0].type === "allow";
}

async function resolveOriginalArticleUrl(url, options = {}) {
  if (!isSafeArticleUrl(url)) {
    return { resolvedUrl: null, resolutionStatus: "failed", reason: "unsafe_url", detail: url };
  }
  if (!isGoogleNewsUrl(url)) {
    return { resolvedUrl: url, resolutionStatus: "not_required", reason: null, detail: null };
  }

  const timeoutMs = readPositiveInteger(
    options.timeoutMs ?? process.env.ARTICLE_FETCH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const legacyUrl = decodeLegacyGoogleNewsUrl(url);
  if (legacyUrl) {
    return {
      resolvedUrl: legacyUrl,
      resolutionStatus: "resolved",
      reason: null,
      detail: "legacy_base64",
    };
  }

  const page = await requestHtml(url, timeoutMs, "resolve_");
  if (page.ok && !isGoogleNewsUrl(page.finalUrl)) {
    return {
      resolvedUrl: page.finalUrl,
      resolutionStatus: "resolved",
      prefetchedHtml: page.html,
      reason: null,
      detail: "redirect",
    };
  }

  if (page.ok) {
    const originalUrl = extractOriginalUrlFromHtml(page.html, page.finalUrl);
    if (originalUrl) {
      return {
        resolvedUrl: originalUrl,
        resolutionStatus: "resolved",
        reason: null,
        detail: "html_metadata",
      };
    }
  }

  const batch = await resolveGoogleNewsBatch(url, timeoutMs);
  if (!batch.ok) {
    const publisherSearch = await resolveByPublisherTitleSearch({
      title: options.title,
      publisherBaseUrl: options.publisherBaseUrl,
      publisherSearchUrl: options.publisherSearchUrl,
      allowedUrlPatterns: options.allowedUrlPatterns,
      timeoutMs,
    });
    if (publisherSearch.ok) {
      return {
        resolvedUrl: publisherSearch.resolvedUrl,
        resolutionStatus: "resolved",
        reason: null,
        detail: publisherSearch.detail,
      };
    }
    return {
      resolvedUrl: null,
      resolutionStatus: "failed",
      reason: batch.reason || page.reason || "google_news_redirect_unresolved",
      detail: `${batch.detail || page.detail || page.finalUrl || ""}; ${publisherSearch.reason}${publisherSearch.detail ? `:${publisherSearch.detail}` : ""}`,
    };
  }

  return {
    resolvedUrl: batch.resolvedUrl,
    resolutionStatus: "resolved",
    reason: null,
    detail: "google_batch",
  };
}

function extractionFailure(url, resolution, reason, detail, options) {
  const result = {
    text: null,
    resolvedUrl: resolution?.resolvedUrl || null,
    resolutionStatus: resolution?.resolutionStatus || "not_required",
    failureReason: reason,
    failureDetail: detail || null,
  };
  if (options.logFailures !== false) {
    console.warn(`[본문 추출 실패] ${reason} | ${url}${detail ? ` | ${detail}` : ""}`);
  }
  return result;
}

async function extractArticle(url, options = {}) {
  const timeoutMs = readPositiveInteger(
    options.timeoutMs ?? process.env.ARTICLE_FETCH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const minTextLength = readPositiveInteger(
    options.minTextLength ?? process.env.MIN_ARTICLE_TEXT_LENGTH,
    DEFAULT_MIN_TEXT_LENGTH
  );
  const resolution = await resolveOriginalArticleUrl(url, {
    timeoutMs,
    title: options.title,
    publisherBaseUrl: options.publisherBaseUrl,
    publisherSearchUrl: options.publisherSearchUrl,
    allowedUrlPatterns: options.allowedUrlPatterns,
  });
  if (!resolution.resolvedUrl) {
    return extractionFailure(url, resolution, resolution.reason, resolution.detail, options);
  }

  if (!(await isUrlAllowedByRobots(resolution.resolvedUrl, { timeoutMs }))) {
    return extractionFailure(
      url,
      resolution,
      "robots_disallowed",
      resolution.resolvedUrl,
      options
    );
  }

  const prefetchedHtml = options.prefetchedHtml || resolution.prefetchedHtml;
  const page = prefetchedHtml
    ? { ok: true, finalUrl: resolution.resolvedUrl, html: prefetchedHtml }
    : await requestHtml(resolution.resolvedUrl, timeoutMs);
  if (!page.ok) {
    return extractionFailure(url, resolution, page.reason, page.detail, options);
  }

  try {
    const configuredHtml = removeConfiguredSelectors(
      page.html,
      options.removeSelectors || []
    );
    const selectedHtml = extractConfiguredBodyHtml(
      configuredHtml,
      options.bodySelector || ""
    );
    const selectorText = selectedHtml ? cleanArticleText(selectedHtml) : "";
    const text =
      Array.from(selectorText).length >= minTextLength
        ? selectorText
        : cleanArticleText(extractBasicArticleHtml(configuredHtml));

    const length = Array.from(text).length;
    if (length < minTextLength) {
      return extractionFailure(
        url,
        resolution,
        "extracted_text_too_short",
        `${length}/${minTextLength}`,
        options
      );
    }
    if (hasPaywallSignal(text) && length < Math.max(1_500, minTextLength * 3)) {
      return extractionFailure(url, resolution, "paywall_detected", `${length}`, options);
    }

    return {
      text: trimSummaryInput(text),
      resolvedUrl: page.finalUrl || resolution.resolvedUrl,
      resolutionStatus: resolution.resolutionStatus,
      failureReason: null,
      failureDetail: null,
    };
  } catch (error) {
    return extractionFailure(
      url,
      resolution,
      "parse_error",
      error?.message || "unknown",
      options
    );
  }
}

async function extractArticleText(url, options = {}) {
  const result = await extractArticle(url, options);
  return result.text;
}

module.exports = {
  cleanArticleText,
  decodeLegacyGoogleNewsUrl,
  extractArticle,
  extractArticleText,
  extractOriginalUrlFromHtml,
  extractConfiguredBodyHtml,
  isGoogleNewsUrl,
  isSafeArticleUrl,
  isUrlAllowedByRobots,
  parseRobotsRules,
  removeConfiguredSelectors,
  requestHtml,
  resolveOriginalArticleUrl,
  resolveByPublisherTitleSearch,
  stripArticleMetadata,
  trimSummaryInput,
};
