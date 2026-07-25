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

function calculateTextSimilarity(left, right) {
  const leftFingerprint = titleFingerprint(left);
  const rightFingerprint = titleFingerprint(right);
  if (!leftFingerprint || !rightFingerprint) return 0;
  if (leftFingerprint === rightFingerprint) return 1;
  return Math.max(jaccardSimilarity(left, right), diceSimilarity(left, right));
}

function hasStructuredSummary(summary) {
  const text = cleanText(summary);
  const hasSubject = /(?:은|는|이|가)\s/u.test(text);
  const hasAction =
    /(?:확보|확정|접수|선보임|진행|받음|포함|구축|유치|선정|결성|조성|출시|공개|개발|고도화|상용화|확대|모집|지원|참여|수상|개최|개소|매각|인수|합병|추진)$/u.test(
      text
    );
  return Array.from(text).length >= 18 && hasSubject && hasAction;
}

const SUMMARY_METADATA_PATTERN =
  /(?:입력|수정|승인)\s*[:=]?\s*20\d{2}[.\-/년]|조회(?:수)?\s*[:=]?\s*[\d,]+|무단\s*(?:전재|복제|배포)|재배포\s*금지|저작권|copyright|관련\s*기사|구독|댓글|SNS\s*공유|전체\s*맥락을\s*이해하려면\s*기사\s*본문을\s*함께\s*확인하는\s*것이\s*좋습니다|(?:사진|자료)\s*=|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[A-Za-z0-9가-힣·._-]{2,30}\s*(?:기자|특파원)/iu;

const FALLBACK_EVENT_PATTERN =
  /유치|선정|모집|결성|조성|출시|수상|지원|확대|참여|협약|체결|인수|상용화|추진|실증|개최|매각|확보|조달|투입|제공|연계|개발|고도화|육성|나섬/iu;
const FALLBACK_STRONG_EVENT_PATTERN =
  /유치|선정|모집|결성|조성|출시|수상|협약|체결|인수|상용화|실증|매각/iu;
const FALLBACK_REPORT_ENDING_PATTERN =
  /(?:유치|선정|모집|결성|조성|출시|수상|지원|확대|참여|협약|체결|인수|상용화|추진|실증|개최|매각|확보|조달|투입|제공|연계|개발|고도화|육성|진행|구축|포함|받음|선보임|나섬|함|됨)$/u;
const TITLE_FALLBACK_EVENT_PATTERN =
  /(?:투자\s*유치|투자유치|시드\s*투자|프리[-\s]?A|시리즈\s*[A-Z]|Series\s*[A-Z]|선정|모집|수상|펀드.{0,20}(?:결성|조성)|(?:결성|조성).{0,20}펀드|출시|상용화|협약|MOU|업무협약|체결|맞손|인수|매각|데모데이\s*개최|\d[\d,.]*\s*(?:조|억|만)\s*원.{0,25}(?:투자|유치|펀드|결성))/iu;
const ENGLISH_FALLBACK_EVENT_PATTERN =
  /\b(?:raise[sd]?|secure[sd]?|fund(?:ing|ed)?|launch(?:es|ed)?|select(?:s|ed)?|support(?:s|ed)?|expand(?:s|ed)?|partner(?:s|ed)?|acquir(?:e[sd]?|ing)|invest(?:s|ed|ment)?|close[sd]?|announce[sd]?|develop(?:s|ed)?|commerciali[sz](?:e[sd]?|ing))\b/iu;

function isTitleFallbackEventEligible(title) {
  return TITLE_FALLBACK_EVENT_PATTERN.test(cleanText(title));
}

