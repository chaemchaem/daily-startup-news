const crypto = require("node:crypto");

function decodeHtmlEntities(value = "") {
  const entities = {
    amp: "&",
    apos: "'",
    bull: "•",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    rsquo: "’",
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

// RSS 항목의 발행 시각을 읽는다. 일부 국내 CMS는 "2026-09-28 18:00:00"처럼 시간대 없이
// 한국 시각을 주는데, 이를 그대로 읽으면 실행 서버(UTC) 기준으로 9시간 어긋난다.
// 시간대 표기가 없는 국내 피드 날짜는 KST로 해석한다.
function parseFeedItemDate(item, { assumeKst = false } = {}) {
  const raw = String(item?.pubDate || item?.published || item?.updated || "").trim();
  if (raw) {
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|KST|[ECMP][SD]T))\s*$/iu.test(raw);
    // 중소벤처기업부 RSS처럼 "20260922161951"(YYYYMMDDHHmmss) 형식도 지원한다.
    const localMatch =
      raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u) ||
      raw.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/u);
    if (assumeKst && !hasTimezone && localMatch) {
      const [, year, month, day, hour = "0", minute = "0", second = "0"] = localMatch;
      const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}+09:00`;
      const parsed = parsePublishedDate(iso);
      if (parsed) return parsed;
    }
    // 숫자만 있는 값은 Date가 에포크 밀리초로 오해하므로 일반 파싱에 넘기지 않는다.
    const parsed = /^\d+$/u.test(raw) ? null : parsePublishedDate(raw);
    if (parsed) return parsed;
  }
  return parsePublishedDate(item?.isoDate);
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

// 구조화 필드는 recall보다 precision이 중요하다. 불확실하면 null을 반환한다.
const GENERIC_ACTOR_PATTERN =
  /^(?:스타트업|기업|회사|업체|업계|정부|당국|양국|양사|양측|기관|VC|AC|투자|투자사|지원|산업|시장|이번|해당|이들|국내|글로벌|해외|우리|대표|창업자|중기부|중소벤처기업부|과기정통부|금융위|금융위원회|미국|중국|일본|한국|유럽|인도|대만|베트남|반도체|드론|로봇|바이오|배터리|원전|성장동력)$/iu;
const ENGLISH_NAME_DESCRIPTOR_PATTERN =
  /^(?:American|Austrian|Belgian|British|Chinese|Danish|Dutch|Estonian|European|Finnish|French|German|Greek|Indian|Irish|Israeli|Italian|Japanese|Korean|Latvian|Lithuanian|Norwegian|Polish|Portuguese|Romanian|Spanish|Swedish|Swiss|Turkish|Ukrainian|UK|US|EU|Nordic|Baltic|Berlin|London|Paris|Stockholm|Madrid|Munich|Amsterdam|Copenhagen|Helsinki|Lisbon|Dublin|Vienna|Zurich|Profitable|Embattled|Stealth|Crypto|Startup|Scaleup|CleanTech|Cleantech|ClimateTech|Climatetech|FinTech|Fintech|HealthTech|Healthtech|DeepTech|Deeptech|PropTech|Proptech|EdTech|Edtech|InsurTech|Insurtech|BioTech|Biotech|MedTech|Medtech|FoodTech|Foodtech|AgriTech|Agritech|SpaceTech|Spacetech|Defence|Defense|Quantum|Robotics|Cybersecurity|AI)$/u;
const KOREAN_EVENT_CLAUSE_PATTERN =
  /투자|유치|시드|시리즈|프리[-\s]?[A-C]|선정|선발|모집|인수|합병|협약|MOU|맞손|실증|PoC|출시|상용화|결성|조성|수상|확보|진출|IPO|상장/iu;
const INSTITUTION_SUFFIX_PATTERN =
  /(?:부|처|청|위원회|센터|재단|공사|공단|진흥원|협회|연구원|대학교|대학|은행|시청|도청|구청|군청)$/u;
const ENGLISH_GENERIC_ACTOR_PATTERN =
  /^(?:startup|startups|company|firm|it|this|that|the|a|an|ai|fintech|platform|report|study|founder|founders|investors?)$/iu;
const FUNDING_EVENT_PATTERN =
  /투자\s*유치|투자유치|(?:투자|시드|시리즈\s*[A-H]|프리[-\s]?[A-H])[^.!?…]{0,20}(?:유치|확보)|(?:프리[-\s]?)?시리즈\s*[A-H]\s*(?:투자|유치|라운드)?|후속\s*투자|브릿지\s*투자|펀드\s*(?:결성|조성)|자금\s*조달|\braise[sd]\b|\bsecur(?:es|ed)\b\s+(?:[€$£]|\d|(?:a\s+)?(?:new\s+)?(?:funding|investment|round))|[€$£]\s*\d[\d.,]*\s*(?:million|billion|mn|bn|[MBK])?\s+(?:[Pp]re-)?(?:Series\s+[A-H]|[Ss]eed)\b|\bfirst\s+close\b|\bfinal\s+close\b|\bclose[sd]?\s+(?:a\s+)?(?:[€$£]|\d)[^!?]{0,30}\bfund\b/iu;
const BACKGROUND_FUNDING_PATTERN =
  /(?:recently|previously|earlier|last\s+(?:year|month|week)|had|once)\s+(?:\w+\s+){0,2}raised|앞서|지난해|이전에|과거|누적/iu;

function isPlausibleCompanyName(value) {
  const name = cleanText(value).replace(/^[‘’“”'"]+|[‘’“”'"]+$/gu, "");
  const length = Array.from(name).length;
  if (length < 2 || length > 30) return false;
  const isLatinName = /^[A-Za-z0-9&._\s-]+$/u.test(name);
  if ((name.match(/\s/gu) || []).length > (isLatinName ? 2 : 1)) return false;
  if (/^\d+$/u.test(name) || /[…|]/u.test(name)) return false;
  if (GENERIC_ACTOR_PATTERN.test(name) || ENGLISH_GENERIC_ACTOR_PATTERN.test(name)) {
    return false;
  }
  if (INSTITUTION_SUFFIX_PATTERN.test(name)) return false;
  // 한국어 문장 조각(조사·어미로 끝나는 구)은 회사명으로 보지 않는다.
  if (/(?:만|은|는|을|를|의|에|로|다|요|까|죠|며|고|서)$/u.test(name) && /\s/u.test(name)) {
    return false;
  }
  if (/[가-힣](?:에|에서|에게|으로)$/u.test(name)) return false;
  return true;
}

function stripTitleDecorations(title) {
  return cleanText(title)
    .replace(/\s*[|｜]\s*[^|｜]{2,40}$/u, "")
    .replace(/^(?:\[[^\]]{1,30}\]\s*)+/u, "")
    .trim();
}

function extractStructuredCompany(title, summary) {
  const titleText = stripTitleDecorations(title);
  const combined = `${titleText} ${cleanText(summary)}`.trim();
  const englishCompany = firstStructuredMatch(titleText, [
    /(?:^|[\s’'])((?:[A-Z0-9][A-Za-z0-9&._]*\s){0,3}[A-Z0-9][A-Za-z0-9&._-]{1,39})\s+(?:raises|raised|secures|secured|closes|closed|extends|extended)\b/u,
  ]);
  // "Profitable Belgian CleanTech Octave.energy raises"처럼 앞에 붙은 형용사·국가·업종 수식어를 뗀다.
  // "Repeat founder Ryan Williams raises"처럼 인물이 주어인 제목은 회사명을 비워 둔다.
  const personSubject = englishCompany
    ? new RegExp(
        `\\b(?:founder|co-founder|CEO|investor|partner|entrepreneur)\\s+${englishCompany.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s`,
        "iu"
      ).test(titleText)
    : false;
  const englishTokens = (personSubject ? "" : englishCompany || "").split(/\s+/u).filter(Boolean);
  while (englishTokens.length > 1 && ENGLISH_NAME_DESCRIPTOR_PATTERN.test(englishTokens[0])) {
    englishTokens.shift();
  }
  const englishName = englishTokens.join(" ");
  if (englishName && isPlausibleCompanyName(englishName)) return englishName;

  const hasCompanyEvent =
    /투자\s*유치|투자유치|시드|프리[-\s]?[A-C]|시리즈\s*[A-C]|선정|모집|인수|협약|실증|출시|상용화/iu.test(
      combined
    );
  if (!hasCompanyEvent) return null;

  // 1순위: "회사명, 사건" 형태의 국내 제목 구간. 쉼표 뒤에 사건이 있는 구간만 본다.
  for (const clause of titleText.split(/\s*(?:…|\.{3})\s*/u)) {
    const commaMatch = clause.match(/^([^,，]{2,40})[,，]\s*(\S.*)$/u);
    if (!commaMatch) continue;
    const tokens = commaMatch[1]
      .replace(/[‘’“”'"]/gu, "")
      .split(/\s+/u)
      .filter(Boolean);
    if (!tokens.length || tokens.length > 3) continue;
    // "데이원컴퍼니의 새 성장동력", "하늘은 드론"처럼 조사가 붙은 수식 구는 회사명이 아니다.
    if (tokens.slice(0, -1).some((token) => /(?:의|은|는|을|를|에|로)$/u.test(token))) continue;
    const lastToken = tokens.at(-1);
    if (/(?:의|은|는|을|를)$/u.test(lastToken)) continue;
    // 쉼표 뒤에 사건이 있거나, 요약에서 같은 이름이 주어("…가 선정됐다")로 확인될 때만 인정한다.
    const escapedToken = lastToken.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const confirmedBySummary = new RegExp(`${escapedToken}(?:은|는|이|가)\\s`, "u").test(
      cleanText(summary)
    );
    if (!KOREAN_EVENT_CLAUSE_PATTERN.test(commaMatch[2]) && !confirmedBySummary) continue;
    if (isPlausibleCompanyName(lastToken)) return lastToken;
  }

  // 2순위: 따옴표 이름 바로 뒤에 쉼표나 주격 조사가 붙은 경우만(서비스명·슬로건 오인 방지).
  const quotedCompany = [
    ...titleText.matchAll(/(?:^|…\s*)[‘“'"]([^’”'"]{2,30})[’”'"](?=\s*[,，]|(?:은|는|이|가)\s)/gu),
  ]
    .map((match) => cleanText(match[1]))
    .find(
      (value) =>
        isPlausibleCompanyName(value) &&
        !/\s/u.test(value) &&
        !/투자|기술|서비스|프로그램|인공태양|핵융합|플랫폼|솔루션|사업/iu.test(value)
    );
  if (quotedCompany) return quotedCompany;

  // 3순위: 요약 첫 문장의 주어가 곧바로 투자·선정 등의 사건으로 이어지는 경우.
  const actorFromSentence = firstStructuredMatch(cleanText(summary), [
    /^([A-Za-z0-9가-힣][A-Za-z0-9가-힣&·._-]{1,29})(?:은|는|이|가)\s+(?=[^.!?]{0,45}(?:투자\s*유치|유치|선정|모집|결성|출시|인수|협약|실증))/u,
  ]);
  if (actorFromSentence && isPlausibleCompanyName(actorFromSentence)) {
    return actorFromSentence;
  }
  return null;
}

function splitStructuredSegments(value) {
  return cleanText(value)
    .replace(/(\d)\.(\d)/gu, "$1․$2")
    .split(/(?<=[.!?。])\s+|\s*[…|｜]\s*|\.{3}/u)
    .map((segment) => segment.replace(/․/gu, ".").trim())
    .filter(Boolean);
}

function normalizeKoreanAmount(value) {
  let amount = cleanText(value).replace(/\s+/gu, " ").trim();
  if (!/원$/u.test(amount)) amount = `${amount} 원`;
  return amount
    .replace(/(\d)\s*(조|억|천만|만)\s*원$/u, "$1$2 원")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractFundingAmountFromSegment(segment) {
  // 기업가치(밸류에이션)·매출 같은 다른 금액은 투자금으로 보지 않는다.
  const isNonFundingAmount = (before, after) =>
    /^\s*(?:valuation|post-money|pre-money|in\s+(?:revenue|sales|ARR))/iu.test(after) ||
    /(?:기업가치|밸류에이션|몸값|매출|시가총액|valued\s+at|valuation\s+of)\s*(?:은|는|이|가|을|를)?\s*$/iu.test(before) ||
    /^\s*(?:의\s*)?(?:기업가치|밸류|매출)/u.test(after);

  for (const koreanMatch of segment.matchAll(
    /((?:약\s*|총\s*)?\d[\d,.]*\s*(?:조|억|천만|만)(?:\s*\d[\d,.]*\s*(?:억|천만|만))*)\s*(원)?/gu
  )) {
    const before = segment.slice(0, koreanMatch.index);
    const after = segment.slice(koreanMatch.index + koreanMatch[0].length);
    const hasCurrencyContext =
      Boolean(koreanMatch[2]) || /^\s*(?:규모|투자|유치|시드|시리즈|프리|펀드|의\s*(?:투자|자금))/u.test(after);
    if (hasCurrencyContext && !isNonFundingAmount(before, after)) {
      return normalizeKoreanAmount(koreanMatch[1]);
    }
  }

  const foreignPatterns = [
    /((?:US|A|C)?[€$£]\s*\d+(?:[.,]\d+)?\s*(?:million|billion|mn|bn|[MBK])?)(?![A-Za-z0-9])/gu,
    /(\d+(?:[.,]\d+)?\s*(?:million|billion)\s*(?:euros?|dollars?|pounds?))/giu,
  ];
  for (const pattern of foreignPatterns) {
    for (const match of segment.matchAll(pattern)) {
      const before = segment.slice(0, match.index);
      const after = segment.slice(match.index + match[0].length);
      // "raised $3."처럼 소수점 뒤가 잘린 금액은 저장하지 않는다.
      if (/^[.,]\s*$/u.test(after) || /^[.,]\d/u.test(after)) continue;
      if (isNonFundingAmount(before, after)) continue;
      return cleanText(match[1]).replace(/\s+/gu, " ");
    }
  }
  return null;
}

function extractFundingStageFromSegment(segment) {
  const patterns = [
    [/\b((?:[Pp]re[-\s]?)?[Ss]eed)(?:\s+round)?\b/u, (value) => value],
    [/\b[Ss]eries\s+([A-H])\b/u, (value) => `Series ${value}`],
    [/(프리[-\s]?시리즈\s*[A-H]|프리[-\s]?[A-H](?![A-Za-z]))/u, (value) => value.replace(/\s+/gu, "")],
    [/(?:^|[^A-Za-z])시리즈\s*([A-Ha-h])(?![A-Za-z])/u, (value) => `시리즈${value.toUpperCase()}`],
    [/(시드(?:\s*투자|\s*라운드)?)/u, (value) => value],
    [/(브릿지\s*(?:투자|라운드)|후속\s*투자|Pre[-\s]?IPO)/iu, (value) => value],
  ];
  for (const [pattern, format] of patterns) {
    const match = segment.match(pattern);
    if (match?.[1]) return cleanText(format(match[1]));
  }
  return null;
}

const FUND_FORMATION_PATTERN =
  /펀드\s*(?:결성|조성)|(?:first|final)\s+close|\bclose[sd]?\b[^!?]{0,40}\bfund\b/iu;

const STRUCTURED_EVENT_PATTERNS = [
  ["투자유치", FUNDING_EVENT_PATTERN],
  ["펀드결성", FUND_FORMATION_PATTERN],
  ["TIPS·LIPS 선정", /(?:TIPS|팁스|LIPS|립스).{0,35}(?:선정|선발)|(?:선정|선발).{0,35}(?:TIPS|팁스|LIPS|립스)/u],
  ["인수·M&A", /인수(?!인계)|합병|M&A|\bacquir(?:es|ed|ing)\b/u],
  ["선정", /선정|선발/u],
  ["모집", /모집|참가사\s*접수|지원기업\s*접수/u],
  ["실증·PoC", /\bPoC\b|실증|기술\s*검증/u],
  ["출시·상용화", /출시|상용화|\blaunch(?:es|ed)\b/u],
  ["협약", /협약|MOU|맞손|\bpartners?\s+with\b/u],
  ["세컨더리", /세컨더리|구주|LP\s*지분/u],
  ["지원사업", /지원사업|사업화\s*지원|글로벌\s*진출\s*지원|창업기업.{0,25}지원/u],
];

function detectStructuredEvent(value) {
  const text = cleanText(value);
  for (const [label, pattern] of STRUCTURED_EVENT_PATTERNS) {
    if (!pattern.test(text)) continue;
    // 투자유치 패턴은 펀드 결성 표현도 포함하므로, 투자유치 표현이 없으면 펀드결성으로 본다.
    if (
      label === "투자유치" &&
      FUND_FORMATION_PATTERN.test(text) &&
      !/투자\s*유치|투자유치|\braise[sd]?\b/iu.test(text)
    ) {
      return "펀드결성";
    }
    return label;
  }
  return null;
}

function extractStructuredArticleInfo({ title = "", summary = "" } = {}) {
  const titleText = stripTitleDecorations(title);
  const summaryText = cleanText(summary);

  // 사건 유형은 제목을 우선한다. 제목에서 확인되지 않을 때만 요약의 주된 사건을 쓴다.
  let eventType = detectStructuredEvent(titleText);
  if (!eventType && summaryText) {
    const summaryEvent = detectStructuredEvent(summaryText);
    const isBackgroundFunding =
      summaryEvent === "투자유치" && BACKGROUND_FUNDING_PATTERN.test(summaryText);
    eventType = isBackgroundFunding ? null : summaryEvent;
  }

  // 금액·라운드는 투자 사건이 확인되고, 같은 문장 안에 투자 표현이 있을 때만 저장한다.
  let fundingAmount = null;
  let fundingStage = null;
  if (["투자유치", "펀드결성", "세컨더리"].includes(eventType)) {
    const segments = [...splitStructuredSegments(titleText), ...splitStructuredSegments(summaryText)];
    for (const segment of segments) {
      const isFundingSegment =
        FUNDING_EVENT_PATTERN.test(segment) ||
        /펀드|세컨더리|구주|시드|시리즈|Series|[Ss]eed/u.test(segment);
      if (!isFundingSegment) continue;
      if (BACKGROUND_FUNDING_PATTERN.test(segment) && segment !== titleText) continue;
      fundingAmount ||= extractFundingAmountFromSegment(segment);
      fundingStage ||= eventType === "투자유치" ? extractFundingStageFromSegment(segment) : null;
      if (fundingAmount && fundingStage) break;
    }
  }

  // 산업은 제목에서만 판단한다. 요약의 부수적인 언급으로 산업을 붙이지 않는다.
  let industry = null;
  const industryPatterns = [
    ["AI", /(?<![A-Za-z])AI(?![A-Za-z])|인공지능|[Aa]rtificial [Ii]ntelligence/u],
    ["바이오·헬스케어", /바이오|헬스케어|의료|신약|(?<![A-Za-z])ADC(?![A-Za-z])|\b[Bb]iotech\b|\b[Hh]ealthcare\b/u],
    ["반도체", /반도체|팹리스|칩렛|\b[Ss]emiconductors?\b|\b[Cc]hips?\b/u],
    ["로봇", /로봇|로보틱스|\b[Rr]obot(?:s|ics)?\b/u],
    ["기후테크·ESG", /기후테크|클린테크|CCUS|탄소|(?<![A-Za-z])ESG(?![A-Za-z])|\b[Cc]limate\s*tech\b/u],
    ["우주항공", /우주항공|항공우주|위성|로켓|\b[Ss]atellites?\b|\b[Ss]pace\s*tech\b/u],
    ["농식품", /농식품|푸드테크|애그테크|스마트팜|\b[Aa]gri(?:tech|food)\b|\b[Ff]oodtech\b/u],
    ["사이버보안", /사이버\s*보안|\b[Cc]ybersecurity\b/u],
    ["핀테크", /핀테크|\b[Ff]intech\b/u],
    ["SaaS", /(?<![A-Za-z])SaaS(?![A-Za-z])/u],
  ];
  for (const [label, pattern] of industryPatterns) {
    if (pattern.test(titleText)) {
      industry = label;
      break;
    }
  }

  return {
    company: extractStructuredCompany(title, summary),
    fundingAmount,
    fundingStage,
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
  parseFeedItemDate,
  parsePublishedDate,
  titleFingerprint,
  truncateReportSummary,
  truncateSentence,
  validateSummaryQuality,
  validateFallbackSummaryQuality,
  validateOpenAIDescriptionSummary,
};
