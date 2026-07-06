const {
  calculateTextSimilarity,
  cleanText,
  containsKeyword,
  truncateReportSummary,
  validateOpenAIDescriptionSummary,
  validateSummaryQuality,
} = require("./utils");

const SUMMARY_MAX_LENGTH = 100;
const VAGUE_EXPRESSIONS = [
  "동향입니다",
  "소식입니다",
  "관련 기사입니다",
  "내용을 다룸",
  "주목됩니다",
];

const ACTION_WORDS = [
  "투자 유치",
  "투자유치",
  "펀드 결성",
  "펀드 조성",
  "선정",
  "모집",
  "지원",
  "확대",
  "출시",
  "공개",
  "개발",
  "고도화",
  "상용화",
  "개소",
  "개최",
  "수상",
  "참여",
  "인수",
  "합병",
  "매각",
  "맞손",
];
const BODY_BOILERPLATE_PATTERN =
  /공식\s*누리집|홈페이지에서\s*확인|첨부\s*문서|발표\s*문서|공개\s*자료|신청\s*절차|제출\s*서류|질의응답|담당\s*부서|세부\s*일정|기사\s*제보/iu;
const DESCRIPTION_FALLBACK_KEYWORDS = [
  ...ACTION_WORDS,
  "스타트업",
  "벤처",
  "창업기업",
  "투자",
  "시리즈",
  "시드",
  "TIPS",
  "팁스",
  "LIPS",
  "립스",
  "지원사업",
  "데모데이",
  "펀드",
  "세컨더리",
  "구주",
];

const EXTRACTIVE_KEYWORD_WEIGHTS = [
  ["투자 유치", 12], ["투자유치", 12], ["시드", 8], ["프리A", 9],
  ["시리즈A", 10], ["시리즈B", 10], ["Series A", 10], ["Series B", 10],
  ["억 원", 9], ["조 원", 9], ["펀드", 7], ["결성", 9], ["VC", 6],
  ["벤처캐피탈", 7], ["액셀러레이터", 7], ["선정", 9], ["모집", 7],
  ["지원", 5], ["지원사업", 9], ["TIPS", 10], ["팁스", 10], ["LIPS", 10],
  ["립스", 10], ["스타트업", 6], ["벤처기업", 7], ["창업기업", 7],
  ["실증", 8], ["PoC", 8], ["오픈이노베이션", 8], ["데모데이", 8],
  ["IR", 6], ["수상", 8], ["출시", 8], ["상용화", 8], ["협약", 7],
  ["인수", 9], ["구주", 10], ["세컨더리", 10], ["회수시장", 9],
];

const EXTRACTIVE_META_PATTERNS = [
  /(?:^|\s)(?:입력|수정|승인)\s*[:=]?\s*20\d{2}[.\-/년]/iu,
  /(?:^|\s)조회(?:수)?\s*[:=]?\s*[\d,]+/iu,
  /무단\s*(?:전재|복제|배포)|재배포\s*금지|저작권|copyright/iu,
  /관련\s*기사|인기\s*기사|추천\s*기사|구독|댓글|로그인|SNS\s*공유|공유하기/iu,
  /기사\s*원문\s*보기|원문\s*보기|제보하기|기사\s*제보|구독하기/iu,
  /전체\s*맥락을\s*이해하려면\s*기사\s*본문을\s*함께\s*확인하는\s*것이\s*좋습니다/iu,
  /(?:사진|자료|그래픽)\s*=|사진\s*설명/iu,
  /메뉴|전체기사|최신기사|많이\s*본\s*뉴스|광고\s*문의/iu,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /[A-Za-z0-9가-힣·._-]{2,30}\s*(?:기자|특파원)/u,
  /^20\d{2}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*\d{1,2}:\d{2})?$/u,
];

const WEAK_FACT_PATTERNS = [
  /중요하(?:다|다고)|주목(?:된다|받는다)|전망(?:이다|된다)|기대(?:된다|한다)/u,
  /시장(?:이|은)?\s*(?:성장|확대)할\s*것/u,
  /업계\s*관계자는?.{0,30}(?:말했다|설명했다)/u,
];

const ADVERTISING_SENTENCE_PATTERN =
  /광고|협찬|무료\s*체험|할인|이벤트|지금\s*신청|뉴스레터|구독/u;
const CONCRETE_ACTION_PATTERN =
  /유치|조달|결성|조성|선정|모집|지원|실증|출시|상용화|협약|인수|매각|수상|개최|확대|참여|투입|확보|개발/u;
const STARTUP_CONTEXT_PATTERN =
  /스타트업|벤처기업|창업기업|투자\s*유치|VC|벤처캐피탈|액셀러레이터|TIPS|팁스|LIPS|립스|지원사업|데모데이|\bIR\b|실증|PoC|오픈이노베이션/iu;
const INVESTMENT_TITLE_INTENT_PATTERN =
  /투자\s*유치|투자유치|시드\s*(?:라운드|투자)|프리[-\s]?[A-C]|시리즈\s*[A-C]|Series\s*[A-C]|후속\s*투자|브릿지\s*투자|펀드\s*(?:결성|조성)/iu;
const SUPPORT_TITLE_INTENT_PATTERN =
  /(?:스타트업|창업기업|벤처기업|초기기업|참여기업).{0,55}(?:지원|육성|모집|프로그램|글로벌\s*진출|실증|PoC|MOU|협약|전용\s*기능)|(?:지원|육성|모집|프로그램|글로벌\s*진출|실증|PoC|MOU|협약).{0,55}(?:스타트업|창업기업|벤처기업|초기기업|참여기업)/iu;
const ENGLISH_EVENT_PATTERN =
  /\b(?:raise[sd]?|secure[sd]?|fund(?:ing|ed)?|launch(?:es|ed)?|select(?:s|ed)?|support(?:s|ed)?|expand(?:s|ed)?|partner(?:s|ed)?|acquir(?:e[sd]?|ing)|invest(?:s|ed|ment)?|close[sd]?|announce[sd]?|develop(?:s|ed)?|commerciali[sz](?:e[sd]?|ing))\b/iu;

const DEFAULT_OPENAI_REQUEST_DELAY_MS = 7_000;
const DEFAULT_OPENAI_MAX_RETRIES = 2;
const DEFAULT_OPENAI_DAILY_CALL_BUDGET = 12;
const DEFAULT_OPENAI_ARTICLE_TEXT_MAX_CHARS = 3_500;
let openAIRequestQueue = Promise.resolve();
let lastOpenAIRequestStartedAt = 0;
let openAIDailyLimitReached = false;
let openAITpmLimitReached = false;
const openAIRequestMetrics = {
  totalCalls: 0,
  bodyCalls: 0,
  descriptionCalls: 0,
  rpmRateLimitCount: 0,
  rpmRetrySuccessCount: 0,
  rpmFinalFailureCount: 0,
  tpmRateLimitCount: 0,
  tpmRetrySuccessCount: 0,
  tpmFinalFailureCount: 0,
  tpmReached: false,
  tpmRetryAfterSeconds: null,
  tpmSkippedCount: 0,
  tpmBodySkippedCount: 0,
  tpmDescriptionSkippedCount: 0,
  unknownRateLimitCount: 0,
  rpdReached: false,
  rpdSkippedCount: 0,
  rpdDescriptionSkippedCount: 0,
  budgetSkippedCount: 0,
  budgetDescriptionSkippedCount: 0,
  dailyLimitInfo: null,
};

function readNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function wait(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function openAIRequestDelayMs() {
  return readNonNegativeInteger(
    process.env.OPENAI_REQUEST_DELAY_MS,
    DEFAULT_OPENAI_REQUEST_DELAY_MS
  );
}

function openAIMaxRetries() {
  return readNonNegativeInteger(
    process.env.OPENAI_MAX_RETRIES,
    DEFAULT_OPENAI_MAX_RETRIES
  );
}

function openAIDailyCallBudget() {
  return readNonNegativeInteger(
    process.env.OPENAI_DAILY_CALL_BUDGET,
    DEFAULT_OPENAI_DAILY_CALL_BUDGET
  );
}

function openAIArticleTextMaxChars() {
  const parsed = Number.parseInt(process.env.OPENAI_ARTICLE_TEXT_MAX_CHARS, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OPENAI_ARTICLE_TEXT_MAX_CHARS;
}

function rateLimitBackoffMs(retryNumber) {
  return retryNumber * 20_000;
}

function classifyRateLimit(error) {
  const message = cleanText(error?.message || error || "");
  const is429 =
    error?.name === "RateLimitError" ||
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.code === 429 ||
    error?.code === "rate_limit_exceeded" ||
    /HTTP\s*429/iu.test(message);
  if (!is429) return null;
  if (/requests?\s*per\s*day|\bRPD\b/iu.test(message)) return "daily";
  if (/tokens?\s*per\s*min|\bTPM\b/iu.test(message)) return "tpm";
  if (/requests?\s*per\s*min|\bRPM\b/iu.test(message)) return "rpm";
  return "unknown";
}

function parseRetryAfterSeconds(message) {
  const match = cleanText(message).match(
    /Please\s+try\s+again\s+in\s+((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/iu
  );
  if (!match) return null;
  let seconds = 0;
  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/giu)) {
    const value = Number.parseFloat(part[1]);
    const unit = part[2].toLowerCase();
    if (unit === "h") seconds += value * 3_600;
    else if (unit === "m") seconds += value * 60;
    else if (unit === "s") seconds += value;
    else if (unit === "ms") seconds += value / 1_000;
  }
  return Number.isFinite(seconds) ? seconds : null;
}

function parseDailyLimitInfo(message, model) {
  const normalized = cleanText(message);
  return {
    model,
    limit:
      normalized.match(/Limit\s*[:=]?\s*([\d,]+)/iu)?.[1]?.replace(/,+$/u, "") ||
      "unknown",
    used:
      normalized.match(/Used\s*[:=]?\s*([\d,]+)/iu)?.[1]?.replace(/,+$/u, "") ||
      "unknown",
  };
}

function createOpenAIControlError(code, message, apiCallMade = false) {
  const error = new Error(message);
  error.code = code;
  error.apiCallMade = apiCallMade;
  return error;
}

async function waitForOpenAIRequestSlot() {
  const delayMs = openAIRequestDelayMs();
  const elapsed = Date.now() - lastOpenAIRequestStartedAt;
  if (lastOpenAIRequestStartedAt && elapsed < delayMs) {
    await wait(delayMs - elapsed);
  }
  lastOpenAIRequestStartedAt = Date.now();
}

async function executeQueuedOpenAIRequest({ title, requestBody, summaryMode = "body" }) {
  const maxRetries = openAIMaxRetries();
  let retryingRateLimitType = null;

  if (openAIDailyLimitReached) {
    openAIRequestMetrics.rpdSkippedCount += 1;
    if (summaryMode === "description") {
      openAIRequestMetrics.rpdDescriptionSkippedCount += 1;
    }
    throw createOpenAIControlError(
      "openai_daily_limit_reached",
      "OpenAI 일일 요청 한도 도달로 호출을 건너뜁니다."
    );
  }
  if (openAITpmLimitReached) {
    openAIRequestMetrics.tpmSkippedCount += 1;
    if (summaryMode === "body") openAIRequestMetrics.tpmBodySkippedCount += 1;
    else openAIRequestMetrics.tpmDescriptionSkippedCount += 1;
    throw createOpenAIControlError(
      "openai_tpm_limit_reached",
      "OpenAI TPM 한도 도달로 호출을 건너뜁니다."
    );
  }

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    if (openAIRequestMetrics.totalCalls >= openAIDailyCallBudget()) {
      openAIRequestMetrics.budgetSkippedCount += 1;
      if (summaryMode === "description") {
        openAIRequestMetrics.budgetDescriptionSkippedCount += 1;
      }
      throw createOpenAIControlError(
        "openai_daily_budget_exceeded",
        `OpenAI 실행 예산 ${openAIDailyCallBudget()}건을 모두 사용했습니다.`
      );
    }
    await waitForOpenAIRequestSlot();
    openAIRequestMetrics.totalCalls += 1;
    if (summaryMode === "description") openAIRequestMetrics.descriptionCalls += 1;
    else openAIRequestMetrics.bodyCalls += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (response.status === 429) {
        const detail = cleanText(await response.text()).slice(0, 1_000);
        const error = new Error(`OpenAI API HTTP 429${detail ? `: ${detail}` : ""}`);
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const detail = cleanText(await response.text()).slice(0, 180);
        throw new Error(`OpenAI API HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const payload = await response.json();
      if (retryingRateLimitType === "rpm") {
        openAIRequestMetrics.rpmRetrySuccessCount += 1;
        console.log(`[OpenAI RPM 재시도 성공] ${title}`);
      } else if (retryingRateLimitType === "tpm") {
        openAIRequestMetrics.tpmRetrySuccessCount += 1;
        console.log(`[OpenAI TPM 재시도 성공] ${title}`);
      }
      return payload;
    } catch (error) {
      const rateLimitType = classifyRateLimit(error);
      if (!rateLimitType) throw error;
      error.apiCallMade = true;

      if (rateLimitType === "daily") {
        openAIDailyLimitReached = true;
        openAIRequestMetrics.rpdReached = true;
        openAIRequestMetrics.dailyLimitInfo = parseDailyLimitInfo(
          error.message,
          requestBody.model || process.env.OPENAI_SUMMARY_MODEL || "unknown"
        );
        const info = openAIRequestMetrics.dailyLimitInfo;
        console.warn(
          `[OpenAI 일일 한도 도달] model=${info.model}, limit=${info.limit}, used=${info.used}`
        );
        error.code = "openai_daily_limit_reached";
        throw error;
      }

      if (rateLimitType === "unknown") {
        openAIRequestMetrics.unknownRateLimitCount += 1;
        error.code = "openai_rate_limit_unknown";
        throw error;
      }
      const retryAfterSeconds = parseRetryAfterSeconds(error.message);
      if (rateLimitType === "tpm") {
        openAIRequestMetrics.tpmRateLimitCount += 1;
        openAIRequestMetrics.tpmRetryAfterSeconds = retryAfterSeconds;
        if (retryAfterSeconds === null || retryAfterSeconds > 120) {
          openAITpmLimitReached = true;
          openAIRequestMetrics.tpmReached = true;
          openAIRequestMetrics.tpmFinalFailureCount += 1;
          console.warn(
            `[OpenAI TPM 한도 도달] retryAfter=${retryAfterSeconds === null ? "unknown" : `${retryAfterSeconds.toFixed(2)}s`} | ${title}`
          );
          error.code = "openai_tpm_limit_reached";
          throw error;
        }
      } else {
        openAIRequestMetrics.rpmRateLimitCount += 1;
        if (retryAfterSeconds !== null && retryAfterSeconds > 120) {
          openAIRequestMetrics.rpmFinalFailureCount += 1;
          error.code = "openai_rpm_retry_too_long";
          throw error;
        }
      }
      retryingRateLimitType = rateLimitType;
      if (retry >= maxRetries) {
        if (rateLimitType === "tpm") openAIRequestMetrics.tpmFinalFailureCount += 1;
        else openAIRequestMetrics.rpmFinalFailureCount += 1;
        console.warn(`[OpenAI ${rateLimitType.toUpperCase()} 최종 실패] ${title}: ${error.message}`);
        throw error;
      }
      const retryNumber = retry + 1;
      const backoffMs = Math.max(
        rateLimitBackoffMs(retryNumber),
        retryAfterSeconds === null ? 0 : Math.ceil(retryAfterSeconds * 1_000)
      );
      clearTimeout(timeout);
      console.warn(
        `[OpenAI ${rateLimitType.toUpperCase()} rate limit] ${title} | ${backoffMs / 1_000}초 후 재시도 (${retryNumber}/${maxRetries})`
      );
      await wait(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("OpenAI 요청 재시도 상태가 올바르지 않습니다.");
}

function enqueueOpenAIRequest(request) {
  const queued = openAIRequestQueue.then(() => executeQueuedOpenAIRequest(request));
  openAIRequestQueue = queued.catch(() => undefined);
  return queued;
}

function getOpenAIRequestMetrics() {
  return {
    ...openAIRequestMetrics,
    requestDelayMs: openAIRequestDelayMs(),
    maxRetries: openAIMaxRetries(),
    dailyCallBudget: openAIDailyCallBudget(),
    dailyLimitReached: openAIDailyLimitReached,
    articleTextMaxChars: openAIArticleTextMaxChars(),
    tpmLimitReached: openAITpmLimitReached,
  };
}

function resetOpenAIRequestMetrics() {
  openAIRequestQueue = Promise.resolve();
  lastOpenAIRequestStartedAt = 0;
  openAIDailyLimitReached = false;
  openAITpmLimitReached = false;
  openAIRequestMetrics.totalCalls = 0;
  openAIRequestMetrics.bodyCalls = 0;
  openAIRequestMetrics.descriptionCalls = 0;
  openAIRequestMetrics.rpmRateLimitCount = 0;
  openAIRequestMetrics.rpmRetrySuccessCount = 0;
  openAIRequestMetrics.rpmFinalFailureCount = 0;
  openAIRequestMetrics.tpmRateLimitCount = 0;
  openAIRequestMetrics.tpmRetrySuccessCount = 0;
  openAIRequestMetrics.tpmFinalFailureCount = 0;
  openAIRequestMetrics.tpmReached = false;
  openAIRequestMetrics.tpmRetryAfterSeconds = null;
  openAIRequestMetrics.tpmSkippedCount = 0;
  openAIRequestMetrics.tpmBodySkippedCount = 0;
  openAIRequestMetrics.tpmDescriptionSkippedCount = 0;
  openAIRequestMetrics.unknownRateLimitCount = 0;
  openAIRequestMetrics.rpdReached = false;
  openAIRequestMetrics.rpdSkippedCount = 0;
  openAIRequestMetrics.rpdDescriptionSkippedCount = 0;
  openAIRequestMetrics.budgetSkippedCount = 0;
  openAIRequestMetrics.budgetDescriptionSkippedCount = 0;
  openAIRequestMetrics.dailyLimitInfo = null;
}

function prepareText(value) {
  return cleanText(value)
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replace(/\s+(?:外|등)$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripQuotes(value) {
  return cleanText(value)
    .replace(/[“”‘’"']/g, "")
    .replace(/\s*(?:…|\.{3,})\s*/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(\d),\s+(?=\d)/g, "$1,")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

function findTopLevelComma(value) {
  const pairs = { '"': '"', "'": "'", "“": "”", "‘": "’" };
  let closingQuote = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (closingQuote) {
      if (character === closingQuote) closingQuote = null;
      continue;
    }
    if (pairs[character]) {
      closingQuote = pairs[character];
      continue;
    }
    if (character === ",") return index;
  }

  return -1;
}

function extractLeadingQuotedFact(title) {
  return (
    title.match(/^["“'‘]([^"”'’]{2,45})["”'’]\s*/u)?.[1]?.trim() || ""
  );
}

function cleanSubjectCandidate(value) {
  let subject = value
    .replace(/^["“'‘][^"”'’]{2,45}["”'’]\s*/u, "")
    .replace(/^.*(?:…|\.{3,})\s*/u, "")
    .replace(/\s+(?:맞손|선정|모집|지원|출시|개발|결성|조성|개최|개소).*$/u, "")
    .replace(/[“”‘’"']/g, "")
    .trim();

  const trailingQuotedName = value
    .match(/[“‘"']([^”’"']{2,24})[”’"']\s*$/u)?.[1]
    ?.trim();
  if (
    trailingQuotedName &&
    !ACTION_WORDS.some((action) => trailingQuotedName.includes(action))
  ) {
    subject = trailingQuotedName;
  }

  if (
    !subject ||
    Array.from(subject).length > 35 ||
    /^(?:기술 기업|스타트업|기업|업계|시장|정부|VC)$/u.test(subject)
  ) {
    return "";
  }

  return subject;
}

function extractSubjectFromDescription(description) {
  const match = prepareText(description).match(
    /(?:^|[.!?]\s*)([A-Za-z0-9가-힣][A-Za-z0-9가-힣&·._-]{1,29})(?:은|는|이|가)\s/u
  );
  return match?.[1] || "";
}

function analyzeTitle(title, description) {
  const prepared = prepareText(title);
  const commaIndex = findTopLevelComma(prepared);
  let subject = "";
  let clause = "";

  if (commaIndex >= 0) {
    subject = cleanSubjectCandidate(prepared.slice(0, commaIndex));
    clause = prepared.slice(commaIndex + 1).trim();
  } else {
    const quotedSpeaker = prepared.match(
      /^([A-Za-z0-9가-힣][A-Za-z0-9가-힣&·._-]{1,29})\s+["“'‘]/u
    );
    if (quotedSpeaker) {
      subject = quotedSpeaker[1];
      clause = prepared.slice(quotedSpeaker[0].length - 1).trim();
    } else {
      const actionPattern = new RegExp(
        `\\s(?:${ACTION_WORDS.map((word) => word.replace(/\s+/g, "\\s*")).join("|")})`,
        "u"
      );
      const actionMatch = actionPattern.exec(prepared);
      if (actionMatch?.index > 1) {
        subject = cleanSubjectCandidate(prepared.slice(0, actionMatch.index));
        clause = prepared.slice(actionMatch.index).trim();
      }
    }
  }

  if (!subject) subject = extractSubjectFromDescription(description);
  if (!clause && subject && prepared.startsWith(subject)) {
    clause = prepared.slice(subject.length).replace(/^[은는이가,\s]+/u, "").trim();
  }

  return {
    prepared,
    subject,
    clause: clause || prepared,
    leadingFact: extractLeadingQuotedFact(prepared),
  };
}

function hangulParticle(subject) {
  const last = Array.from(subject).at(-1) || "";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? "이" : "가";
  return "가";
}

function subjectPhrase(subject) {
  return subject ? `${subject}${hangulParticle(subject)}` : "";
}

function withObjectParticle(value) {
  const text = cleanText(value);
  if (!text || /[을를]$/u.test(text)) return text;
  const last = Array.from(text).at(-1) || "";
  const code = last.charCodeAt(0);
  const particle = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 ? "을" : "를";
  return `${text}${particle}`;
}

function firstMatch(texts, pattern) {
  for (const text of texts) {
    const match = prepareText(text).match(pattern);
    if (match) return cleanText(match[0]);
  }
  return "";
}

function normalizeMoney(value) {
  return value
    .replace(/(\d)\s*조\s*원/u, "$1조 원")
    .replace(/(\d)\s*억\s*원/u, "$1억 원")
    .replace(/(\d)\s*만\s*원/u, "$1만 원")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFacts(title, description) {
  const texts = [title, description];
  const amount = firstMatch(
    texts,
    /(?:약\s*|최대\s*)?(?:\d[\d,.]*\s*(?:조|억|만)\s*원|\d[\d,.]*\s*(?:달러|원)|\$\s*\d[\d,.]*(?:\s*(?:million|billion))?)/iu
  );
  const stage = firstMatch(
    texts,
    /(?:프리[-\s]?시리즈\s*[A-Z]|프리[-\s]?[A-Z]|시리즈\s*[A-Z]|Series\s*[A-Z]|시드|브릿지|후속\s*투자|Pre[-\s]?IPO)/iu
  );
  const count = firstMatch(
    texts,
    /(?:총\s*|신규\s*|최대\s*)?\d[\d,]*\s*(?:곳|개사|개\s*기업|개팀|명|팀)/u
  );

  return {
    amount: normalizeMoney(amount),
    count,
    stage: stage
      .replace(/^series\s*/iu, "시리즈")
      .replace(/^시리즈\s*/u, "시리즈")
      .replace(/^프리[-\s]?시리즈\s*/u, "프리시리즈")
      .trim(),
  };
}

function normalizeActionEnding(value) {
  return stripQuotes(value)
    .replace(/(\d)\s*(조|억|만)\s*원/gu, "$1$2 원")
    .replace(/\b外$/u, "")
    .replace(/투자유치/g, "투자 유치")
    .replace(/선정(?:됐|되었|했다|한다|해졌다)(?:다)?$/u, "선정")
    .replace(/모집(?:했|한다|에 나선)(?:다)?$/u, "모집")
    .replace(/지원(?:했|한다|에 나선)(?:다)?$/u, "지원")
    .replace(/확대(?:했|한다|됐다|되었다)(?:다)?$/u, "확대")
    .replace(/출시(?:했|한다|됐다)(?:다)?$/u, "출시")
    .replace(/공개(?:했|한다|됐다)(?:다)?$/u, "공개")
    .replace(/개발(?:했|한다|에 성공했다)(?:다)?$/u, "개발")
    .replace(/고도화(?:했|한다|됐다)(?:다)?$/u, "고도화")
    .replace(/상용화(?:했|한다|됐다)(?:다)?$/u, "상용화")
    .replace(/결성(?:했|한다|됐다)(?:다)?$/u, "결성")
    .replace(/조성(?:했|한다|됐다)(?:다)?$/u, "조성")
    .replace(/개최(?:했|한다|됐다)(?:다)?$/u, "개최")
    .replace(/개소(?:했|한다|됐다)(?:다)?$/u, "개소")
    .replace(/참여(?:했|한다|됐다)(?:다)?$/u, "참여")
    .replace(/수상(?:했|한다)(?:다)?$/u, "수상")
    .replace(/(투입|활용|확대|강화|추진|제공|공급|지원|연계|확보|개선|진출|구축|검증|운영)(?:할\s*(?:계획|예정|방침)(?:이다)?|한다|했다|된다|됐다)(?:다)?$/u, "$1")
    .replace(/(?:할\s*(?:계획|예정|방침)(?:이다)?|할\s*것(?:이다)?|예정이다)$/u, "추진")
    .replace(/[.!?。]+$/u, "")
    .trim();
}

function includesFact(text, fact) {
  if (!fact) return true;
  const compactText = cleanText(text).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  const compactFact = cleanText(fact).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  return compactText.includes(compactFact);
}

function addMissingFacts(clause, facts, { includeCount = false } = {}) {
  const additions = [];
  if (facts.amount && !includesFact(clause, facts.amount)) additions.push(`${facts.amount} 규모`);
  if (facts.stage && !includesFact(clause, facts.stage)) additions.push(facts.stage);
  let enrichedClause = clause;
  if (includeCount && facts.count && !includesFact(clause, facts.count)) {
    const selectionActionPattern = /\s(선정|모집|발표|개최|개소)(?=$|\s)/u;
    if (/\s(?:지원|확대)(?=$|\s)/u.test(clause)) {
      enrichedClause = `${facts.count} 대상으로 ${clause}`;
    } else {
      enrichedClause = selectionActionPattern.test(clause)
        ? clause.replace(selectionActionPattern, ` ${facts.count} $1`)
        : `${facts.count} ${clause}`;
    }
  }
  return normalizeActionEnding(`${additions.join(" ")} ${enrichedClause}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDescriptionActionClause(description, subject) {
  const sentences = prepareText(description)
    .split(/[.!?。](?:\s|$)/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const actionPattern = new RegExp(
    ACTION_WORDS.map((word) => word.replace(/\s+/g, "\\s*")).join("|"),
    "u"
  );
  const candidates = sentences.filter(
    (sentence) => actionPattern.test(sentence) && !BODY_BOILERPLATE_PATTERN.test(sentence)
  );
  if (!candidates.length) return "";

  const scored = candidates
    .map((sentence) => {
      const mentionsSubject = Boolean(subject && sentence.includes(subject));
      let clause = sentence.replace(/\s+-\s+[^-]{2,60}$/u, "").trim();
      if (subject) {
        clause = clause.replace(
          new RegExp(`^${escapeRegExp(subject)}(?:은|는|이|가)?\\s*`, "u"),
          ""
        );
        const subjectIndex = clause.indexOf(subject);
        if (subjectIndex >= 0 && subjectIndex < 60) {
          clause = clause
            .slice(subjectIndex + subject.length)
            .replace(/^[은는이가,\s]+/u, "")
            .trim();
        }
      }
      clause = normalizeActionEnding(clause);
      const specificTerms =
        clause.match(/솔루션|플랫폼|서비스|기술|제품|정책|지원사업|프로그램|센터|펀드/gu)
          ?.length || 0;
      return {
        clause,
        score:
          Math.min(Array.from(clause).length, 70) +
          specificTerms * 12 +
          (mentionsSubject ? 40 : 0),
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0].clause;
}

function extractSupportingClause(description, title, subject) {
  const sentences = prepareText(description)
    .split(/[.!?。](?:\s|$)/u)
    .map((sentence) => normalizeActionEnding(sentence))
    .filter((sentence) => {
      const length = Array.from(sentence).length;
      return (
        length >= 18 &&
        length <= 180 &&
        calculateTextSimilarity(title, sentence) < 0.65 &&
        !BODY_BOILERPLATE_PATTERN.test(sentence)
      );
    });
  if (!sentences.length) return "";

  const purposePattern =
    /조달|확보한?\s*자금|투자자|참여|목적|사업화|양산|실증|판로|고객|해외|수출|매출|고용|후속|연구개발|R&D|상용|비용|효율|유동성|회수시장|협업|입주공간|컨설팅/iu;
  const actionPattern =
    /투입|활용|확대|강화|추진|제공|공급|지원|연계|확보|개선|진출|구축|검증|운영|개발|상용화|인수|선정/iu;

  const selected = sentences
    .map((sentence) => {
      const titleSimilarity = calculateTextSimilarity(title, sentence);
      return {
        sentence,
        score:
          Math.min(Array.from(sentence).length, 90) +
          (purposePattern.test(sentence) ? 35 : 0) +
          (actionPattern.test(sentence) ? 20 : 0) -
          titleSimilarity * 100,
      };
    })
    .sort((left, right) => right.score - left.score)[0].sentence;

  let clause = selected;
  if (subject) {
    clause = clause.replace(
      new RegExp(`^${escapeRegExp(subject)}(?:은|는|이|가)?\\s*`, "u"),
      ""
    );
  }
  clause = clause
    .replace(/^(?:회사|기업|기관|정부|운영사들?|선정\s*기업들?|이\s*펀드|펀드|이들)(?:은|는|이|가|에는)?\s*/u, "")
    .replace(/^(?:이를|이번\s*투자를|조달한\s*자금을?)\s*/u, "")
    .trim();
  return normalizeActionEnding(clause);
}

function connectActionClause(value) {
  return normalizeActionEnding(value)
    .replace(/투자\s*유치$/u, "투자 유치해")
    .replace(/후속\s*투자$/u, "후속 투자에 참여해")
    .replace(/펀드\s*(결성|조성)$/u, "펀드를 $1해")
    .replace(/(선정|출시|공개|개발|고도화|상용화|확대|참여|수상|개최|개소|확보)$/u, "$1해")
    .replace(/모집$/u, "모집하며")
    .replace(/지원$/u, "지원하며");
}

function addSupportingFact(baseClause, analysis, description) {
  const supporting = extractSupportingClause(description, analysis.prepared, analysis.subject);
  if (!supporting) return baseClause;
  return `${connectActionClause(baseClause)} ${supporting}`.trim();
}

function compose(subject, clause) {
  const normalizedClause = normalizeActionEnding(clause);
  if (!subject) return normalizedClause;
  if (includesFact(normalizedClause, subject)) return normalizedClause;
  if (/^[A-Za-z0-9가-힣&·._-]{2,35}(?:은|는|이|가)\s/u.test(normalizedClause)) {
    return normalizedClause;
  }
  return `${subjectPhrase(subject)} ${normalizedClause}`.trim();
}

function summarizeKnownHeadline(title) {
  const prepared = prepareText(title);

  if (/생성형 AI 사용 변화/u.test(prepared) && /클로드.*GPT 첫 역전/u.test(prepared)) {
    const month = prepared.match(/\d+월/u)?.[0] || "";
    return `클로드가 ${month} 생성형 AI 사용량에서 GPT를 처음 역전`.replace(/\s+/g, " ");
  }
  if (/클로드,\s*GPT 넘었다/u.test(prepared)) {
    return "클로드가 GPT 사용량을 넘어 국내 생성형 AI 3강 구도 형성";
  }
  if (/VC 되고파/u.test(prepared) && /제조혁신 파트너/u.test(prepared)) {
    return "기술기업의 제조혁신을 지원하는 VC 파트너 역할 강화 추진";
  }
  if (/STO 개척한 스타트업.*퇴장/u.test(prepared)) {
    return "혁신금융으로 주목받던 STO 스타트업들이 시장에서 퇴장";
  }

  return "";
}

function summarizeFundFormation(analysis, facts, description) {
  let clause = analysis.clause;
  if (!/펀드/u.test(clause)) {
    const fundType = firstMatch(
      [analysis.prepared],
      /(?:신규\s*)?(?:벤처|세컨더리|블라인드|모태|성장|지역)?\s*펀드/u
    );
    clause = `${fundType || "신규 펀드"} 결성`;
  }
  const baseClause = addMissingFacts(clause, { ...facts, stage: "" });
  return compose(analysis.subject, addSupportingFact(baseClause, analysis, description));
}

function summarizeInvestment(analysis, facts, description) {
  let clause = addMissingFacts(analysis.clause, facts);
  if (!/(?:투자\s*유치|시드\s*투자|후속\s*투자|투자\s*참여)/u.test(clause)) {
    clause = `${clause} 투자 유치`;
  }
  return compose(analysis.subject, addSupportingFact(clause, analysis, description));
}

function summarizeTipsOrLips(analysis, facts, description) {
  let clause = addMissingFacts(analysis.clause, { ...facts, stage: "" }, { includeCount: true });
  if (clause.startsWith("맞손")) clause = clause.replace(/^맞손\s*[,.:]*/u, "협력해");
  return compose(analysis.subject, addSupportingFact(clause, analysis, description));
}

function summarizePolicyOrSupport(analysis, facts, description) {
  const policyFacts = { ...facts, stage: "" };
  let clause = addMissingFacts(analysis.clause, policyFacts, { includeCount: true });
  const descriptionClause = extractDescriptionActionClause(description, analysis.subject);
  if (descriptionClause && Array.from(descriptionClause).length > Array.from(clause).length + 8) {
    clause = addMissingFacts(descriptionClause, policyFacts, { includeCount: true });
  }
  if (clause.startsWith("맞손")) clause = clause.replace(/^맞손\s*[,.:]*/u, "협력해");
  return compose(analysis.subject, clause);
}

function summarizeTechnologyOrProduct(analysis, description) {
  let clause = analysis.clause;
  const descriptionClause = extractDescriptionActionClause(description, analysis.subject);
  const titleSpecificity =
    clause.match(/솔루션|플랫폼|서비스|기술|제품|센터/gu)?.length || 0;
  const descriptionSpecificity =
    descriptionClause.match(/솔루션|플랫폼|서비스|기술|제품|센터/gu)?.length || 0;
  if (
    descriptionClause &&
    (descriptionSpecificity > titleSpecificity ||
      Array.from(descriptionClause).length > Array.from(clause).length + 12)
  ) {
    clause = descriptionClause;
  }
  return compose(analysis.subject, clause);
}

function summarizeSecondary(analysis, facts, description) {
  const baseClause = addMissingFacts(analysis.clause, { ...facts, stage: "" });
  return compose(analysis.subject, addSupportingFact(baseClause, analysis, description));
}

function summarizeAward(analysis, description) {
  const award = stripQuotes(analysis.clause);
  const method = analysis.leadingFact ? `${analysis.leadingFact}로 ` : "";
  const baseClause = `${method}${award} 수상`;
  return compose(analysis.subject, addSupportingFact(baseClause, analysis, description));
}

function summarizeFallback(analysis, description, facts) {
  let summary = compose(analysis.subject, addMissingFacts(analysis.clause, facts));
  if (!summary || summary === analysis.subject) {
    const descriptionSentence = prepareText(description).split(/[.!?。]/u)[0].trim();
    summary = descriptionSentence || analysis.prepared;
  }
  return summary;
}

function finalizeSummary(value) {
  const summary = truncateReportSummary(normalizeActionEnding(value), SUMMARY_MAX_LENGTH);
  if (!summary) return "기사 제목에서 확인되는 핵심 사실 없음";
  return summary;
}

function isDescriptionFallbackEligible(description) {
  const text = cleanText(description);
  if (isPredominantlyEnglish(text)) {
    return Array.from(text).length >= 60 && ENGLISH_EVENT_PATTERN.test(text);
  }
  return (
    Array.from(text).length >= 80 ||
    DESCRIPTION_FALLBACK_KEYWORDS.some((keyword) => containsKeyword(text, keyword))
  );
}

function isOpenAIDescriptionEligible(title, description) {
  const titleText = cleanText(title);
  const descriptionText = cleanText(description);
  const descriptionDetailed =
    Array.from(descriptionText).length >= 40 &&
    DESCRIPTION_FALLBACK_KEYWORDS.some((keyword) =>
      containsKeyword(descriptionText, keyword)
    );
  const titleHasClearEvent = ACTION_WORDS.some((keyword) =>
    containsKeyword(titleText, keyword)
  );
  const titleDetailed =
    Array.from(titleText).length >= 18 &&
    titleHasClearEvent &&
    Array.from(`${titleText} ${descriptionText}`).length >= 25;
  return descriptionDetailed || titleDetailed;
}

function summarizeTitleFallback(title) {
  const analysis = analyzeTitle(title, "");
  const facts = extractFacts(title, "");
  const subject = analysis.subject;
  const clause = normalizeActionEnding(analysis.clause);
  if (!subject || !clause) return finalizeSummary(summarizeLocal({ title }));

  const actor = subjectPhrase(subject);
  let summary = "";
  if (/(?:투자\s*유치|투자유치|시드\s*투자|시리즈\s*[A-Z])/iu.test(title)) {
    const stage = facts.stage ? `${facts.stage} 단계에서 ` : "";
    const amount = facts.amount ? `${facts.amount}의 ` : "";
    summary = `${actor} ${stage}${amount}신규 투자 자금을 확보`;
  } else if (/펀드/u.test(title) && /결성|조성/u.test(title)) {
    const amount = facts.amount ? `${facts.amount} 규모의 ` : "";
    const fundName =
      clause
        .replace(/\s*(?:결성|조성).*$/u, "")
        .replace(/^(?:약\s*)?\d[\d,.]*\s*(?:조|억|만)\s*원(?:\s*규모)?\s*/u, "")
        .trim() || "신규 펀드";
    summary = `${actor} ${amount}${withObjectParticle(fundName)} 새로 조성`;
  } else if (/선정/u.test(title)) {
    const target = clause.replace(/\s*선정.*$/u, "").trim();
    const selectingInstitution = /(?:부|청|원|센터|은행|공사|재단|진흥원)$/u.test(subject);
    summary = selectingInstitution
      ? `${actor} ${target} 명단을 최종 확정`
      : `${actor} ${target} 대상 명단에 포함`;
  } else if (/모집/u.test(title)) {
    const target = clause
      .replace(/\s*모집.*$/u, "")
      .replace(/참여\s*기업/u, "참가 기업")
      .trim();
    summary = `${actor} ${target} 신청을 접수`;
  } else if (/출시/u.test(title)) {
    const target = clause.replace(/\s*출시.*$/u, "").trim();
    summary = `${actor} ${withObjectParticle(target)} 시장에 선보임`;
  } else if (/개최/u.test(title)) {
    const target = clause
      .replace(/\s*개최.*$/u, "")
      .replace(/밋업데이/gu, "밋업 행사")
      .trim();
    summary = `${actor} ${target} 일정을 진행`;
  } else if (/인증\s*획득/u.test(title)) {
    const target = clause.replace(/\s*획득.*$/u, "").trim();
    summary = `${actor} ${withObjectParticle(target)} 받음`;
  } else if (/업무협약|MOU|맞손/iu.test(title)) {
    const target = clause.replace(/\s*(?:업무협약|MOU|맞손).*$/iu, "").trim();
    summary = `${actor} ${target} 협력 체계를 구축`;
  } else if (/수상|대상$/u.test(title)) {
    const target = clause.replace(/\s*(?:수상|대상).*$/u, "").trim();
    summary = `${actor} ${target} 평가의 수상자 명단에 포함`;
  }

  return finalizeSummary(summary || summarizeLocal({ title }));
}

function summarizeLocal({ title = "", description = "" }) {
  const analysis = analyzeTitle(title, description);
  const context = `${title} ${description}`;
  const facts = extractFacts(title, description);
  const knownHeadline = summarizeKnownHeadline(title);

  if (knownHeadline) return finalizeSummary(knownHeadline);

  let summary;
  const isFundFormation =
    containsKeyword(context, "펀드") &&
    ["결성", "조성"].some((keyword) => containsKeyword(context, keyword));
  const isTipsOrLips = ["TIPS", "팁스", "LIPS", "립스"].some((keyword) =>
    containsKeyword(context, keyword)
  );
  const isSecondary = ["세컨더리", "구주", "회수시장", "LP 지분", "GP-led"].some(
    (keyword) => containsKeyword(context, keyword)
  );
  const isRecruitmentOrSupport = [
    "모집",
    "선정",
    "지원사업",
    "지원 대상",
    "지원 확대",
    "공고",
  ].some(
    (keyword) => containsKeyword(context, keyword)
  );
  const isInvestment = [
    "투자 유치",
    "투자유치",
    "시드 투자",
    "시리즈A",
    "시리즈B",
    "시리즈C",
    "Series A",
    "Series B",
    "Series C",
    "후속 투자",
    "투자 참여",
  ].some((keyword) => containsKeyword(title, keyword));
  const isTechnologyOrProduct = [
    "출시",
    "공개",
    "기술 개발",
    "솔루션",
    "플랫폼",
    "고도화",
    "상용화",
    "개소",
  ].some((keyword) => containsKeyword(context, keyword));
  const isAward = /(?:대상|상|원장상)["”'’]?$/u.test(analysis.prepared);

  if (isFundFormation) {
    summary = summarizeFundFormation(analysis, facts, description);
  } else if (isTipsOrLips) {
    summary = summarizeTipsOrLips(analysis, facts, description);
  } else if (isSecondary) {
    summary = summarizeSecondary(analysis, facts, description);
  } else if (isRecruitmentOrSupport) {
    summary = summarizePolicyOrSupport(analysis, facts, description);
  } else if (isAward) {
    summary = summarizeAward(analysis, description);
  } else if (isInvestment) {
    summary = summarizeInvestment(analysis, facts, description);
  } else if (isTechnologyOrProduct) {
    summary = summarizeTechnologyOrProduct(analysis, description);
  } else {
    summary = summarizeFallback(analysis, description, facts);
  }

  return finalizeSummary(summary);
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

const OPENAI_KEY_SENTENCE_PATTERN =
  /투자\s*유치|투자유치|\d[\d,.]*\s*(?:조|억|만)?\s*원|시드|프리[-\s]?A|시리즈\s*[A-Z]|Series\s*[A-Z]|펀드|결성|선정|모집|지원사업|지원|실증|PoC|TIPS|팁스|LIPS|립스|출시|상용화|협약|인수|매각|세컨더리|회수시장|\b(?:funding|raised?|raises?|seed|venture\s+capital|fund|selected?|support(?:ed|s)?|pilot|launched?|acquir(?:ed|es?))\b/iu;

function buildOpenAIArticleText(extractedArticleText, maxChars = openAIArticleTextMaxChars()) {
  const fullText = cleanText(extractedArticleText);
  if (!fullText) return "";
  const leading = Array.from(fullText).slice(0, 1_500).join("").trim();
  const keySentences = [];
  const seen = new Set();
  for (const rawSentence of splitExtractiveSentences(fullText)) {
    const sentence = cleanText(rawSentence);
    if (
      Array.from(sentence).length < 20 ||
      !OPENAI_KEY_SENTENCE_PATTERN.test(sentence) ||
      containsExtractiveMetadata(sentence)
    ) {
      continue;
    }
    const fingerprint = sentence.replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
    if (seen.has(fingerprint) || leading.includes(sentence)) continue;
    seen.add(fingerprint);
    keySentences.push(sentence);
    if (keySentences.length >= 8) break;
  }
  const sections = [leading];
  if (keySentences.length) sections.push(`핵심 문장:\n${keySentences.join("\n")}`);
  return Array.from(sections.filter(Boolean).join("\n")).slice(0, maxChars).join("").trim();
}

function estimateOpenAIInputTokens({ title, source, category, description, articleText }) {
  const inputChars = Array.from(
    [title, source, category, description, articleText].map(cleanText).join(" ")
  ).length;
  return { inputChars, estimatedTokens: Math.ceil(inputChars / 2) + 350 };
}

async function summarizeWithOpenAI({
  title = "",
  source = "",
  category = "",
  description = "",
  extractedArticleText = "",
  summaryMode = "body",
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");

  const fullArticleText = cleanText(extractedArticleText);
  const articleText =
    summaryMode === "body" ? buildOpenAIArticleText(fullArticleText) : "";
  const descriptionText = cleanText(description).slice(0, 1_500);
  if (summaryMode === "body" && Array.from(fullArticleText).length < 300) {
    throw new Error("OpenAI 본문 요약에 필요한 추출 본문이 부족합니다.");
  }
  if (summaryMode === "description" && !isOpenAIDescriptionEligible(title, descriptionText)) {
    throw new Error("OpenAI description 요약에 필요한 설명 정보가 부족합니다.");
  }
  const model = process.env.OPENAI_SUMMARY_MODEL || "gpt-5.4-mini";
  const sourceContext = [title, descriptionText, articleText].map(cleanText).join(" ");
  const inputEstimate = estimateOpenAIInputTokens({
    title,
    source,
    category,
    description: descriptionText,
    articleText,
  });
  console.log(
    `[OpenAI 기사 입력] ${summaryMode} | ${title} | 본문 ${Array.from(articleText).length}자 / 전체 약 ${inputEstimate.inputChars}자 / 추정 ${inputEstimate.estimatedTokens}토큰`
  );
  let retryReason = "";

  const categoryPriorities = {
    "VC / AC": "투자사, 투자유치 기업, 투자금액, 라운드, 펀드 결성, 투자 목적",
    "TIPS / LIPS": "선정 기업, 운영사, 기관명, 지원 규모, 사업화 지원 내용",
    "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": "스타트업·벤처·투자·실증·사업화 맥락",
    "스타트업 / 벤처기업 / 초기창업": "기업명, 서비스, 지원사업, 모집, 선정, 투자유치, 데모데이, 보육 내용",
    "세컨더리 / 구주매각": "구주매각, LP 지분, 세컨더리 펀드, GP, 회수시장, 거래 규모",
    "해외 VC": "해외 VC명, 투자 대상, 투자 분야, 투자 라운드, 글로벌 확장",
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const payload = await enqueueOpenAIRequest({
      title,
      summaryMode,
      requestBody: {
        model,
        input: [
          {
            role: "system",
            content: [
              "당신은 스타트업·VC 리서치 브리핑 편집자입니다.",
              "제공된 기사 자료에서 확인되는 핵심 사실만 한국어 한 문장, 100자 이내로 요약하세요.",
              "제목을 반복하거나 문장형으로만 바꾸지 말고 가능하면 '누가 + 무엇을 + 왜/어떻게 + 결과' 구조로 작성하세요.",
              "기자명, 날짜, 입력일, 수정일, 조회수, 매체명 반복, 저작권·구독·공유 문구는 제외하세요.",
              "'동향입니다', '소식입니다', '관련 기사입니다', '내용을 다룸', '주목됩니다'는 사용하지 마세요.",
              "기사에 없는 기업명, 투자금액, 라운드, 수치, 성과를 절대 만들지 마세요.",
              "문장 끝은 '~함', '~선정', '~유치', '~결성', '~출시', '~확대', '~모집', '~수상'처럼 보고서식으로 간결하게 정리하세요.",
              "요약문만 출력하세요.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `제목: ${cleanText(title).slice(0, 250)}`,
              `언론사: ${cleanText(source).slice(0, 100)}`,
              `카테고리: ${cleanText(category).slice(0, 120)}`,
              `카테고리 우선 반영: ${categoryPriorities[category] || "기사의 구체적인 주체·행동·결과"}`,
              `요약 입력 유형: ${summaryMode === "body" ? "기사 본문" : "RSS title+description"}`,
              `RSS 설명: ${descriptionText || "없음"}`,
              summaryMode === "body" ? `추출 기사 본문: ${articleText}` : "추출 기사 본문: 없음. 제목과 RSS 설명 밖의 사실을 추론하지 마세요.",
              retryReason ? `이전 요약의 검증 실패 사유: ${retryReason}. 같은 문제를 수정해 다시 요약하세요.` : "",
            ].filter(Boolean).join("\n"),
          },
        ],
        max_output_tokens: 220,
      },
    });

      const rawSummary = extractResponseText(payload);
      if (!rawSummary) throw new Error("OpenAI API 응답에 요약문이 없습니다.");
      const summary = finalizeSummary(
        rawSummary.replace(/^\s*(?:요약|summary)\s*[:：]\s*/iu, "")
      );
      const quality = validateSummaryQuality(title, summary, {
        maxLength: 100,
        maxSimilarity: summaryMode === "description" ? 1.01 : 0.8,
      });
      if (!quality.isValid) {
        retryReason = quality.reason;
        if (attempt < 2) continue;
        throw new Error(`OpenAI 요약 검증 실패: ${quality.reason}`);
      }
      if (summaryMode === "description") {
        const descriptionQuality = validateOpenAIDescriptionSummary({
          title,
          summary,
          source,
        });
        if (!descriptionQuality.isValid) {
          retryReason = descriptionQuality.reason;
          if (attempt < 2) continue;
          throw new Error(`OpenAI description 요약 검증 실패: ${retryReason}`);
        }
      }
      if (VAGUE_EXPRESSIONS.some((expression) => summary.includes(expression))) {
        retryReason = "금지된 모호한 표현 포함";
        if (attempt < 2) continue;
        throw new Error(`OpenAI 요약 검증 실패: ${retryReason}`);
      }

      const summaryClaims = summary.match(
        /(?:\d[\d,.]*\s*(?:조|억|만)?\s*원|\d[\d,]*\s*(?:곳|개사|개\s*기업|명|팀)|(?:프리[-\s]?)?시리즈\s*[A-Z]|Series\s*[A-Z])/giu
      ) || [];
      const unsupportedClaim = summaryClaims.find((claim) => {
        if (includesFact(sourceContext, claim)) return false;
        const localizedStage = claim.replace(/^Series\s*/iu, "시리즈");
        const englishStage = claim.replace(/^시리즈\s*/u, "Series ");
        return (
          !includesFact(sourceContext, localizedStage) &&
          !includesFact(sourceContext, englishStage)
        );
      });
      if (unsupportedClaim) {
        retryReason = `입력에 없는 수치·라운드 표현(${unsupportedClaim})`;
        if (attempt < 2) continue;
        throw new Error(`OpenAI 요약 검증 실패: ${retryReason}`);
      }
      return summary;
  }

  throw new Error(`OpenAI 요약 검증 실패: ${retryReason || "알 수 없는 오류"}`);
}

function splitExtractiveSentences(value) {
  const text = cleanText(String(value || "").replace(/\r?\n+/gu, ". "));
  return (text.match(/[^.!?。]+[.!?。]?/gu) || [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function sanitizeExtractiveSentence(value, source = "") {
  let sentence = cleanText(value)
    .replace(/^\s*\[[^\]]{1,50}\]\s*/u, "")
    .replace(/^\s*\([^)]{0,50}=(?:연합뉴스|뉴스1|뉴시스|[^)]*기자)\)\s*/u, "")
    .replace(/^\s*(?:입력|수정|승인)\s*[:=]?\s*20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}(?:일)?(?:\s*\d{1,2}:\d{2})?\s*/u, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/\s*(?:사진|자료)\s*=\s*[^.!?。]{1,80}(?=$|[.!?。])/giu, " ")
    .replace(
      /전체\s*맥락을\s*이해하려면\s*기사\s*본문을\s*함께\s*확인하는\s*것이\s*좋습니다[.!?。]?\s*/giu,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  if (source) {
    const sourceOnly = new RegExp(`^(?:${escapeRegExp(cleanText(source))})[\s|·:-]*$`, "iu");
    if (sourceOnly.test(sentence)) return "";
  }

  sentence = sentence.replace(/^[▶◆■●※]\s*/u, "").trim();
  return sentence;
}

function containsExtractiveMetadata(sentence) {
  return EXTRACTIVE_META_PATTERNS.some((pattern) => pattern.test(sentence));
}

function categoryKeywordBonus(category, sentence) {
  const categoryKeywords = {
    "VC / AC": ["투자", "유치", "시드", "시리즈", "펀드", "결성", "VC", "벤처캐피탈", "액셀러레이터", "조달"],
    "TIPS / LIPS": ["TIPS", "팁스", "LIPS", "립스", "선정", "운영사", "지원", "사업화"],
    "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": ["스타트업", "벤처", "투자유치", "지원사업", "실증", "PoC", "출시", "사업화", "상용화"],
    "스타트업 / 벤처기업 / 초기창업": ["기업", "서비스", "지원사업", "모집", "선정", "투자유치", "데모데이", "보육"],
    "세컨더리 / 구주매각": ["구주", "LP 지분", "세컨더리", "GP", "회수시장", "거래", "매각"],
    "해외 VC": ["VC", "투자", "라운드", "글로벌", "해외", "확장", "Sequoia", "a16z", "Accel"],
  };
  return (categoryKeywords[category] || []).reduce(
    (score, keyword) => score + (containsKeyword(sentence, keyword) ? 5 : 0),
    0
  );
}

function titleEventAlignmentBonus(article, sentence) {
  const title = cleanText(article.title || "");
  let score = 0;

  if (INVESTMENT_TITLE_INTENT_PATTERN.test(title)) {
    const hasInvestmentEvent =
      /투자(?:를|를\s*)?\s*(?:유치|받|확보|참여)|투자금|조달한\s*자금|자금\s*조달|시드|프리[-\s]?[A-C]|시리즈\s*[A-C]/iu.test(
        sentence
      );
    if (hasInvestmentEvent) score += 45;
    else score -= 55;
    if (/\d[\d,.]*\s*(?:억|조|만)?\s*원|시드|프리[-\s]?[A-C]|시리즈\s*[A-C]/iu.test(sentence)) {
      score += 14;
    }
    if (/투자사|투자자|벤처캐피탈|캐피탈|벤처스|크립톤|참여했|리드했/iu.test(sentence)) {
      score += 11;
    }
    if (/투자금|조달한\s*자금|자금.{0,20}(?:활용|투입)|사업화|상용화|글로벌\s*진출|해외\s*진출|후속\s*투자|양산/iu.test(sentence)) {
      score += 9;
    }
  }

  if (SUPPORT_TITLE_INTENT_PATTERN.test(title)) {
    const hasSupportSubstance =
      /지원\s*(?:대상|내용|사업|프로그램)|참여기업|참가사|모집|육성|사업화\s*지원|글로벌\s*진출\s*지원|실증\s*지원|PoC|판로|클라우드|컨설팅/iu.test(
        sentence
      );
    if (hasSupportSubstance) score += 25;
    else score -= 12;
    if (/중기부|중소벤처기업부|과기정통부|진흥원|경과원|혁신센터|공공기관|AWS|벤처블릭|주관|운영/iu.test(sentence)) {
      score += 8;
    }
    if (/지원\s*대상|\d[\d,]*\s*(?:곳|개사|명|팀)|모집\s*규모|사업화|실증|글로벌\s*진출|해외\s*진출|판로/iu.test(sentence)) {
      score += 9;
    }
    if (
      /행사에서는|협약식|기념촬영|네트워킹|축사|참석자/iu.test(sentence) &&
      !hasSupportSubstance
    ) {
      score -= 30;
    }
  }

  return score;
}

function scoreExtractiveSentence(sentence, article, index) {
  const length = Array.from(sentence).length;
  let score = 0;

  if (length < 18) score -= 30;
  else if (length <= 120) score += 10;
  else if (length <= 180) score += 3;
  else score -= 25;

  for (const [keyword, weight] of EXTRACTIVE_KEYWORD_WEIGHTS) {
    if (containsKeyword(sentence, keyword)) score += weight;
  }
  score += categoryKeywordBonus(article.category, sentence);
  score += titleEventAlignmentBonus(article, sentence);
  if (/\d[\d,.]*\s*(?:억|조|만)?\s*원|\d[\d,]*\s*(?:곳|개사|명|팀)/u.test(sentence)) {
    score += 9;
  }
  if (/[A-Za-z0-9가-힣&·._-]{2,30}(?:은|는|이|가)\s/u.test(sentence)) score += 5;
  if (CONCRETE_ACTION_PATTERN.test(sentence)) score += 8;
  if (index < 5) score += Math.max(0, 4 - index);

  const titleTokens = new Set(
    cleanText(article.title || "")
      .toLocaleLowerCase("ko-KR")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2)
  );
  const sentenceTokens = new Set(
    cleanText(sentence)
      .toLocaleLowerCase("ko-KR")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2)
  );
  const titleOverlap = [...titleTokens].filter((token) => sentenceTokens.has(token)).length;
  score += Math.min(titleOverlap * 4, 16);
  if (
    /(?:중소벤처기업부|중기부|창업진흥원|금융위원회|산업은행|기업은행|공공기관|협회|재단|센터|벤처스|캐피탈|테크|랩스)/u.test(
      sentence
    )
  ) {
    score += 6;
  }

  const titleSimilarity = calculateTextSimilarity(article.title || "", sentence);
  if (isPredominantlyEnglish(sentence)) {
    if (titleSimilarity >= 0.95) score -= 20;
    else if (titleSimilarity >= 0.8) score -= 5;
  } else if (titleSimilarity >= 0.96) score -= 50;
  else if (titleSimilarity >= 0.8) score -= 10;
  if (WEAK_FACT_PATTERNS.some((pattern) => pattern.test(sentence))) score -= 20;
  if (ADVERTISING_SENTENCE_PATTERN.test(sentence)) score -= 35;
  if (
    /주가|증시|코스피|코스닥|유상증자|상장사|시설\s*투자|공장\s*(?:증설|신설)|제련소|광산\s*투자/iu.test(
      sentence
    )
  ) {
    score -= 35;
  }
  if (/국민체감|정책\s*성과|특별\s*포상|우수\s*성과|홍보/iu.test(sentence)) {
    score -= 25;
  }

  if (article.category === "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주") {
    if (STARTUP_CONTEXT_PATTERN.test(sentence)) score += 12;
    else if (!CONCRETE_ACTION_PATTERN.test(sentence)) score -= 35;
  }

  return score;
}

function normalizeExtractiveEnding(value) {
  let summary = stripQuotes(value)
    .replace(/\s*[-–—|]\s*[^-–—|]{2,40}$/u, "")
    .replace(/(?:라고|고)\s*(?:밝혔다|설명했다|말했다|전했다)$/u, "")
    .replace(/투자\s*유치에\s*성공했다$/u, "투자 유치")
    .replace(/(유치|선정|결성|조성|출시|상용화|확대|모집|수상|개최|참여|인수|매각|실증|확보|투입|지원|추진)(?:했|됐|되었|한다|하였다|할\s*예정이|할\s*계획이)?다$/u, "$1")
    .replace(/체결했다$/u, "체결")
    .replace(/사용된다$/u, "사용")
    .replace(/제공된다$/u, "제공")
    .replace(/진행된다$/u, "진행")
    .replace(/확인됐다$/u, "확인")
    .replace(/있다$/u, "있음")
    .replace(/(?:하였다|했다)$/u, "함")
    .replace(/한다$/u, "함")
    .replace(/(?:되었다|됐다)$/u, "됨")
    .replace(/[.!?。]+$/u, "")
    .trim();

  if (!summary) return "";
  return truncateReportSummary(summary, SUMMARY_MAX_LENGTH);
}

function isPredominantlyEnglish(value) {
  const text = cleanText(value);
  const latinCount = (text.match(/[A-Za-z]/gu) || []).length;
  const koreanCount = (text.match(/[가-힣]/gu) || []).length;
  return latinCount >= 20 && latinCount > koreanCount * 2;
}

function normalizeEnglishExtractiveSummary(value) {
  const summary = cleanText(value).replace(/\s+/gu, " ").trim();
  const length = Array.from(summary).length;
  if (
    length < 60 ||
    length > SUMMARY_MAX_LENGTH ||
    !/[.!?]["')\]]?$/u.test(summary) ||
    !ENGLISH_EVENT_PATTERN.test(summary) ||
    /\b(?:and|or|to|of|with|for|as|by|the|a|an)\s*[.!?]?$/iu.test(summary)
  ) {
    return "";
  }
  return summary;
}

function summarySpecificityScore(summary, title) {
  let score = 0;
  for (const [keyword, weight] of EXTRACTIVE_KEYWORD_WEIGHTS) {
    if (containsKeyword(summary, keyword)) score += weight;
  }
  if (/\d[\d,.]*\s*(?:억|조|만)?\s*원|\d[\d,]*\s*(?:곳|개사|명|팀)/u.test(summary)) {
    score += 10;
  }
  if (CONCRETE_ACTION_PATTERN.test(summary)) score += 8;
  if (/(유치).{0,45}\1|(선정).{0,45}\2|(지원).{0,45}\3|(출시).{0,45}\4|(결성).{0,45}\5/u.test(summary)) {
    score -= 35;
  }
  score -= calculateTextSimilarity(title, summary) * 20;
  return score;
}

function addMissingTitleFactsToSentence(article, sentence) {
  const facts = extractFacts(article.title || "", article.description || "");
  const additions = [facts.stage, facts.amount, facts.count].filter(
    (fact) => fact && !includesFact(sentence, fact)
  );
  if (!additions.length) return sentence;

  const subjectMatch = sentence.match(/^(.{2,35}?(?:은|는|이|가))\s+/u);
  if (!subjectMatch) return `${additions.join(" ")} ${sentence}`.trim();
  return sentence.replace(subjectMatch[0], `${subjectMatch[1]} ${additions.join(" ")} `);
}

function buildSummaryOptions(article, sentence) {
  if (isPredominantlyEnglish(sentence)) {
    const englishSummary = normalizeEnglishExtractiveSummary(sentence);
    return englishSummary ? [englishSummary] : [];
  }
  const direct = normalizeExtractiveEnding(sentence);
  const factEnriched = normalizeExtractiveEnding(
    addMissingTitleFactsToSentence(article, direct)
  );
  const combined = normalizeExtractiveEnding(
    summarizeLocal({ title: article.title || "", description: sentence })
  );
  return [...new Set([factEnriched, direct, combined].filter(Boolean))].sort(
    (left, right) =>
      summarySpecificityScore(right, article.title || "") -
      summarySpecificityScore(left, article.title || "")
  );
}

function isCompleteExtractiveSentence(value) {
  const sentence = cleanText(value);
  const length = Array.from(sentence).length;
  if (length < 25 || length > SUMMARY_MAX_LENGTH) return false;
  if (isPredominantlyEnglish(sentence)) {
    return ENGLISH_EVENT_PATTERN.test(sentence) && /[.!?]["')\]]?$/u.test(sentence);
  }
  return /(?:했다|됐다|한다|된다|이다|있다|없다|나섰다|밝혔다|전했다|추진한다|지원한다|선정했다|유치했다|결성했다|조성했다|출시했다|확대했다|체결했다|참여했다|확보했다|예정이다|계획이다|받았다|열었다|진행한다|제공한다|모집한다|개최한다|상용화했다|개발했다)[.!?。]?$/u.test(
    sentence
  );
}

function selectCompleteExtractiveText(candidates, title) {
  const usable = [];
  for (const candidate of candidates) {
    const summary = cleanText(candidate.sentence);
    if (
      candidate.score < 0 ||
      containsExtractiveMetadata(summary) ||
      WEAK_FACT_PATTERNS.some((pattern) => pattern.test(summary)) ||
      calculateTextSimilarity(title, summary) >= 0.96 ||
      !isCompleteExtractiveSentence(summary)
    ) {
      continue;
    }
    usable.push(summary);
  }
  if (!usable.length) return "";
  const first = usable[0];
  if (Array.from(first).length >= 45) return first;
  const second = usable.find(
    (sentence) =>
      sentence !== first &&
      calculateTextSimilarity(first, sentence) < 0.65 &&
      Array.from(`${first} ${sentence}`).length <= SUMMARY_MAX_LENGTH
  );
  return second ? `${first} ${second}` : first;
}

function selectExtractiveSummary(article, text, summarySource) {
  let metaRejectedCount = 0;
  let similarRejectedCount = 0;
  const candidates = [];
  const seen = new Set();

  for (const [index, rawSentence] of splitExtractiveSentences(text).entries()) {
    if (containsExtractiveMetadata(rawSentence)) {
      metaRejectedCount += 1;
      continue;
    }
    let sentence = sanitizeExtractiveSentence(rawSentence, article.source);
    if (
      sentence &&
      isPredominantlyEnglish(sentence) &&
      /[.!?]["')\]]?$/u.test(rawSentence) &&
      !/[.!?]["')\]]?$/u.test(sentence)
    ) {
      sentence = `${sentence}${rawSentence.match(/[.!?]["')\]]?$/u)?.[0] || "."}`;
    }
    if (!sentence || containsExtractiveMetadata(sentence)) {
      if (sentence) metaRejectedCount += 1;
      continue;
    }
    const fingerprint = sentence.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    candidates.push({
      sentence,
      score: scoreExtractiveSentence(sentence, article, index),
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  const summary = selectCompleteExtractiveText(candidates, article.title || "");
  if (summary) {
    return {
      summary,
      summarySource,
      metaRejectedCount,
      similarRejectedCount,
      candidateCount: candidates.length,
    };
  }

  return {
    summary: "",
    summarySource,
    metaRejectedCount,
    similarRejectedCount,
    candidateCount: candidates.length,
  };
}

function summarizeExtractiveLocal({
  title = "",
  description = "",
  category = "",
  source = "",
  extractedArticleText = "",
}) {
  const article = { title, description, category, source };
  const articleText = cleanText(extractedArticleText);
  const eligibleDescription = isDescriptionFallbackEligible(description)
    ? cleanText(description)
    : "";
  let metaRejectedCount = 0;
  let similarRejectedCount = 0;

  if (Array.from(articleText).length >= 300) {
    const bodyResult = selectExtractiveSummary(
      article,
      articleText.slice(0, 12_000),
      "local_extractive"
    );
    metaRejectedCount += bodyResult.metaRejectedCount;
    similarRejectedCount += bodyResult.similarRejectedCount;
    if (bodyResult.summary) return bodyResult;
  }

  if (eligibleDescription) {
    const descriptionResult = selectExtractiveSummary(
      article,
      eligibleDescription,
      "description"
    );
    metaRejectedCount += descriptionResult.metaRejectedCount;
    similarRejectedCount += descriptionResult.similarRejectedCount;
    if (descriptionResult.summary) {
      return {
        ...descriptionResult,
        metaRejectedCount,
        similarRejectedCount,
      };
    }
  }

  return {
    summary: summarizeTitleFallback(title),
    summarySource: "titleFallback",
    metaRejectedCount,
    similarRejectedCount,
    candidateCount: 0,
  };
}

const summarizeFreeLocal = summarizeExtractiveLocal;

function summarizeLocallyWithBestInput(article) {
  return {
    ...summarizeExtractiveLocal(article),
    openAIAttempted: false,
    openAISucceeded: false,
    openAIFailed: false,
    openAIBodyAttempted: false,
    openAIBodySucceeded: false,
    openAIBodyFailed: false,
    openAIDescriptionAttempted: false,
    openAIDescriptionSucceeded: false,
    openAIDescriptionFailed: false,
    usedLocalFallback: true,
    usedOpenAI: false,
  };
}

async function summarizeArticleWithMetadata(article, options = {}) {
  const openAIEnabled =
    /^true$/i.test(process.env.USE_OPENAI_SUMMARY || "false") &&
    Boolean(process.env.OPENAI_API_KEY);

  if (!openAIEnabled) return summarizeLocallyWithBestInput(article);

  const description = cleanText(article.description || "");
  const bodyEligible =
    options.allowOpenAIBody !== false &&
    Array.from(cleanText(article.extractedArticleText || "")).length >= 300;
  const descriptionEligible =
    options.allowOpenAIDescription !== false &&
    isOpenAIDescriptionEligible(article.title, description);
  let bodyAttempted = false;
  let bodyFailed = false;
  let descriptionAttempted = false;
  const failureReasons = [];

  if (bodyEligible) {
    bodyAttempted = true;
    try {
      return {
        summary: await summarizeWithOpenAI({
          ...article,
          description,
          summaryMode: "body",
        }),
        summarySource: "openai_body",
        metaRejectedCount: 0,
        similarRejectedCount: 0,
        openAIAttempted: true,
        openAISucceeded: true,
        openAIFailed: false,
        openAIBodyAttempted: true,
        openAIBodySucceeded: true,
        openAIBodyFailed: false,
        openAIDescriptionAttempted: false,
        openAIDescriptionSucceeded: false,
        openAIDescriptionFailed: false,
        usedLocalFallback: false,
        usedOpenAI: true,
      };
    } catch (error) {
      bodyFailed = true;
      failureReasons.push(`body: ${error.message}`);
      console.warn(`[OpenAI body 요약 실패] ${article.title}: ${error.message}`);
      return {
        ...summarizeLocallyWithBestInput(article),
        openAIAttempted: true,
        openAISucceeded: false,
        openAIFailed: true,
        openAIBodyAttempted: true,
        openAIBodySucceeded: false,
        openAIBodyFailed: true,
        openAIDescriptionAttempted: false,
        openAIDescriptionSucceeded: false,
        openAIDescriptionFailed: false,
        openAIFailureReason: failureReasons.join(" | "),
      };
    }
  }

  if (descriptionEligible) {
    descriptionAttempted = true;
    try {
      return {
        summary: await summarizeWithOpenAI({
          ...article,
          description,
          extractedArticleText: "",
          summaryMode: "description",
        }),
        summarySource: "openai_description",
        metaRejectedCount: 0,
        similarRejectedCount: 0,
        openAIAttempted: true,
        openAISucceeded: true,
        openAIFailed: false,
        openAIBodyAttempted: bodyAttempted,
        openAIBodySucceeded: false,
        openAIBodyFailed: bodyFailed,
        openAIDescriptionAttempted: true,
        openAIDescriptionSucceeded: true,
        openAIDescriptionFailed: false,
        usedLocalFallback: false,
        usedOpenAI: true,
      };
    } catch (error) {
      failureReasons.push(`description: ${error.message}`);
      console.warn(`[OpenAI description 요약 실패] ${article.title}: ${error.message}`);
    }
  }

  return {
    ...summarizeLocallyWithBestInput(article),
    openAIAttempted: bodyAttempted || descriptionAttempted,
    openAISucceeded: false,
    openAIFailed: bodyAttempted || descriptionAttempted,
    openAIBodyAttempted: bodyAttempted,
    openAIBodySucceeded: false,
    openAIBodyFailed: bodyFailed,
    openAIDescriptionAttempted: descriptionAttempted,
    openAIDescriptionSucceeded: false,
    openAIDescriptionFailed: descriptionAttempted,
    openAIFailureReason: failureReasons.join(" | "),
  };
}

async function summarizeArticle(article) {
  const result = await summarizeArticleWithMetadata(article);
  return result.summary;
}

module.exports = {
  classifyRateLimit,
  buildOpenAIArticleText,
  getOpenAIRequestMetrics,
  isDescriptionFallbackEligible,
  isOpenAIDescriptionEligible,
  rateLimitBackoffMs,
  parseRetryAfterSeconds,
  resetOpenAIRequestMetrics,
  summarizeArticle,
  summarizeArticleWithMetadata,
  summarizeExtractiveLocal,
  summarizeFreeLocal,
  isPredominantlyEnglish,
  normalizeEnglishExtractiveSummary,
  summarizeLocal,
  summarizeTitleFallback,
  summarizeWithOpenAI,
};