function validateFallbackSummaryQuality({ title, summary, source, summarySource }) {
  if (!['description', 'titleFallback'].includes(summarySource)) {
    return { isValid: true, reason: null };
  }

  const text = cleanText(summary);
  const length = Array.from(text).length;
  const isEnglishDescription =
    summarySource === "description" &&
    (text.match(/[A-Za-z]/gu) || []).length >= 20 &&
    (text.match(/[A-Za-z]/gu) || []).length >
      (text.match(/[가-힣]/gu) || []).length * 2;
  if (!text) return { isValid: false, reason: "fallback_empty" };
  if (length > 100) return { isValid: false, reason: "fallback_too_long" };
  if (
    isEnglishDescription &&
    (length < 60 ||
      !ENGLISH_FALLBACK_EVENT_PATTERN.test(text) ||
      !/[.!?]["')\]]?$/u.test(text))
  ) {
    return { isValid: false, reason: "english_description_incomplete" };
  }
  if (
    !isEnglishDescription &&
    (!FALLBACK_EVENT_PATTERN.test(text) || !FALLBACK_REPORT_ENDING_PATTERN.test(text))
  ) {
    return { isValid: false, reason: "noun_phrase_summary" };
  }
  if (summarySource === "description" && !isEnglishDescription && length < 40) {
    const conciseEventSentence =
      length >= 25 &&
      /(?:은|는|이|가)\s/u.test(text) &&
      FALLBACK_STRONG_EVENT_PATTERN.test(text);
    if (!conciseEventSentence) {
      return { isValid: false, reason: "description_too_short" };
    }
  }
  if (summarySource === "titleFallback" && !isTitleFallbackEventEligible(title)) {
    return { isValid: false, reason: "title_event_not_explicit" };
  }

  const summaryFingerprint = titleFingerprint(text);
  const titleValueFingerprint = titleFingerprint(title);
  if (
    summaryFingerprint &&
    titleValueFingerprint.includes(summaryFingerprint) &&
    summaryFingerprint.length < titleValueFingerprint.length * 0.8
  ) {
    return { isValid: false, reason: "truncated_title_summary" };
  }

  const sourceFingerprint = titleFingerprint(source);
  if (sourceFingerprint) {
    const withoutSource = summaryFingerprint.replaceAll(sourceFingerprint, "");
    if (!withoutSource || withoutSource.length < 12) {
      return { isValid: false, reason: "source_name_only" };
    }
  }

  return { isValid: true, reason: null };
}

function normalizeWithoutKoreanParticles(value) {
  return normalizeForMatch(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) =>
      token
        .replace(/(?:에서는|으로는|에게는|부터는|까지는|에서|에게|으로|은|는|이|가|을|를|와|과|의|에|로)$/u, "")
        .replace(/(?:하였음|했음|됐음|함|됨)$/u, "")
    )
    .filter((token) => token && !/^(?:함|됨)$/u.test(token))
    .join("");
}

function validateOpenAIDescriptionSummary({ title, summary, source }) {
  const text = cleanText(summary);
  const length = Array.from(text).length;
  const titleFingerprintValue = titleFingerprint(title);
  const summaryFingerprint = titleFingerprint(text);
  if (!titleFingerprintValue || titleFingerprintValue === summaryFingerprint) {
    return { isValid: false, reason: "openai_description_same_as_title" };
  }
  const hasExplicitActor = /[A-Za-z0-9가-힣&·._-]{2,40}(?:은|는|이|가|와|과)\s/u.test(text);
  if (length < 30) {
    const conciseEventSummary =
      length >= 25 && hasExplicitActor && FALLBACK_STRONG_EVENT_PATTERN.test(text);
    if (!conciseEventSummary) {
      return { isValid: false, reason: "openai_description_too_short" };
    }
  }
  if (length > 120) return { isValid: false, reason: "openai_description_too_long" };
  if (!FALLBACK_EVENT_PATTERN.test(text) || !FALLBACK_REPORT_ENDING_PATTERN.test(text)) {
    return { isValid: false, reason: "openai_description_missing_event" };
  }

  if (
    calculateTextSimilarity(title, text) >= 0.95 &&
    normalizeWithoutKoreanParticles(title) === normalizeWithoutKoreanParticles(text)
  ) {
    return { isValid: false, reason: "openai_description_particle_only_rewrite" };
  }

  const sharedEntity = sharedSetValue(
    extractEventEntityTokens(title),
    extractEventEntityTokens(text)
  );
  if (!sharedEntity && !hasExplicitActor) {
    return { isValid: false, reason: "openai_description_missing_entity" };
  }

  const sourceFingerprint = titleFingerprint(source);
  if (sourceFingerprint) {
    const withoutSource = summaryFingerprint.replaceAll(sourceFingerprint, "");
    if (!withoutSource || withoutSource.length < 12) {
      return { isValid: false, reason: "source_name_only" };
    }
  }
  return { isValid: true, reason: null };
}

function validateSummaryQuality(title, summary, options = {}) {
  const maxLength = options.maxLength || 100;
  const maxSimilarity = options.maxSimilarity ?? 0.8;
  const summaryLength = Array.from(cleanText(summary)).length;
  const similarity = calculateTextSimilarity(title, summary);
  let reason = null;

  if (!summaryLength) reason = "empty_summary";
  else if (summaryLength > maxLength) reason = "summary_too_long";
  else if (SUMMARY_METADATA_PATTERN.test(cleanText(summary))) {
    reason = "summary_contains_metadata";
  }
  else if (similarity >= maxSimilarity) reason = "title_summary_too_similar";
  else if (options.requireStructured && !hasStructuredSummary(summary)) {
    reason = "unstructured_title_fallback";
  }

  return {
    isValid: !reason,
    reason,
    similarity,
  };
}

function firstStructuredMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = cleanText(value).match(pattern);
    if (match?.[1]) return cleanText(match[1]);
    if (match?.[0]) return cleanText(match[0]);
  }
  return null;
}

