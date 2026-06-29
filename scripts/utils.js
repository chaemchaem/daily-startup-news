const crypto = require("node:crypto");

function decodeHtmlEntities(value = "") {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function cleanText(value = "") {
  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value = "") {
  return cleanText(value).normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function containsKeyword(text, keyword) {
  const normalizedText = normalizeForMatch(text);
  const normalizedKeyword = normalizeForMatch(keyword);

  if (!normalizedText || !normalizedKeyword) return false;

  if (/^[a-z\d][a-z\d .+-]*$/i.test(normalizedKeyword)) {
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
      "iu"
    ).test(normalizedText);
  }

  return normalizedText.includes(normalizedKeyword);
}

function parsePublishedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatKstIso(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

function formatKstDate(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    [
      "fbclid",
      "gclid",
      "utm_campaign",
      "utm_content",
      "utm_medium",
      "utm_source",
      "utm_term",
    ].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function titleFingerprint(value) {
  return normalizeForMatch(value)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function tokenSet(value) {
  return new Set(
    normalizeForMatch(value)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

function jaccardSimilarity(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function bigrams(value) {
  const normalized = titleFingerprint(value);
  const result = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.push(normalized.slice(index, index + 2));
  }
  return result;
}

function diceSimilarity(left, right) {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) return 0;

  const counts = new Map();
  leftBigrams.forEach((part) => counts.set(part, (counts.get(part) || 0) + 1));
  let matches = 0;

  rightBigrams.forEach((part) => {
    const count = counts.get(part) || 0;
    if (count > 0) {
      matches += 1;
      counts.set(part, count - 1);
    }
  });

  return (2 * matches) / (leftBigrams.length + rightBigrams.length);
}

function areSimilarTitles(left, right) {
  const leftFingerprint = titleFingerprint(left);
  const rightFingerprint = titleFingerprint(right);
  if (!leftFingerprint || !rightFingerprint) return false;
  if (leftFingerprint === rightFingerprint) return true;

  return jaccardSimilarity(left, right) >= 0.72 || diceSimilarity(left, right) >= 0.88;
}

function deduplicateArticles(articles) {
  const kept = [];
  const seenUrls = new Set();

  for (const article of articles) {
    const canonicalUrl = canonicalizeUrl(article.url);
    if (!canonicalUrl || seenUrls.has(canonicalUrl)) continue;
    if (kept.some((candidate) => areSimilarTitles(article.title, candidate.title))) continue;

    seenUrls.add(canonicalUrl);
    kept.push({ ...article, url: canonicalUrl });
  }

  return kept;
}

function createArticleId(article) {
  return crypto
    .createHash("sha256")
    .update(`${article.url}|${titleFingerprint(article.title)}`)
    .digest("hex")
    .slice(0, 16);
}

function isAllowedSource(source, allowedSources) {
  const normalizedSource = normalizeForMatch(source);
  if (!normalizedSource) return false;

  return allowedSources.some((allowed) => {
    const normalizedAllowed = normalizeForMatch(allowed);
    return (
      normalizedSource === normalizedAllowed ||
      normalizedSource.includes(normalizedAllowed) ||
      normalizedAllowed.includes(normalizedSource)
    );
  });
}

function truncateReportSummary(value, maxLength = 100) {
  let text = cleanText(value).replace(/[.!?。…]+$/u, "");
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;

  const ending = text.match(
    /(?:투자 유치|유치|선정|결성|조성|출시|공개|개발|고도화|상용화|확대|모집|지원|참여|수상|개최|개소|매각|인수|합병|추진|퇴장|형성)$/u
  )?.[0];
  if (ending) {
    const room = Math.max(1, maxLength - Array.from(ending).length - 1);
    let prefix = chars.slice(0, room).join("").replace(/\s+\S*$/, "").trim();
    if (!prefix) prefix = chars.slice(0, room).join("");
    return `${prefix} ${ending}`;
  }

  const room = Math.max(1, maxLength - 2);
  text = chars.slice(0, room).join("").replace(/\s+\S*$/, "").trim();
  if (!text) text = chars.slice(0, room).join("");
  return `${text} 함`;
}

function truncateSentence(value, maxLength = 100) {
  return truncateReportSummary(value, maxLength);
}

module.exports = {
  areSimilarTitles,
  canonicalizeUrl,
  cleanText,
  containsKeyword,
  createArticleId,
  deduplicateArticles,
  formatKstDate,
  formatKstIso,
  isAllowedSource,
  normalizeForMatch,
  parsePublishedDate,
  titleFingerprint,
  truncateReportSummary,
  truncateSentence,
};