function extractStructuredCompany(title, summary) {
  const titleText = cleanText(title).replace(/\s*\|\s*[^|]{2,40}$/u, "");
  const combined = `${titleText} ${cleanText(summary)}`.trim();
  const englishCompany = firstStructuredMatch(titleText, [
    /\b(?:[A-Z][A-Za-z-]+-based|[A-Z]{2,}\s+startup|startup)\s+([A-Z0-9][A-Za-z0-9&._-]{1,39})\s+(?:raises?|raised|secures?|secured|closes?|closed|extends?)\b/u,
    /\b([A-Z0-9][A-Za-z0-9&._-]{1,39})\s+(?:raises?|raised|secures?|secured|closes?|closed|extends?)\b/u,
  ]);
  if (englishCompany) return englishCompany;

  const quotedCompany = [...titleText.matchAll(/[‘“'"]([^’”'"]{2,35})[’”'"]/gu)]
    .map((match) => cleanText(match[1]))
    .find((value) => !/투자|기술|서비스|프로그램|인공태양|핵융합\s*발전/iu.test(value));
  if (quotedCompany) return quotedCompany;

  const actorFromSentence = firstStructuredMatch(combined, [
    /(?:^|[.!?]\s*)([A-Za-z0-9가-힣][A-Za-z0-9가-힣&·._-]{1,39})(?:은|는|이|가)\s+(?=[^.!?]{0,45}(?:투자\s*유치|유치|선정|모집|결성|출시|인수|협약|실증))/u,
  ]);
  if (actorFromSentence) return actorFromSentence;

  const leadingClause = titleText.split(/[,，…]|\.{3}/u)[0]?.trim() || "";
  const tokens = leadingClause
    .replace(/[‘’“”'"]/gu, "")
    .split(/\s+/u)
    .filter(Boolean);
  const lastToken = tokens.at(-1) || "";
  if (
    lastToken.length >= 2 &&
    lastToken.length <= 40 &&
    !/^(?:스타트업|기업|정부|기관|VC|AC|투자|지원|산업|시장)$/iu.test(lastToken) &&
    /투자\s*유치|투자유치|시드|프리[-\s]?[A-C]|시리즈\s*[A-C]|선정|모집|인수|협약|실증/iu.test(
      combined
    )
  ) {
    return lastToken;
  }
  return null;
}

function extractStructuredArticleInfo({ title = "", summary = "" } = {}) {
  const text = cleanText(`${title} ${summary}`);
  const fundingAmount = firstStructuredMatch(text, [
    /((?:약\s*|총\s*)?\d[\d,.]*\s*(?:조|억|만)\s*원)/iu,
    /([€$£]\s*\d+(?:[.,]\d+)?\s*(?:million|billion|m|bn)?)/iu,
    /(\d+(?:[.,]\d+)?\s*(?:million|billion)\s*(?:euros?|dollars?|pounds?))/iu,
  ]);
  const fundingStage = firstStructuredMatch(text, [
    /((?:pre[-\s]?)?seed(?:\s+round)?)/iu,
    /((?:series|시리즈)\s*[A-H])/iu,
    /(프리[-\s]?[A-H])/iu,
    /(시드(?:\s*투자|\s*라운드)?)/iu,
    /(브릿지(?:\s*투자|\s*라운드)?|후속\s*투자|Pre[-\s]?IPO)/iu,
  ]);

  let eventType = null;
  const eventPatterns = [
    ["투자유치", /투자\s*유치|투자유치|\braises?\b|\braised\b|\bsecures?\b.{0,25}\bfunding\b/iu],
    ["펀드결성", /펀드\s*(?:결성|조성)|(?:first|final)\s+close/iu],
    ["TIPS·LIPS 선정", /(?:TIPS|팁스|LIPS|립스).{0,35}(?:선정|선발)|(?:선정|선발).{0,35}(?:TIPS|팁스|LIPS|립스)/iu],
    ["선정", /선정|선발|확정/iu],
    ["모집", /모집|참가사\s*접수|지원기업\s*접수/iu],
    ["실증·PoC", /\bPoC\b|실증|기술\s*검증/iu],
    ["출시·상용화", /출시|상용화|공개/iu],
    ["인수·M&A", /인수|합병|M&A|acquir/iu],
    ["협약", /협약|MOU|맞손|partnership/iu],
    ["세컨더리", /세컨더리|구주|LP\s*지분|회수시장/iu],
    ["지원사업", /지원사업|사업화\s*지원|글로벌\s*진출\s*지원|창업기업.{0,25}지원/iu],
  ];
  for (const [label, pattern] of eventPatterns) {
    if (pattern.test(text)) {
      eventType = label;
      break;
    }
  }

  let industry = null;
  const industryPatterns = [
    ["AI", /(?:생성형|피지컬|의료|산업용)?\s*AI|인공지능/iu],
    ["바이오·헬스케어", /바이오|헬스케어|의료|신약|ADC/iu],
    ["반도체", /반도체|팹리스|칩렛/iu],
    ["로봇", /로봇|로보틱스/iu],
    ["기후테크·ESG", /기후테크|클린테크|CCUS|탄소|ESG/iu],
    ["우주항공", /우주항공|항공우주|위성|로켓/iu],
    ["농식품", /농식품|푸드테크|애그테크|스마트팜/iu],
    ["사이버보안", /사이버\s*보안|cybersecurity/iu],
    ["핀테크", /핀테크|fintech/iu],
    ["SaaS", /\bSaaS\b|소프트웨어\s*서비스/iu],
  ];
  for (const [label, pattern] of industryPatterns) {
    if (pattern.test(text)) {
      industry = label;
      break;
    }
  }

  return {
    company: extractStructuredCompany(title, summary),
    fundingAmount:
      fundingAmount && !/[€$£]\s*\d+[.,]$/u.test(fundingAmount)
        ? fundingAmount.replace(/\s+/gu, " ").trim()
        : null,
    fundingStage: fundingStage?.replace(/\s+/gu, " ").trim() || null,
    eventType,
    industry,
  };
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

const EVENT_TOKEN_STOPWORDS = new Set([
  "관련", "기사", "단독", "종합", "공개", "발표", "규모", "신규", "기업",
  "스타트업", "벤처", "투자", "투자유치", "유치", "시드", "프리", "시리즈a",
  "시리즈b", "시리즈c", "series", "펀드", "선정", "모집", "결성", "조성", "출시",
  "수상", "지원", "확대", "참여", "협약", "인수", "상용화", "추진", "억원",
]);

function extractEventType(value) {
  const text = normalizeForMatch(value);
  if (/투자\s*유치|투자유치|시드\s*투자|시리즈\s*[a-z]|series\s*[a-z]/iu.test(text)) return "investment";
  if (/펀드.{0,20}(?:결성|조성)|(?:결성|조성).{0,20}펀드/iu.test(text)) return "fund";
  if (/세컨더리|구주|lp\s*지분|회수시장/iu.test(text)) return "secondary";
  if (/선정/iu.test(text)) return "selection";
  if (/모집/iu.test(text)) return "recruitment";
  if (/인수|합병|m&a/iu.test(text)) return "acquisition";
  if (/출시|상용화/iu.test(text)) return "launch";
  if (/수상/iu.test(text)) return "award";
  if (/협약|mou/iu.test(text)) return "partnership";
  return null;
}

function extractEventAmounts(value) {
  return new Set(
    (normalizeForMatch(value).match(/\d[\d,.]*\s*(?:조|억|만)(?:\s*원)?/gu) || [])
      .map((amount) => amount.replace(/[\s,]/g, ""))
  );
}

function extractEventRounds(value) {
  return new Set(
    (normalizeForMatch(value).match(/(?:프리[-\s]?)?(?:시리즈|series)\s*[a-z]/giu) || [])
      .map((round) => round.replace(/^series/iu, "시리즈").replace(/[\s-]/g, ""))
  );
}

function extractEventEntityTokens(value) {
  return new Set(
    normalizeForMatch(value)
      .replace(/\[[^\]]*\]|\([^)]*\)/gu, " ")
      .replace(/[^\p{L}\p{N}&·_-]+/gu, " ")
      .split(/\s+/u)
      .map((token) => token.replace(/^[‘’“”'"._-]+|[‘’“”'"._-]+$/gu, ""))
      .filter((token) => {
        if (token.length < 2 || EVENT_TOKEN_STOPWORDS.has(token)) return false;
        if (/^\d|^(?:프리)?시리즈[a-z]$/iu.test(token)) return false;
        return true;
      })
  );
}

function sharedSetValue(left, right) {
  return [...left].find((value) => right.has(value)) || null;
}

function duplicateEventReason(left, right) {
  const leftContext = `${left.title || ""} ${left.summary || ""}`;
  const rightContext = `${right.title || ""} ${right.summary || ""}`;
  const eventType = extractEventType(leftContext);
  if (!eventType || eventType !== extractEventType(rightContext)) return null;

  const sharedEntity = sharedSetValue(
    extractEventEntityTokens(left.title || ""),
    extractEventEntityTokens(right.title || "")
  );
  if (!sharedEntity) return null;

  const sharedAmount = sharedSetValue(
    extractEventAmounts(leftContext),
    extractEventAmounts(rightContext)
  );
  const sharedRound = sharedSetValue(
    extractEventRounds(leftContext),
    extractEventRounds(rightContext)
  );
  if (sharedAmount || sharedRound) {
    return `same_event:${eventType}, entity:${sharedEntity}${sharedAmount ? `, amount:${sharedAmount}` : ""}${sharedRound ? `, round:${sharedRound}` : ""}`;
  }

  if (calculateTextSimilarity(left.title || "", right.title || "") >= 0.55) {
    return `same_event:${eventType}, entity:${sharedEntity}, similar_title`;
  }
  return null;
}

function deduplicateSummarizedItems(items, sourcePriority) {
  const ordered = [...items].sort(
    (left, right) =>
      (sourcePriority[right.summarySource] || 0) -
        (sourcePriority[left.summarySource] || 0) ||
      right.score - left.score
  );
  const kept = [];
  const removed = [];

  for (const item of ordered) {
    const duplicate = kept.find((candidate) => duplicateEventReason(item, candidate));
    if (!duplicate) {
      kept.push(item);
      continue;
    }
    removed.push({
      title: item.title,
      keptTitle: duplicate.title,
      reason: duplicateEventReason(item, duplicate),
    });
  }
  return { items: kept, removed };
}

function createArticleId(article) {
  return crypto
    .createHash("sha256")
    .update(`${article.url}|${titleFingerprint(article.title)}`)
    .digest("hex")
    .slice(0, 16);
}

function createDescriptionHash(description) {
  return crypto
    .createHash("sha256")
    .update(normalizeForMatch(description || ""))
    .digest("hex")
    .slice(0, 16);
}

function createSummaryCacheKey({ url, title, description, summarySource }) {
  const normalizedUrl = canonicalizeUrl(url) || cleanText(url);
  return crypto
    .createHash("sha256")
    .update(
      [
        normalizedUrl,
        titleFingerprint(title),
        createDescriptionHash(description),
        cleanText(summarySource),
      ].join("|")
    )
    .digest("hex")
    .slice(0, 24);
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
  calculateTextSimilarity,
  canonicalizeUrl,
  cleanText,
  containsKeyword,
  createArticleId,
  createDescriptionHash,
  createSummaryCacheKey,
  deduplicateArticles,
  deduplicateSummarizedItems,
  duplicateEventReason,
  extractStructuredArticleInfo,
  formatKstDate,
  formatKstIso,
  hasStructuredSummary,
  isAllowedSource,
  isTitleFallbackEventEligible,
  normalizeForMatch,
  parsePublishedDate,
  titleFingerprint,
  truncateReportSummary,
  truncateSentence,
  validateSummaryQuality,
  validateFallbackSummaryQuality,
  validateOpenAIDescriptionSummary,
};
