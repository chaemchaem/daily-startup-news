const fs = require("node:fs/promises");
const path = require("node:path");
const Parser = require("rss-parser");

const {
  allowedSources,
  categories,
  disabledSources,
  generalTechIndustryPatterns,
  sourceFeeds,
  startupGrowthContextKeywords,
  techCategoryName,
  techEcosystemKeywords,
  techStartupContextKeywords,
} = require("./sources");
const {
  extractArticle,
  extractConfiguredBodyHtml,
  isGoogleNewsUrl,
  isUrlAllowedByRobots,
  requestHtml,
} = require("./article-extractor");
const {
  getOpenAIRequestMetrics,
  isOpenAIDescriptionEligible,
  resetOpenAIRequestMetrics,
  summarizeArticleWithMetadata,
  summarizeFreeLocal,
  summarizeTitleFallback,
} = require("./summarize");
const {
  cleanText,
  containsKeyword,
  createArticleId,
  createDescriptionHash,
  createSummaryCacheKey,
  deduplicateArticles,
  deduplicateSummarizedItems,
  formatKstDate,
  formatKstIso,
  isAllowedSource,
  normalizeForMatch,
  parsePublishedDate,
  validateFallbackSummaryQuality,
  validateOpenAIDescriptionSummary,
  validateSummaryQuality,
} = require("./utils");

function createRssParser(timeout = 15_000) {
  return new Parser({
    timeout,
    headers: { "User-Agent": "DailyStartupVCBriefing/1.0 RSS Reader" },
    customFields: {
      item: [["source", "sourceInfo", { keepArray: true }]],
    },
  });
}

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_PATH = path.join(DATA_DIR, "news.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const DEBUG_DIR = path.join(DATA_DIR, "debug");
const ARCHIVE_INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");
const SUMMARY_CACHE_PATH = path.join(DATA_DIR, "summary-cache.json");
const SUMMARY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const SUMMARY_CACHE_MAX_ITEMS = 500;
const ADVERTISING_WORDS = ["광고", "이벤트", "할인", "무료체험", "구독 이벤트", "협찬"];
const STOCK_MARKET_NOISE_PATTERNS = [
  /(?:특징주|상한가|하한가|급등주|급락주|목표주가|투자의견)/iu,
  /(?:코스피|코스닥|나스닥).{0,20}(?:상승|하락|마감|출발)/iu,
  /(?:주가|증시|시가총액).{0,20}(?:전망|등락|급등|급락)/iu,
];
const EDITORIAL_PRIORITY_SIGNALS = [
  { name: "direct_funding", pattern: /투자\s*유치|투자유치|후속\s*투자|브릿지\s*투자|전략적\s*투자|\bfunding\b|\braises?\b|\braised\b/iu, title: 13, description: 7, body: 3 },
  { name: "funding_round", pattern: /(?:프리[-\s]?A|시리즈\s*[A-Z]|Series\s*[A-Z]|\bseed(?:\s+round)?\b|시드(?:\s*투자)?)/iu, title: 12, description: 6, body: 3 },
  { name: "fund_formation", pattern: /펀드\s*(?:결성|조성)|(?:first|final)\s+close|\bclose[sd]?\b|클로즈|출자사업|모태펀드|정책펀드/iu, title: 12, description: 6, body: 3 },
  { name: "tips_lips", pattern: /(?:스케일업\s*)?(?:TIPS|팁스)|LIPS|립스/iu, title: 12, description: 6, body: 3 },
  { name: "poc_validation", pattern: /\bPoC\b|실증(?:사업|지원|협약)?|기술\s*검증|규제\s*특례|샌드박스/iu, title: 10, description: 5, body: 3 },
  { name: "startup_support", pattern: /창업기업|스타트업\s*지원|사업화\s*지원|글로벌\s*진출\s*지원|판로\s*지원|액셀러레이팅|보육기업|입주기업|데모데이|\bIR\b|오픈이노베이션|민관협력/iu, title: 9, description: 5, body: 2 },
  { name: "startup_policy", pattern: /(?:정부|중기부|중소벤처기업부|창업진흥원|금융위원회|공공기관).{0,40}(?:창업|벤처|스타트업).{0,30}(?:정책|지원|사업|규제|세제|제도)/iu, title: 10, description: 5, body: 2 },
  { name: "vc_activity", pattern: /(?:벤처캐피탈|액셀러레이터|운용사|기관투자자|\bVC\b|\bAC\b).{0,30}(?:투자|출자|펀드|동향|자금)/iu, title: 9, description: 5, body: 2 },
  { name: "selection_recruitment", pattern: /(?:기업|운영사|스타트업|창업기업).{0,30}(?:선정|모집)|(?:선정|모집).{0,30}(?:기업|운영사|스타트업|창업기업)/iu, title: 8, description: 4, body: 2 },
  { name: "exit_financing_environment", pattern: /회수시장|자금\s*조달|IPO|M&A|인수합병|세컨더리|구주\s*매각|벤처투자\s*시장|창업\s*생태계/iu, title: 9, description: 5, body: 2 },
  { name: "startup_technology_business", pattern: /(?:AI|딥테크|반도체|로봇|바이오|우주항공|기후테크).{0,35}(?:스타트업|벤처기업|창업기업|사업화|실증)|(?:스타트업|벤처기업|창업기업).{0,35}(?:AI|딥테크|반도체|로봇|바이오|우주항공|기후테크)/iu, title: 8, description: 4, body: 2 },
  { name: "vc_actor", pattern: /벤처캐피탈|액셀러레이터|\bVC\b|\bAC\b/iu, title: 5, description: 3, body: 1 },
];
const BROAD_CANDIDATE_SIGNALS = [
  { name: "startup_actor", pattern: /스타트업|창업기업|벤처기업|초기기업|예비창업|창업자|\bstartups?\b|\bfounders?\b/iu },
  { name: "venture_investment", pattern: /벤처투자|벤처캐피탈|투자\s*유치|자금\s*조달|출자사업|모태펀드|정책펀드|벤처펀드|기관투자자|\bventure\s+capital\b|\bfunding\b/iu },
  { name: "startup_support", pattern: /창업\s*지원|지원사업|사업화\s*지원|판로\s*지원|글로벌\s*진출|액셀러레이팅|보육기업|입주기업|데모데이|오픈이노베이션|민관협력/iu },
  { name: "technology_validation", pattern: /\bPoC\b|실증|기술\s*검증|규제\s*특례|샌드박스|딥테크|AI|인공지능|반도체|로봇|바이오|우주항공|기후테크/iu },
  { name: "policy_regulation", pattern: /창업\s*정책|벤처\s*정책|규제|세제|제도\s*(?:개선|개편|변화)|정책\s*(?:변화|개편|지원)/iu },
  { name: "exit_market", pattern: /회수시장|세컨더리|구주|IPO|M&A|인수합병|엑시트|상장|매각/iu },
  { name: "investment_event", pattern: /투자|펀드|시드|프리[-\s]?A|시리즈\s*[A-Z]|\bseed\b|\bseries\b|\binvestment\b|\binvestors?\b/iu },
  { name: "support_policy_general", pattern: /지원|모집|선정|정책|협력|인프라/iu },
];
const ECOSYSTEM_LINK_PATTERN =
  /스타트업|창업|벤처|벤처투자|벤처기업|투자\s*유치|액셀러레이터|\bVC\b|\bAC\b|TIPS|팁스|LIPS|립스|모태펀드|벤처펀드|세컨더리|회수시장|오픈이노베이션|\bstartups?\b|\bventure\s+capital\b/iu;
const STARTUP_TARGET_PATTERN =
  /스타트업|창업기업|벤처기업|초기기업|비상장기업|예비창업|신생기업|보육기업|입주기업|\bstartups?\b|\bfounders?\b|\bearly-stage\s+compan(?:y|ies)\b/iu;
const VENTURE_ECOSYSTEM_PATTERN =
  /벤처투자|창업\s*생태계|모태펀드|벤처펀드|회수시장|세컨더리|TIPS|팁스|LIPS|립스|\bventure\s+capital\b/iu;
const INSTITUTIONAL_ACTOR_PATTERN =
  /벤처캐피탈|액셀러레이터|창업기획자|창업지원기관|창업진흥원|중소벤처기업부|중기부|혁신센터|공공기관|정부|금융위원회|금융위|산업은행|기업은행|신용보증기금|기술보증기금|운용사|기관투자자|\bVC\b|\bAC\b/iu;
const FINANCING_ACTION_PATTERN =
  /투자\s*유치|투자유치|시드|프리[-\s]?A|시리즈\s*[A-Z]|후속\s*투자|브릿지\s*투자|전략적\s*투자|자금\s*조달|출자|펀드\s*(?:결성|조성)|IPO|M&A|인수합병|구주|\bfunding\b|\braises?\b|\braised\b|\binvestment\b/iu;
const POLICY_SUPPORT_ACTION_PATTERN =
  /지원사업|창업\s*지원|사업화\s*지원|글로벌\s*진출\s*지원|판로\s*지원|모집|선정|정책|규제|세제|제도|규제\s*특례|샌드박스|액셀러레이팅|보육|인프라/iu;
const COLLABORATION_ACTION_PATTERN =
  /오픈이노베이션|\bPoC\b|실증|기술\s*검증|액셀러레이팅|투자\s*연계|민관협력|협업|협력/iu;
const PUBLIC_COMPANY_OR_LARGE_CORP_PATTERN =
  /코스피|코스닥|유가증권시장|상장사|상장기업|유상증자|시설\s*투자|공장\s*(?:증설|신설)|생산시설|제련소|광산\s*투자|삼성|현대|롯데|한화|포스코|에코프로|대기업|그룹사|(?:^|[^A-Za-z])(?:LG|SK)(?=$|[^A-Za-z])/u;
const LISTED_OR_LARGE_COMPANY_PATTERN =
  /코스피|코스닥|유가증권시장|상장사|상장기업|삼성|현대|롯데|한화|포스코|에코프로|대기업|그룹사|(?:^|[^A-Za-z])(?:LG|SK)(?=$|[^A-Za-z])/u;
const GENERAL_POLICY_ACHIEVEMENT_PATTERN =
  /국민체감|정책\s*성과|특별\s*포상|우수\s*성과|성과\s*\d+건|\d+만\s*돌파|\d+건\s*(?:선정|포상)/iu;
const INDUSTRIAL_CAPEX_PATTERN =
  /유상증자|시설\s*투자|공장\s*(?:증설|신설)|제련소|광산|설비\s*투자|생산능력\s*확대|배터리|ESS|니켈/iu;
const CURRENT_ECOSYSTEM_EVENT_PATTERN =
  /투자\s*유치|투자유치|시드|프리[-\s]?A|시리즈\s*[A-Z]|후속\s*투자|브릿지\s*투자|펀드\s*(?:결성|조성)|출자사업|모태펀드|벤처투자\s*시장|자금\s*조달|지원사업|창업\s*지원|사업화\s*지원|글로벌\s*진출\s*지원|선정|선발|확정|모집|육성|개소|개막|협력|협업|활성화|오픈이노베이션|\bPoC\b|실증|기술\s*검증|상용화|액셀러레이팅|데모데이|회수시장|세컨더리|구주\s*매각|\bfunding\b|\braises?\b|\braised\b/iu;
const VENTURE_MARKET_EVENT_PATTERN =
  /(?:벤처투자\s*시장|창업\s*생태계|회수시장|벤처기업\s*자금\s*조달).{0,35}(?:강세|회복|확대|증가|감소|위축|개선|개편|활성화|지속|변화)|(?:강세|회복|확대|증가|감소|위축|개선|개편|활성화|지속|변화).{0,35}(?:벤처투자\s*시장|창업\s*생태계|회수시장|벤처기업\s*자금\s*조달)/iu;
const TECH_STARTUP_BUSINESS_PATTERN =
  /(?:(?:AI|인공지능|딥테크|반도체|로봇|바이오|우주항공|항공우주|기후테크|농식품).{0,45}(?:스타트업|창업기업|벤처기업|초격차).{0,45}(?:사업화|실증|상용화|기술검증|R&D|연구개발|육성|지원|선정|선발|확정|투자\s*유치)|(?:스타트업|창업기업|벤처기업|초격차).{0,45}(?:AI|인공지능|딥테크|반도체|로봇|바이오|우주항공|항공우주|기후테크|농식품).{0,45}(?:사업화|실증|상용화|기술검증|R&D|연구개발|육성|지원|선정|선발|확정|투자\s*유치))/iu;
const HISTORICAL_VENTURE_ORIGIN_PATTERN =
  /(?:과거|당시|처음|초기|\d{4}년[^.!?。]{0,30})?\s*(?:직원\s*\d+명(?:의|으로)?\s*)?벤처기업으로\s*출발/iu;
const VC_CATEGORY_STRONG_PATTERN =
  /벤처캐피탈|\bVC\b|\bAC\b|액셀러레이터|창업기획자|투자\s*유치|벤처펀드|모태펀드|출자사업|벤처투자\s*(?:제도|정책|시장)|비상장(?:기업)?.{0,20}자금\s*조달|회수시장|세컨더리|구주|스타트업.{0,20}(?:M&A|IPO)|(?:M&A|IPO).{0,20}스타트업/iu;
const DIRECT_VENTURE_INVESTMENT_PATTERN =
  /투자\s*유치|투자유치|시드\s*(?:라운드|투자)|프리[-\s]?[A-C]|시리즈\s*[A-C]|Series\s*[A-C]|후속\s*투자|브릿지\s*투자|전략적\s*투자|벤처펀드\s*(?:결성|조성)|모태펀드\s*출자|LP\s*출자|\b(?:seed|funding|raised?|raises?)\b/iu;
const STARTUP_SUPPORT_CATEGORY_PATTERN =
  /(?:(?:스타트업|창업기업|벤처기업|초기기업).{0,55}(?:지원|육성|모집|프로그램|전용\s*기능|MOU|협약|실증|PoC|글로벌\s*진출)|(?:지원|육성|모집|프로그램|MOU|협약|실증|PoC|글로벌\s*진출).{0,55}(?:스타트업|창업기업|벤처기업|초기기업)|(?:경과원|진흥원|혁신센터|창업지원기관|공공기관).{0,45}(?:참여기업|창업기업).{0,30}(?:모집|지원|실증))/iu;
const EXPLICIT_STARTUP_PARTNERSHIP_SUPPORT_PATTERN =
  /(?:스타트업|창업기업|벤처기업).{0,50}(?:글로벌\s*진출|사업화|실증|PoC|판로).{0,35}(?:지원|협력).{0,30}(?:MOU|업무협약|협약|체결|맞손)|(?:MOU|업무협약|협약|체결|맞손).{0,55}(?:스타트업|창업기업|벤처기업).{0,40}(?:지원|글로벌\s*진출|사업화|실증|PoC|판로)/iu;
const INSTITUTIONAL_STARTUP_SUPPORT_PATTERN =
  /(?:중기부|중소벤처기업부|과기정통부|정부|공공기관|경과원|진흥원|혁신센터|창업지원기관|AWS|아마존웹서비스|클라우드\s*사업자|플랫폼\s*기업|대기업).{0,70}(?:스타트업|창업기업|벤처기업|참여기업).{0,45}(?:지원|육성|모집|실증|PoC|글로벌\s*진출|전용\s*기능|프로그램)/iu;
const STRONG_STARTUP_EVENT_PATTERNS = [
  /투자\s*유치|투자유치|\braises?\b|\braised\b|\bfunding\b/iu,
  /(?:프리[-\s]?A|시리즈\s*[A-Z]|Series\s*[A-Z]|\bseed(?:\s+round)?\b)/iu,
  /펀드\s*(?:결성|조성)|(?:first|final)\s+close|클로즈/iu,
  /(?:TIPS|팁스|LIPS|립스).{0,30}(?:선정|지원)|(?:선정|지원).{0,30}(?:TIPS|팁스|LIPS|립스)/iu,
  /(?:스타트업|창업기업|벤처기업).{0,35}(?:선정|모집|지원|실증|PoC|협약|오픈이노베이션)/iu,
  /(?:선정|모집|지원|실증|PoC|협약|오픈이노베이션).{0,35}(?:스타트업|창업기업|벤처기업)/iu,
  /(?:벤처캐피탈|액셀러레이터|\bVC\b|\bAC\b).{0,20}(?:투자|펀드|동향)/iu,
  /(?:정부|중기부|중소벤처기업부|창업진흥원).{0,30}(?:창업|벤처|스타트업).{0,20}(?:정책|지원|사업)/iu,
];
const LOW_VALUE_EDITORIAL_PATTERNS = [
  /\[(?:칼럼|기고|오피니언|전문가\s*기고)\]|(?:^|\s)(?:칼럼|기고|오피니언)(?:\s|$)/iu,
  /법률\s*(?:리터러시|상식|가이드|조언)|스타트업\s*(?:운영|경영)\s*(?:조언|가이드)/iu,
  /(?:창업자|스타트업).{0,20}(?:알아야\s*할|체크리스트|주의사항|성공하는\s*법)/iu,
  /\b(?:opinion|column|startup\s+advice|founder\s+advice|how\s+to|guide\s+for\s+(?:founders|startups))\b/iu,
];
const GENERAL_OUTLOOK_PATTERNS = [
  /(?:산업|시장|업황|기술).{0,20}(?:전망|동향|트렌드|분석)/iu,
  /(?:전망|동향|트렌드|분석).{0,20}(?:산업|시장|업황)/iu,
  /(?:시장\s*규모|산업\s*보고서|기술\s*소개|시장\s*리포트)/iu,
];
const LARGE_COMPANY_GENERAL_PATTERNS = [
  /(?:삼성|LG|SK|현대|롯데|한화|포스코|대기업|그룹).{0,35}(?:실적|매출|공급|신사업|사업\s*확대|설비\s*투자)/iu,
  /(?:실적|매출|공급|신사업|사업\s*확대|설비\s*투자).{0,35}(?:삼성|LG|SK|현대|롯데|한화|포스코|대기업|그룹)/iu,
];
const OVERSEAS_VC_REQUIRED_PATTERN =
  /\b(?:funding|raises?|raised|seed(?:\s+round)?|series(?:\s+[a-z])?|first\s+close|final\s+close|investment\s+round|invests?|invested|venture\s+capital|VC\s+fund)\b/iu;
const OVERSEAS_ADVICE_PATTERN =
  /\b(?:opinion|column|startup\s+advice|founder\s+advice|how\s+to|tips\s+for|guide\s+for)\b/iu;
const MIN_RELEVANCE_SCORE = 12;
const DEFAULT_MIN_DOMESTIC_ARTICLES = 8;
const DEFAULT_MIN_FINAL_ARTICLES = 10;
const DEFAULT_MAX_FINAL_ARTICLES = 15;
const DEFAULT_MAX_EXTRACTION_CANDIDATES = 30;
let urlNormalizationSampleLogged = false;

async function loadLocalEnvironment() {
  const envPath = path.join(__dirname, "..", ".env");
  try {
    const content = await fs.readFile(envPath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/u);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
    console.log("[환경 설정] 프로젝트 .env 값을 불러왔습니다.");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[환경 설정 경고] .env를 읽지 못했습니다: ${error.message}`);
    }
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function wait(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function summarizeArticleSafely(
  article,
  options = {},
  summarize = summarizeArticleWithMetadata
) {
  try {
    const result = await summarize(article, options);
    if (!result?.summary || !result?.summarySource) {
      throw new Error("summary_result_missing");
    }
    return result;
  } catch (error) {
    console.warn(
      `[기사 요약 오류] ${article.title}: ${error.message} | local_extractive 재시도`
    );
    const localResult = summarizeFreeLocal(article);
    return {
      ...localResult,
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
      summaryProcessingError: error.message,
    };
  }
}

function sourceStatsKey(feed) {
  return `${feed.name || feed.sourceName} (${feed.type})`;
}

function sourceUrl(feed) {
  return feed.feedUrl || feed.listUrl || feed.sitemapUrl || "";
}

function matchesAllowedUrl(url, feed) {
  if (!feed.allowedUrlPatterns?.length) return true;
  return feed.allowedUrlPatterns.some((pattern) => {
    try {
      return new RegExp(pattern, "iu").test(url);
    } catch {
      return false;
    }
  });
}

function decodeHtmlAttribute(value = "") {
  return cleanText(
    String(value)
      .replace(/&amp;/giu, "&")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'")
  );
}

function repairEncodedQuerySeparators(value) {
  let repaired = String(value || "").trim();
  const patterns = [
    /%252526amp%25253b/giu,
    /%2526amp%253b/giu,
    /%26amp%253b/giu,
    /%26amp%3b/giu,
    /%26amp;/giu,
    /&amp%253b/giu,
    /&amp%3b/giu,
    /&amp;/giu,
    /&#38;|&#x26;/giu,
  ];
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = repaired;
    for (const pattern of patterns) repaired = repaired.replace(pattern, "&");
    if (repaired === previous) break;
  }
  return repaired;
}

function normalizeCollectedUrl(value, baseUrl) {
  const repaired = repairEncodedQuerySeparators(decodeHtmlAttribute(value));
  if (!repaired || /(?:&|%26)amp(?:%3b|;)/iu.test(repaired)) return null;
  try {
    const url = new URL(repaired, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    const normalized = repairEncodedQuerySeparators(url.href);
    if (/(?:&|%26)amp(?:%3b|;)/iu.test(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function readHtmlAttribute(tag, name) {
  const match = String(tag).match(
    new RegExp(`${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "iu")
  );
  return decodeHtmlAttribute(match?.[1] || match?.[2] || "");
}

function absoluteSourceUrl(value, feed) {
  const before = String(value || "").trim();
  const normalized = normalizeCollectedUrl(
    before,
    feed.baseUrl || sourceUrl(feed)
  );
  if (
    normalized &&
    before !== normalized &&
    feed.sourceName === "창업진흥원" &&
    !urlNormalizationSampleLogged
  ) {
    urlNormalizationSampleLogged = true;
    console.log(`[창업진흥원 URL 정규화] 전: ${before} | 후: ${normalized}`);
  }
  return normalized;
}

function extractDateFromMarkup(markup, selectorList = "") {
  const text = String(markup || "");
  const configuredMetaValues = String(selectorList)
    .split(",")
    .map((selector) => selector.match(/meta\[(?:property|name)=["']([^"']+)["']\]/iu)?.[1])
    .filter(Boolean)
    .map((key) => metaContent(text, key));
  const candidates = [
    ...configuredMetaValues,
    metaContent(text, "article:published_time"),
    metaContent(text, "date"),
    ...[...text.matchAll(/["']datePublished["']\s*:\s*["']([^"']+)["']/giu)].map((match) => match[1]),
    ...[...text.matchAll(/(?:article:published_time|datePublished)[^>"']{0,80}["']([^"']+)["']/giu)].map((match) => match[1]),
    ...[...text.matchAll(/\bdatetime\s*=\s*["']([^"']+)["']/giu)].map((match) => match[1]),
    ...[...text.matchAll(/\b(20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}(?:일)?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)/gu)].map((match) => match[1]),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = parsePublishedDate(value);
    if (parsed) return parsed;
  }
  return null;
}

function metaContent(html, key) {
  const tags = String(html).match(/<meta\b[^>]*>/giu) || [];
  for (const tag of tags) {
    const field = readHtmlAttribute(tag, "property") || readHtmlAttribute(tag, "name");
    if (field.toLowerCase() === key.toLowerCase()) {
      return readHtmlAttribute(tag, "content");
    }
  }
  return "";
}

function titleFromArticleHtml(html, fallback = "", selectorList = "") {
  const configuredTitle = String(selectorList)
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector && !selector.startsWith("meta"))
    .map((selector) => cleanText(extractConfiguredBodyHtml(html, selector)))
    .find(Boolean);
  return cleanText(
    metaContent(html, "og:title") || configuredTitle ||
      String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1] || fallback
  );
}

function descriptionFromArticleHtml(html) {
  return cleanText(
    metaContent(html, "og:description") || metaContent(html, "description") || ""
  ).slice(0, 1_000);
}

function hasPotentialNewsKeyword(title) {
  return (
    BROAD_CANDIDATE_SIGNALS.some((signal) => signal.pattern.test(title)) ||
    Object.values(categories)
      .flat()
      .concat(startupGrowthContextKeywords)
      .some((keyword) => containsKeyword(title, keyword))
  );
}

function anchorMatchesSelector(openingTag, selectorList) {
  const selectors = String(selectorList || "a[href]").split(",").map((value) => value.trim());
  return selectors.some((selector) => {
    if (selector === "a" || selector === "a[href]") return true;
    const className = selector.match(/\.([\w-]+)/u)?.[1];
    const id = selector.match(/#([\w-]+)/u)?.[1];
    const classes = readHtmlAttribute(openingTag, "class").split(/\s+/u);
    return (!className || classes.includes(className)) &&
      (!id || readHtmlAttribute(openingTag, "id") === id);
  });
}

function extractListLinks(html, feed) {
  const anchors = [...String(html).matchAll(/<a\b[^>]*href\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/giu)];
  const links = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const openingTag = anchor[0].slice(0, anchor[0].indexOf(">") + 1);
    if (!anchorMatchesSelector(openingTag, feed.articleLinkSelector)) continue;
    const url = absoluteSourceUrl(anchor[1] || anchor[2], feed);
    if (!url || seen.has(url) || !matchesAllowedUrl(url, feed)) continue;
    const title = cleanText(
      readHtmlAttribute(openingTag, "aria-label") ||
        readHtmlAttribute(openingTag, "title") ||
        anchor[3]
    );
    if (Array.from(title).length < 8) continue;
    const start = Math.max(0, anchor.index - 500);
    const end = Math.min(String(html).length, anchor.index + anchor[0].length + 500);
    links.push({
      title,
      url,
      publishedAt: extractDateFromMarkup(
        String(html).slice(start, end),
        feed.dateSelector
      ),
    });
    seen.add(url);
    if (links.length >= feed.maxItems) break;
  }
  return links;
}

async function loadSummaryCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(SUMMARY_CACHE_PATH, "utf8"));
    const cutoff = Date.now() - SUMMARY_CACHE_MAX_AGE_MS;
    const originalEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const entries = originalEntries
      .filter((entry) => {
        const createdAt = new Date(entry?.createdAt).getTime();
        return (
          entry?.key &&
          entry?.summary &&
          ["openai_body", "openai_description"].includes(entry?.summarySource) &&
          Number.isFinite(createdAt) &&
          createdAt >= cutoff
        );
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, SUMMARY_CACHE_MAX_ITEMS);
    return {
      dirty: entries.length !== originalEntries.length,
      entries,
      byKey: new Map(entries.map((entry) => [entry.key, entry])),
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[OpenAI cache 읽기 실패] ${error.message}`);
    }
    return { dirty: false, entries: [], byKey: new Map() };
  }
}

function summaryCacheKeyForArticle(article, summarySource) {
  return createSummaryCacheKey({
    url: article.resolvedUrl || article.url,
    title: article.title,
    description: article.description,
    summarySource,
  });
}

function findCachedSummary(cache, article, summarySource) {
  const entry = cache.byKey.get(summaryCacheKeyForArticle(article, summarySource));
  if (!entry) return null;

  const commonQuality = validateSummaryQuality(article.title, entry.summary, {
    maxLength: summarySource === "openai_description" ? 120 : 100,
    maxSimilarity: summarySource === "openai_description" ? 1.01 : 0.8,
  });
  if (!commonQuality.isValid) return null;
  if (summarySource === "openai_description") {
    const descriptionQuality = validateOpenAIDescriptionSummary({
      title: article.title,
      summary: entry.summary,
      source: article.source,
    });
    if (!descriptionQuality.isValid) return null;
  }
  return entry;
}

function addSummaryCacheEntry(cache, article, summaryResult) {
  const key = summaryCacheKeyForArticle(article, summaryResult.summarySource);
  const entry = {
    key,
    title: article.title,
    url: article.resolvedUrl || article.url,
    descriptionHash: createDescriptionHash(article.description),
    summary: summaryResult.summary,
    summarySource: summaryResult.summarySource,
    createdAt: new Date().toISOString(),
  };
  cache.byKey.set(key, entry);
  cache.entries = [entry, ...cache.entries.filter((item) => item.key !== key)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, SUMMARY_CACHE_MAX_ITEMS);
  cache.dirty = true;
}

async function saveSummaryCache(cache) {
  if (!cache.dirty) return;
  await fs.writeFile(
    SUMMARY_CACHE_PATH,
    `${JSON.stringify({ version: 1, entries: cache.entries }, null, 2)}\n`,
    "utf8"
  );
  cache.dirty = false;
}

function sourceNameFromItem(item, feed) {
  if (feed.priority === "primary") return cleanText(feed.sourceName || feed.name);
  const rawSource = item.sourceInfo?.[0] || item.source;
  if (typeof rawSource === "string") return cleanText(rawSource);
  if (rawSource && typeof rawSource._ === "string") return cleanText(rawSource._);
  if (rawSource && typeof rawSource["#"] === "string") return cleanText(rawSource["#"]);
  return cleanText(item.creator || item.author || feed.name);
}

function publisherUrlFromItem(item) {
  const rawSource = item?.sourceInfo?.[0] || item?.source;
  const candidates = [
    rawSource?.$?.url,
    rawSource?.url,
    item?.sourceUrl,
    item?.publisherUrl,
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !isGoogleNewsUrl(url.href)) {
        return url.origin;
      }
    } catch {
      // RSS source 속성이 URL이 아니면 다음 후보를 확인한다.
    }
  }
  return null;
}

function publisherSourceConfig(source) {
  const normalizedSource = normalizeForMatch(source);
  return sourceFeeds.find(
    (feed) =>
      feed.priority === "primary" &&
      feed.baseUrl &&
      normalizeForMatch(feed.sourceName || feed.name) === normalizedSource
  ) || null;
}

function stripSourceSuffix(title, source) {
  const normalizedSource = normalizeForMatch(source).replace(/[()]/g, "");
  let cleanedTitle = cleanText(title);

  while (true) {
    const match = cleanedTitle.match(/^(.*)\s[-–—]\s([^–—]{1,50})$/u);
    if (!match) break;

    const normalizedTail = normalizeForMatch(match[2]).replace(/[()]/g, "");
    const isSourceSuffix =
      normalizedTail &&
      normalizedSource &&
      (normalizedTail.includes(normalizedSource) || normalizedSource.includes(normalizedTail));
    if (!isSourceSuffix) break;

    cleanedTitle = match[1].trim();
  }

  return cleanedTitle;
}

function scoreCategories(title, description, categoryHints = []) {
  return Object.entries(categories)
    .map(([category, keywords]) => {
      const titleHits = keywords.filter((keyword) => containsKeyword(title, keyword));
      const descriptionHits = keywords.filter((keyword) =>
        containsKeyword(description, keyword)
      );
      const keywordScore =
        Math.min(titleHits.length, 3) * 7 +
        Math.min(descriptionHits.length, 4) * 3 +
        (categoryHints.includes(category) ? 2 : 0);

      return {
        category,
        descriptionHits,
        keywordScore,
        matched: titleHits.length + descriptionHits.length > 0,
        titleHits,
      };
    })
    .sort((left, right) => right.keywordScore - left.keywordScore);
}

function hasAnyKeyword(title, description, keywords) {
  const context = `${title} ${description}`;
  return keywords.some((keyword) => containsKeyword(context, keyword));
}

function hasTechKeyword(title, description) {
  return hasAnyKeyword(title, description, categories[techCategoryName]);
}

function hasEcosystemKeyword(title, description) {
  return hasAnyKeyword(title, description, techEcosystemKeywords);
}

function hasStartupGrowthContext(title, description) {
  return hasAnyKeyword(title, description, startupGrowthContextKeywords);
}

function hasStrongStartupContext(title, description) {
  return hasAnyKeyword(title, description, techStartupContextKeywords);
}

function isGeneralIndustryTechArticle(title, description) {
  const context = `${title} ${description}`;
  const matchesGeneralPattern = generalTechIndustryPatterns.some((pattern) =>
    pattern.test(context)
  );
  return matchesGeneralPattern && !hasStrongStartupContext(title, description);
}

function isStartupEcosystemRelevant(title, description) {
  return (
    hasTechKeyword(title, description) &&
    hasEcosystemKeyword(title, description) &&
    hasStartupGrowthContext(title, description) &&
    hasStrongStartupContext(title, description)
  );
}

function freshnessBonus(publishedAt, rangeFrom, rangeTo) {
  const age = rangeTo.getTime() - publishedAt.getTime();
  const range = rangeTo.getTime() - rangeFrom.getTime();
  return Math.max(0, Math.min(4, Math.round(4 * (1 - age / range))));
}

function hasStrongStartupEvent(title, description = "", articleBody = "") {
  const context = `${title} ${description} ${articleBody}`;
  return STRONG_STARTUP_EVENT_PATTERNS.some((pattern) => pattern.test(context));
}

function hasOverseasVcSignal(title, description = "", articleBody = "") {
  return OVERSEAS_VC_REQUIRED_PATTERN.test(`${title} ${description} ${articleBody}`);
}

function isLowValueEditorialArticle(title, description = "", articleBody = "") {
  const titleAndDescription = `${title} ${description}`;
  const context = `${titleAndDescription} ${articleBody}`;
  const explicitlyEditorial = LOW_VALUE_EDITORIAL_PATTERNS.some((pattern) =>
    pattern.test(titleAndDescription)
  );
  const generalWithoutEvent =
    (GENERAL_OUTLOOK_PATTERNS.some((pattern) => pattern.test(titleAndDescription)) ||
      LARGE_COMPANY_GENERAL_PATTERNS.some((pattern) => pattern.test(context))) &&
    !hasStrongStartupEvent(title, description, articleBody) &&
    !ECOSYSTEM_LINK_PATTERN.test(context);
  return explicitlyEditorial || generalWithoutEvent;
}

function collectMatchedSignals(title = "", description = "", articleBody = "") {
  const fields = [
    ["title", title],
    ["description", description],
    ["body", articleBody],
  ];
  const signals = [];
  for (const signal of [...EDITORIAL_PRIORITY_SIGNALS, ...BROAD_CANDIDATE_SIGNALS]) {
    const matchedField = fields.find(([, value]) => value && signal.pattern.test(value));
    if (matchedField) signals.push(`${signal.name}:${matchedField[0]}`);
  }
  return [...new Set(signals)];
}

function finalHardExcludeReason({
  title = "",
  description = "",
  articleBody = "",
  summary = "",
} = {}) {
  const titleText = cleanText(title);
  const bodyAndSummary = cleanText(`${articleBody} ${summary}`);
  const allContext = cleanText(`${titleText} ${description} ${bodyAndSummary}`);
  const currentEventContext = cleanText(`${titleText} ${articleBody} ${summary}`);
  const publicCompanySignal = LISTED_OR_LARGE_COMPANY_PATTERN.test(allContext);
  const explicitVentureFinancing = DIRECT_VENTURE_INVESTMENT_PATTERN.test(
    cleanText(`${titleText} ${Array.from(articleBody).slice(0, 1_200).join("")}`)
  );
  const currentStartupEvent =
    CURRENT_ECOSYSTEM_EVENT_PATTERN.test(currentEventContext) &&
    (STARTUP_TARGET_PATTERN.test(currentEventContext) ||
      VENTURE_ECOSYSTEM_PATTERN.test(currentEventContext));

  if (/유상증자/iu.test(currentEventContext) && publicCompanySignal) {
    return "hard_exclude_public_company_rights_issue";
  }
  if (
    (STOCK_MARKET_NOISE_PATTERNS.some((pattern) => pattern.test(titleText)) ||
      /(?:코스피|코스닥|상장사|상장기업|주가|증시)/iu.test(titleText)) &&
    !currentStartupEvent
  ) {
    return "hard_exclude_stock_market";
  }
  if (
    publicCompanySignal &&
    /(?:공장|설비|제련소|광산|생산시설|해외\s*(?:산업\s*)?투자|시설\s*투자)/iu.test(
      currentEventContext
    ) &&
    !explicitVentureFinancing
  ) {
    return "hard_exclude_large_corp_industrial_investment";
  }
  if (
    /(?:국민체감\s*성과|특별\s*포상|포상금|정책\s*성과\s*포상|우수\s*성과\s*포상)/iu.test(
      currentEventContext
    )
  ) {
    return "hard_exclude_government_promotion_award";
  }
  if (
    HISTORICAL_VENTURE_ORIGIN_PATTERN.test(articleBody) &&
    !CURRENT_ECOSYSTEM_EVENT_PATTERN.test(titleText) &&
    !currentStartupEvent
  ) {
    return "hard_exclude_historical_venture_origin_only";
  }
  return null;
}

function analyzeStrongConnection(title = "", description = "", articleBody = "") {
  const titleText = cleanText(title);
  const bodyText = cleanText(articleBody);
  const context = cleanText(`${titleText} ${description} ${bodyText}`);
  // description은 넓은 후보 발견에만 쓰고, 강한 연결은 제목 또는 본문에서 확인한다.
  const evidenceContext = cleanText(`${titleText} ${bodyText}`);
  const bodyLead = Array.from(bodyText).slice(0, 700).join("");
  const hasStartupTarget = STARTUP_TARGET_PATTERN.test(evidenceContext);
  const hasStartupSubject =
    STARTUP_TARGET_PATTERN.test(titleText) ||
    (STARTUP_TARGET_PATTERN.test(bodyLead) &&
      CURRENT_ECOSYSTEM_EVENT_PATTERN.test(bodyLead));
  const hasVentureEcosystem = VENTURE_ECOSYSTEM_PATTERN.test(evidenceContext);
  const hasInstitutionalActor = INSTITUTIONAL_ACTOR_PATTERN.test(evidenceContext);
  const hasFinancingAction = FINANCING_ACTION_PATTERN.test(evidenceContext);
  const hasPolicySupportAction = POLICY_SUPPORT_ACTION_PATTERN.test(evidenceContext);
  const hasCollaborationAction = COLLABORATION_ACTION_PATTERN.test(evidenceContext);
  const hasCurrentEvent = CURRENT_ECOSYSTEM_EVENT_PATTERN.test(evidenceContext);
  const hasVentureMarketEvent = VENTURE_MARKET_EVENT_PATTERN.test(evidenceContext);
  const isPublicCompanyOrLargeCorp = PUBLIC_COMPANY_OR_LARGE_CORP_PATTERN.test(context);
  const isGeneralIndustry =
    GENERAL_OUTLOOK_PATTERNS.some((pattern) => pattern.test(context)) ||
    generalTechIndustryPatterns.some((pattern) => pattern.test(context)) ||
    GENERAL_POLICY_ACHIEVEMENT_PATTERN.test(context) ||
    (INDUSTRIAL_CAPEX_PATTERN.test(context) && !hasStartupTarget && !hasVentureEcosystem);

  let strongConnectionType = null;
  if (hasStartupTarget && hasCollaborationAction && hasInstitutionalActor) {
    strongConnectionType = "E";
  } else if (
    hasInstitutionalActor &&
    (hasStartupTarget || hasVentureEcosystem) &&
    (hasPolicySupportAction || hasFinancingAction || hasCollaborationAction)
  ) {
    strongConnectionType = "B";
  } else if (
    hasFinancingAction &&
    (hasStartupTarget || hasVentureEcosystem || VC_CATEGORY_STRONG_PATTERN.test(context))
  ) {
    strongConnectionType = "C";
  } else if (
    hasPolicySupportAction &&
    (hasStartupTarget || hasVentureEcosystem)
  ) {
    strongConnectionType = "D";
  } else if ((hasStartupSubject && hasCurrentEvent) || hasVentureMarketEvent) {
    strongConnectionType = "A";
  }
  if (!hasCurrentEvent && !hasStartupSubject && !hasVentureMarketEvent) {
    strongConnectionType = null;
  }
  if (LOW_VALUE_EDITORIAL_PATTERNS.some((pattern) => pattern.test(context))) {
    strongConnectionType = null;
  }
  if (
    HISTORICAL_VENTURE_ORIGIN_PATTERN.test(bodyText) &&
    !CURRENT_ECOSYSTEM_EVENT_PATTERN.test(titleText) &&
    !hasVentureMarketEvent
  ) {
    strongConnectionType = null;
  }

  const missingSignals = [];
  if (!hasStartupTarget && !hasVentureEcosystem) {
    missingSignals.push("startup_or_venture_target");
  }
  if (!hasCurrentEvent && !hasVentureMarketEvent) {
    missingSignals.push("title_or_body_ecosystem_event");
  }
  if (isPublicCompanyOrLargeCorp && !strongConnectionType) {
    missingSignals.push("startup_link_for_public_company");
  }
  if (isGeneralIndustry && !strongConnectionType) {
    missingSignals.push("startup_link_for_general_industry");
  }

  return {
    strongConnectionType,
    isPublicCompanyOrLargeCorp,
    isGeneralIndustry,
    isStartupEcosystemRelated: Boolean(strongConnectionType),
    missingSignals,
  };
}

function inferBroadCategory(
  title,
  description,
  categoryHints,
  bestCategory,
  isDomestic,
  strongConnectionType = null
) {
  const context = `${title} ${description}`;
  if (/세컨더리|구주|회수시장|LP\s*지분|GP-led|continuation\s+fund/iu.test(context)) {
    return "세컨더리 / 구주매각";
  }
  if (/(?:TIPS|팁스|LIPS|립스)/iu.test(context)) return "TIPS / LIPS";
  if (
    !isDomestic &&
    hasOverseasVcSignal(title, description) &&
    categoryHints.includes("해외 VC")
  ) {
    return "해외 VC";
  }
  const titleHasDirectInvestment = DIRECT_VENTURE_INVESTMENT_PATTERN.test(title);
  if (
    INSTITUTIONAL_STARTUP_SUPPORT_PATTERN.test(title) ||
    EXPLICIT_STARTUP_PARTNERSHIP_SUPPORT_PATTERN.test(title)
  ) {
    return "스타트업 / 벤처기업 / 초기창업";
  }
  if (titleHasDirectInvestment) return "VC / AC";
  if (TECH_STARTUP_BUSINESS_PATTERN.test(context)) return techCategoryName;
  if (STARTUP_SUPPORT_CATEGORY_PATTERN.test(title)) {
    return "스타트업 / 벤처기업 / 초기창업";
  }
  if (VC_CATEGORY_STRONG_PATTERN.test(context)) return "VC / AC";
  if (
    bestCategory?.matched &&
    bestCategory.category !== "VC / AC" &&
    bestCategory.category !== "해외 VC"
  ) {
    return bestCategory.category;
  }
  if (strongConnectionType === "C") return "VC / AC";
  return "스타트업 / 벤처기업 / 초기창업";
}

function explicitExclusionReason({
  title,
  description,
  category,
  isDomestic,
  strongAnalysis,
  deferWeakConnection = true,
}) {
  const context = `${title} ${description}`;
  const { strongConnectionType, isPublicCompanyOrLargeCorp, isGeneralIndustry } =
    strongAnalysis;

  const hardExcludeReason = finalHardExcludeReason({ title, description });
  if (hardExcludeReason) return hardExcludeReason;

  if (STOCK_MARKET_NOISE_PATTERNS.some((pattern) => pattern.test(context))) {
    if (!strongConnectionType) {
      return "stock_market_noise";
    }
  }
  if (LOW_VALUE_EDITORIAL_PATTERNS.some((pattern) => pattern.test(context))) {
    return "low_value_editorial_article";
  }
  if (isPublicCompanyOrLargeCorp && !strongConnectionType) {
    return deferWeakConnection ? null : "public_company_or_large_corp_general";
  }
  if (isGeneralIndustry && !strongConnectionType) {
    return deferWeakConnection ? null : "general_industry_article";
  }
  if (!strongConnectionType) {
    return deferWeakConnection ? null : "strong_connection_missing";
  }
  if (
    category === techCategoryName &&
    !strongConnectionType
  ) {
    return "general_industry_article";
  }
  if (
    !isDomestic &&
    category === "해외 VC" &&
    (!hasOverseasVcSignal(title, description) || OVERSEAS_ADVICE_PATTERN.test(context))
  ) {
    return "overseas_vc_signal_missing";
  }
  return null;
}

function evaluateStrongConnectionArticle({
  title = "",
  description = "",
  articleBody = "",
  isDomestic = true,
  categoryHints = [],
}) {
  const combinedDescription = `${description} ${articleBody}`;
  const strongAnalysis = analyzeStrongConnection(
    title,
    description,
    articleBody
  );
  const category = inferBroadCategory(
    title,
    combinedDescription,
    categoryHints,
    null,
    isDomestic,
    strongAnalysis.strongConnectionType
  );
  const excludeReason = explicitExclusionReason({
    title,
    description: combinedDescription,
    category,
    isDomestic,
    strongAnalysis,
    deferWeakConnection: false,
  });
  return {
    category,
    excludeReason,
    ...strongAnalysis,
  };
}

function calculateEditorialPriorityAdjustment({
  title = "",
  description = "",
  articleBody = "",
  category = "",
}) {
  let adjustment = 0;
  for (const signal of EDITORIAL_PRIORITY_SIGNALS) {
    if (signal.pattern.test(title)) adjustment += signal.title;
    else if (signal.pattern.test(description)) adjustment += signal.description;
    else if (articleBody && signal.pattern.test(articleBody)) adjustment += signal.body;
  }

  const titleAndDescription = `${title} ${description}`;
  const hasStrongEvent = hasStrongStartupEvent(title, description, articleBody);
  if (LOW_VALUE_EDITORIAL_PATTERNS.some((pattern) => pattern.test(titleAndDescription))) {
    adjustment -= 30;
  }
  if (GENERAL_OUTLOOK_PATTERNS.some((pattern) => pattern.test(titleAndDescription))) {
    adjustment -= hasStrongEvent ? 5 : 16;
  }
  if (LARGE_COMPANY_GENERAL_PATTERNS.some((pattern) => pattern.test(titleAndDescription))) {
    adjustment -= hasStrongEvent ? 5 : 18;
  }
  if (category === "해외 VC") {
    if (hasOverseasVcSignal(title, description, articleBody)) adjustment += 8;
    else adjustment -= 24;
    if (OVERSEAS_ADVICE_PATTERN.test(titleAndDescription)) adjustment -= 30;
  }
  return adjustment;
}

function calculateBodyPriorityAdjustment(articleBody = "") {
  if (!articleBody) return 0;
  const adjustment = EDITORIAL_PRIORITY_SIGNALS.reduce(
    (score, signal) => score + (signal.pattern.test(articleBody) ? signal.body : 0),
    0
  );
  return Math.min(adjustment, 12);
}

function calculateRelevanceScore(
  { title, description, source, publishedAt, feedPriority, sourceWeight = 0 },
  bestCategory,
  rangeFrom,
  rangeTo
) {
  let relevanceScore = bestCategory.keywordScore;
  if (isAllowedSource(source, allowedSources)) relevanceScore += 5;
  if (feedPriority === "primary") relevanceScore += 4;
  if (feedPriority === "discovery") relevanceScore -= 2;
  relevanceScore += Math.max(0, Math.min(10, Number(sourceWeight) || 0));
  relevanceScore += freshnessBonus(publishedAt, rangeFrom, rangeTo);
  if (Array.from(title).length < 12) relevanceScore -= 4;

  const adHits = ADVERTISING_WORDS.filter((word) => containsKeyword(title, word)).length;
  relevanceScore -= Math.min(adHits * 4, 8);

  if (bestCategory.category === techCategoryName) {
    const ecosystemTitleHits = techEcosystemKeywords.filter((keyword) =>
      containsKeyword(title, keyword)
    ).length;
    const ecosystemDescriptionHits = techEcosystemKeywords.filter((keyword) =>
      containsKeyword(description, keyword)
    ).length;
    relevanceScore += Math.min(
      ecosystemTitleHits * 5 + ecosystemDescriptionHits * 2,
      12
    );
  }

  relevanceScore += calculateEditorialPriorityAdjustment({
    title,
    description,
    category: bestCategory.category,
  });

  return relevanceScore;
}

function scoreArticle(
  { title, description, source, publishedAt, feedPriority, sourceWeight, categoryHints },
  rangeFrom,
  rangeTo
) {
  return evaluateArticle(
    { title, description, source, publishedAt, feedPriority, sourceWeight, categoryHints },
    rangeFrom,
    rangeTo
  ).classification;
}

function evaluateArticle(
  {
    title,
    description,
    source,
    publishedAt,
    feedPriority,
    sourceWeight = 0,
    categoryHints = [],
    isDomestic = true,
  },
  rangeFrom,
  rangeTo
) {
  const rankedCategories = scoreCategories(title, description, categoryHints);
  const bestCategory = rankedCategories[0];
  const matchedSignals = collectMatchedSignals(title, description);
  if (!matchedSignals.length) {
    return {
      classification: null,
      keywordMatched: false,
      reason: "broad_signal_missing",
      matchedSignals,
    };
  }
  const strongAnalysis = analyzeStrongConnection(title, description);
  const category = inferBroadCategory(
    title,
    description,
    categoryHints,
    bestCategory,
    isDomestic,
    strongAnalysis.strongConnectionType
  );
  const categoryScore =
    rankedCategories.find((entry) => entry.category === category) ||
    { category, keywordScore: 0, matched: false };

  let relevanceScore = calculateRelevanceScore(
    { title, description, source, publishedAt, feedPriority, sourceWeight },
    categoryScore,
    rangeFrom,
    rangeTo
  );
  relevanceScore += strongAnalysis.strongConnectionType ? 10 : -14;
  if (
    strongAnalysis.isPublicCompanyOrLargeCorp &&
    !strongAnalysis.strongConnectionType
  ) {
    relevanceScore -= 12;
  }
  if (strongAnalysis.isGeneralIndustry && !strongAnalysis.strongConnectionType) {
    relevanceScore -= 10;
  }
  const reason = explicitExclusionReason({
    title,
    description,
    category,
    isDomestic,
    strongAnalysis,
    deferWeakConnection: true,
  });
  if (reason) {
    return {
      classification: null,
      keywordMatched: true,
      reason,
      provisionalClassification: {
        category,
        score: relevanceScore,
        ...strongAnalysis,
      },
      matchedSignals,
      ...strongAnalysis,
    };
  }
  const provisionalExcludeReason = strongAnalysis.strongConnectionType
    ? null
    : strongAnalysis.isPublicCompanyOrLargeCorp
      ? "public_company_or_large_corp_general"
      : strongAnalysis.isGeneralIndustry
        ? "general_industry_article"
        : "strong_connection_missing";
  return {
    classification: {
      category,
      score: relevanceScore,
      includeReason: matchedSignals.slice(0, 4).join(", "),
      matchedSignals,
      provisionalExcludeReason,
      ...strongAnalysis,
    },
    keywordMatched: true,
    reason: null,
    matchedSignals,
    ...strongAnalysis,
  };
}

async function fetchRssSource(feed) {
  try {
    const parsed = await createRssParser(feed.fetchTimeoutMs).parseURL(feed.feedUrl);
    const items = (parsed.items || []).slice(0, feed.maxItems);
    return {
      entries: items.map((item) => ({ item, feed })),
      feed,
      succeeded: true,
      rawCount: items.length,
    };
  } catch (error) {
    return { entries: [], feed, succeeded: false, rawCount: 0, error: error.message };
  }
}

async function fetchHtmlListSource(feed) {
  if (!(await isUrlAllowedByRobots(feed.listUrl, { timeoutMs: feed.fetchTimeoutMs }))) {
    return {
      entries: [],
      feed,
      succeeded: false,
      rawCount: 0,
      error: "robots_disallowed",
    };
  }
  const page = await requestHtml(feed.listUrl, feed.fetchTimeoutMs, "source_list_");
  if (!page.ok) {
    return {
      entries: [],
      feed,
      succeeded: false,
      rawCount: 0,
      error: `${page.reason}${page.detail ? `: ${page.detail}` : ""}`,
    };
  }

  const links = extractListLinks(page.html, feed);
  const entries = [];
  for (const link of links) {
    if (!hasPotentialNewsKeyword(link.title)) continue;
    let publishedAt = link.publishedAt;
    let description = "";
    let title = link.title;
    let prefetchedHtml = null;
    const articleAllowed = await isUrlAllowedByRobots(link.url, {
      timeoutMs: feed.fetchTimeoutMs,
    });
    if (!articleAllowed) continue;
    if (articleAllowed) {
      await wait(feed.fetchDelayMs);
      const detail = await requestHtml(link.url, feed.fetchTimeoutMs, "source_detail_");
      if (detail.ok) {
        publishedAt =
          extractDateFromMarkup(detail.html, feed.dateSelector) || publishedAt;
        description = descriptionFromArticleHtml(detail.html);
        title = titleFromArticleHtml(detail.html, title, feed.titleSelector);
        prefetchedHtml = detail.html;
      }
    }
    if (!publishedAt) continue;
    entries.push({
      item: {
        title,
        link: link.url,
        pubDate: publishedAt.toISOString(),
        contentSnippet: description,
        _prefetchedHtml: prefetchedHtml,
      },
      feed,
    });
  }
  return { entries, feed, succeeded: true, rawCount: links.length };
}

async function fetchSitemapSource(feed) {
  if (!(await isUrlAllowedByRobots(feed.sitemapUrl, { timeoutMs: feed.fetchTimeoutMs }))) {
    return { entries: [], feed, succeeded: false, rawCount: 0, error: "robots_disallowed" };
  }
  const page = await requestHtml(feed.sitemapUrl, feed.fetchTimeoutMs, "source_sitemap_");
  if (!page.ok) {
    return { entries: [], feed, succeeded: false, rawCount: 0, error: page.reason };
  }
  const records = [...page.html.matchAll(/<url>\s*<loc>([\s\S]*?)<\/loc>[\s\S]*?<lastmod>([\s\S]*?)<\/lastmod>[\s\S]*?<\/url>/giu)]
    .map((match) => ({ url: decodeHtmlAttribute(match[1]), publishedAt: parsePublishedDate(match[2]) }))
    .filter((entry) => entry.publishedAt && matchesAllowedUrl(entry.url, feed))
    .slice(0, feed.maxItems);
  const entries = [];
  for (const record of records) {
    if (!(await isUrlAllowedByRobots(record.url, { timeoutMs: feed.fetchTimeoutMs }))) continue;
    await wait(feed.fetchDelayMs);
    const detail = await requestHtml(record.url, feed.fetchTimeoutMs, "source_detail_");
    if (!detail.ok) continue;
    const title = titleFromArticleHtml(detail.html, "", feed.titleSelector);
    if (!title || !hasPotentialNewsKeyword(title)) continue;
    entries.push({
      item: {
        title,
        link: record.url,
        pubDate: record.publishedAt.toISOString(),
        contentSnippet: descriptionFromArticleHtml(detail.html),
        _prefetchedHtml: detail.html,
      },
      feed,
    });
  }
  return { entries, feed, succeeded: true, rawCount: records.length };
}

async function fetchSource(feed) {
  let result;
  if (feed.type === "rss") result = await fetchRssSource(feed);
  else if (feed.type === "html_list" || feed.type === "search_page") {
    result = await fetchHtmlListSource(feed);
  } else if (feed.type === "sitemap") result = await fetchSitemapSource(feed);
  else {
    result = { entries: [], feed, succeeded: false, rawCount: 0, error: "unsupported_source_type" };
  }

  const label = `[source ${feed.type}] ${feed.name}`;
  if (result.succeeded) console.log(`${label}: 원본 ${result.rawCount}건`);
  else console.warn(`${label}: 실패 (${result.error || "unknown"})`);
  return result;
}

function candidateAuditKey(title, url) {
  return `${normalizeForMatch(title)}|${normalizeCollectedUrl(url)}`;
}

function addCandidateAuditRecord(candidateAudit, record) {
  const key = candidateAuditKey(record.title, record.url);
  const previous = candidateAudit.get(key);
  if (!previous || Number(record.relevanceScore || 0) > Number(previous.relevanceScore || 0)) {
    candidateAudit.set(key, { ...record, _key: key });
  }
}

function updateCandidateAuditRecord(candidateAudit, article, changes) {
  const key = candidateAuditKey(article.title, article.url);
  const record =
    candidateAudit.get(key) ||
    [...candidateAudit.values()].find(
      (candidate) => normalizeForMatch(candidate.title) === normalizeForMatch(article.title)
    );
  if (record) Object.assign(record, changes);
}

async function saveCandidateDebugReport(candidateAudit, generatedDate, finalItems) {
  const finalKeys = new Set(
    finalItems.map((item) => candidateAuditKey(item.title, item.url))
  );
  const records = [...candidateAudit.values()]
    .map((record) => ({
      title: record.title,
      source: record.source,
      url: record.url,
      publishedAt: record.publishedAt,
      category: record.category || null,
      relevanceScore: Number(record.relevanceScore || 0),
      includeReason: record.includeReason || null,
      excludeReason: record.excludeReason || null,
      matchedSignals: record.matchedSignals || [],
      isDomestic: Boolean(record.isDomestic),
      strongConnectionType: record.strongConnectionType || null,
      isPublicCompanyOrLargeCorp: Boolean(record.isPublicCompanyOrLargeCorp),
      isGeneralIndustry: Boolean(record.isGeneralIndustry),
      isStartupEcosystemRelated: Boolean(record.isStartupEcosystemRelated),
      missingSignals: record.missingSignals || [],
      finalSelected:
        finalKeys.has(record._key) ||
        finalItems.some(
          (item) => normalizeForMatch(item.title) === normalizeForMatch(record.title)
        ),
    }))
    .sort(
      (left, right) =>
        Number(right.finalSelected) - Number(left.finalSelected) ||
        right.relevanceScore - left.relevanceScore ||
        left.title.localeCompare(right.title, "ko")
    );
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const debugPath = path.join(DEBUG_DIR, `candidates-${generatedDate}.json`);
  await fs.writeFile(debugPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return debugPath;
}

function normalizeFeedItem(
  entry,
  rangeFrom,
  rangeTo,
  includeUnlisted,
  diagnostics,
  candidateAudit,
  sourceRecoveryCandidates = []
) {
  const { item, feed } = entry;
  const publishedAt = parsePublishedDate(item.isoDate || item.pubDate || item.published);
  const url = item.link || item.guid;
  if (
    !publishedAt ||
    publishedAt < rangeFrom ||
    publishedAt > rangeTo ||
    !url ||
    !matchesAllowedUrl(url, feed)
  ) {
    diagnostics.metadataOrDateExcludedCount += 1;
    return null;
  }

  const source = sourceNameFromItem(item, feed);
  const publisherBaseUrl = publisherUrlFromItem(item);
  const title = stripSourceSuffix(item.title, source);
  const description = cleanText(
    item.contentSnippet || item.description || item.summary || ""
  ).slice(0, 1_000);
  if (!title) {
    diagnostics.metadataOrDateExcludedCount += 1;
    return null;
  }
  const isDomestic = feed.region !== "global";

  const evaluation = evaluateArticle(
    {
      title,
      description,
      source,
      publishedAt,
      feedPriority: feed.priority,
      sourceWeight: feed.sourceWeight,
      categoryHints: feed.categoryHints,
      isDomestic,
    },
    rangeFrom,
    rangeTo
  );
  const provisional = evaluation.classification || evaluation.provisionalClassification;
  const sourceAllowed = includeUnlisted || isAllowedSource(source, allowedSources);
  if (evaluation.keywordMatched) {
    diagnostics.keywordFilterPassedCount += 1;
    diagnostics.broadCandidateCount += 1;
  }
  else diagnostics.keywordExcludedCount += 1;
  addCandidateAuditRecord(candidateAudit, {
    title,
    source,
    url,
    publishedAt: formatKstIso(publishedAt),
    category: provisional?.category || null,
    relevanceScore: provisional?.score || 0,
    includeReason:
      evaluation.classification?.includeReason ||
      evaluation.matchedSignals?.slice(0, 4).join(", ") ||
      null,
    excludeReason: !sourceAllowed
      ? "source_not_allowed"
      : evaluation.classification?.provisionalExcludeReason || evaluation.reason,
    matchedSignals: evaluation.matchedSignals || [],
    isDomestic,
    strongConnectionType: provisional?.strongConnectionType || null,
    isPublicCompanyOrLargeCorp: Boolean(provisional?.isPublicCompanyOrLargeCorp),
    isGeneralIndustry: Boolean(provisional?.isGeneralIndustry),
    isStartupEcosystemRelated: Boolean(provisional?.isStartupEcosystemRelated),
    missingSignals: provisional?.missingSignals || evaluation.missingSignals || [],
  });
  if (!evaluation.classification) {
    if (evaluation.reason?.startsWith("hard_exclude_")) {
      diagnostics.finalHardExcludedCount += 1;
    } else if (evaluation.reason === "general_industry_article") {
      diagnostics.generalIndustryExcludedCount += 1;
    } else if (evaluation.reason === "low_value_editorial_article") {
      diagnostics.lowValueEditorialExcludedCount += 1;
    } else if (evaluation.reason === "overseas_vc_signal_missing") {
      diagnostics.overseasVcSignalExcludedCount += 1;
    } else if (evaluation.reason === "stock_market_noise") {
      diagnostics.stockMarketExcludedCount += 1;
    } else if (evaluation.reason === "ecosystem_link_missing") {
      diagnostics.ecosystemLinkMissingCount += 1;
    } else if (evaluation.keywordMatched) {
      diagnostics.relevanceScoreExcludedCount += 1;
    }
    return null;
  }

  const normalizedArticle = {
    ...evaluation.classification,
    title,
    description,
    source,
    feedName: feed.name,
    feedPriority: feed.priority,
    feedCategories: feed.categoryHints,
    sourceWeight: feed.sourceWeight,
    sourceConfig: feed,
    publisherBaseUrl,
    includeReason: evaluation.classification.includeReason,
    matchedSignals: evaluation.classification.matchedSignals,
    isDomestic,
    strongConnectionType: evaluation.classification.strongConnectionType,
    isPublicCompanyOrLargeCorp:
      evaluation.classification.isPublicCompanyOrLargeCorp,
    isGeneralIndustry: evaluation.classification.isGeneralIndustry,
    isStartupEcosystemRelated:
      evaluation.classification.isStartupEcosystemRelated,
    missingSignals: evaluation.classification.missingSignals,
    prefetchedHtml: item._prefetchedHtml || null,
    googleNewsUrl: isGoogleNewsUrl(url),
    url,
    publishedAt,
    _sourceAllowed: sourceAllowed,
    _sourceRecovery: !sourceAllowed,
  };

  if (!sourceAllowed) {
    diagnostics.sourceExcludedCount += 1;
    const hardExcludeReason = finalHardExcludeReason({ title, description });
    if (evaluation.classification.strongConnectionType && !hardExcludeReason) {
      sourceRecoveryCandidates.push(normalizedArticle);
      diagnostics.sourceRecoveryCandidateCount += 1;
      updateCandidateAuditRecord(candidateAudit, normalizedArticle, {
        excludeReason: "source_not_allowed_recovery_candidate",
      });
    }
    return null;
  }
  diagnostics.sourceFilterPassedCount += 1;
  return normalizedArticle;
}

function compareForDedup(left, right) {
  const priority = { primary: 2, secondary: 1, discovery: 0 };
  return (
    Number(right._sourceAllowed !== false) - Number(left._sourceAllowed !== false) ||
    (priority[right.feedPriority] || 0) - (priority[left.feedPriority] || 0) ||
    right.score - left.score ||
    right.publishedAt - left.publishedAt
  );
}

function compareForOutput(left, right) {
  const leftDate = formatKstDate(left.publishedAt);
  const rightDate = formatKstDate(right.publishedAt);
  return (
    rightDate.localeCompare(leftDate) ||
    right.score - left.score ||
    right.publishedAt - left.publishedAt
  );
}

function limitByCategory(articles, maxItemsPerCategory) {
  const counts = Object.fromEntries(Object.keys(categories).map((category) => [category, 0]));

  return articles.filter((article) => {
    if (counts[article.category] >= maxItemsPerCategory) return false;
    counts[article.category] += 1;
    return true;
  });
}

function categoryCountSummary(articles) {
  return Object.keys(categories)
    .map(
      (category) =>
        `${category}=${articles.filter((article) => article.category === category).length}`
    )
    .join(", ");
}

function isProtectedPreselectionCandidate(article) {
  const title = cleanText(article?.title || "");
  return (
    DIRECT_VENTURE_INVESTMENT_PATTERN.test(title) ||
    /(?:TIPS|팁스|LIPS|립스|스케일업\s*팁스|초격차).{0,35}(?:선정|선발|확정|지원)/iu.test(
      title
    )
  );
}

function fillCandidatesByPriority(
  primaryArticles,
  discoveryArticles,
  maxItemsPerCategory,
  maxTotal = DEFAULT_MAX_EXTRACTION_CANDIDATES
) {
  const regularCounts = Object.fromEntries(
    Object.keys(categories).map((category) => [category, 0])
  );
  const protectedCounts = Object.fromEntries(
    Object.keys(categories).map((category) => [category, 0])
  );
  const selected = [];
  const ordered = [...primaryArticles, ...discoveryArticles].sort(
    (left, right) =>
      Number(isProtectedPreselectionCandidate(right)) -
        Number(isProtectedPreselectionCandidate(left)) ||
      Number(Boolean(right.strongConnectionType)) -
        Number(Boolean(left.strongConnectionType)) ||
      right.score - left.score ||
      Number(right.feedPriority === "primary") -
        Number(left.feedPriority === "primary") ||
      right.publishedAt - left.publishedAt
  );

  for (const article of ordered) {
    if (selected.length >= maxTotal) break;
    const protectedCandidate = isProtectedPreselectionCandidate(article);
    if (protectedCandidate) {
      if (protectedCounts[article.category] >= maxItemsPerCategory + 4) continue;
      protectedCounts[article.category] += 1;
    } else {
      if (regularCounts[article.category] >= maxItemsPerCategory) continue;
      regularCounts[article.category] += 1;
    }
    selected.push(article);
  }

  return selected;
}

function selectFinalBriefingItems(
  items,
  {
    minDomestic = DEFAULT_MIN_DOMESTIC_ARTICLES,
    minFinal = DEFAULT_MIN_FINAL_ARTICLES,
    maxFinal = DEFAULT_MAX_FINAL_ARTICLES,
    maxPerCategory = 5,
  } = {}
) {
  const ordered = items
    .filter((item) => item._strongConnectionType)
    .sort(
    (left, right) =>
      right.score - left.score ||
      Number(right._isDomestic) - Number(left._isDomestic) ||
      right.publishedAt.localeCompare(left.publishedAt)
    );
  const strictOrdered = ordered.filter((item) => item._sourceAllowed !== false);
  const selected = [];
  const selectedIds = new Set();
  const categoryCounts = Object.fromEntries(
    Object.keys(categories).map((category) => [category, 0])
  );
  let supplementalCount = 0;
  let sourceRecoverySupplementCount = 0;

  const add = (item, supplemental = false) => {
    if (
      selected.length >= maxFinal ||
      selectedIds.has(item.id) ||
      categoryCounts[item.category] >= maxPerCategory
    ) {
      return false;
    }
    selected.push(item);
    selectedIds.add(item.id);
    categoryCounts[item.category] += 1;
    if (supplemental) {
      supplementalCount += 1;
      if (item._sourceRecovery) sourceRecoverySupplementCount += 1;
    }
    return true;
  };
  const strictThreshold = (item) =>
    item._isDomestic ? MIN_RELEVANCE_SCORE : MIN_RELEVANCE_SCORE + 4;
  const relaxedThreshold = (item) => (item._isDomestic ? 7 : 12);
  const domesticCount = () => selected.filter((item) => item._isDomestic).length;

  for (const item of strictOrdered.filter((candidate) => candidate._isDomestic)) {
    if (domesticCount() >= minDomestic) break;
    if (item.score >= strictThreshold(item)) add(item);
  }
  for (const item of strictOrdered) {
    if (item.score >= strictThreshold(item)) add(item);
  }
  const supplementalAttempted =
    domesticCount() < minDomestic || selected.length < minFinal;
  if (supplementalAttempted) {
    for (const item of ordered.filter((candidate) => candidate._isDomestic)) {
      if (domesticCount() >= minDomestic) break;
      if (item.score >= relaxedThreshold(item)) add(item, true);
    }
    for (const item of ordered) {
      if (selected.length >= minFinal) break;
      if (item.score >= relaxedThreshold(item)) add(item, true);
    }
  }

  selected.sort(
    (left, right) =>
      right.score - left.score || right.publishedAt.localeCompare(left.publishedAt)
  );
  return {
    items: selected,
    supplementalAttempted,
    supplementalApplied: supplementalCount > 0,
    supplementalCount,
    sourceRecoverySupplementCount,
    supplementalNoCandidateReasons: [
      ...(domesticCount() < minDomestic
        ? ["domestic_strong_connection_candidates_exhausted"]
        : []),
      ...(selected.length < minFinal
        ? ["total_strong_connection_candidates_exhausted"]
        : []),
    ],
    domesticCount: domesticCount(),
    overseasCount: selected.filter((item) => !item._isDomestic).length,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function readArchiveDates() {
  const dates = new Set();

  try {
    const savedIndex = JSON.parse(await fs.readFile(ARCHIVE_INDEX_PATH, "utf8"));
    for (const date of savedIndex.dates || []) {
      if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) dates.add(date);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[아카이브 인덱스 재구성] ${error.message}`);
    }
  }

  try {
    const files = await fs.readdir(ARCHIVE_DIR);
    for (const file of files) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/u);
      if (match) dates.add(match[1]);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return [...dates].sort((left, right) => left.localeCompare(right));
}

function validateBriefingOutput(output) {
  if (!Array.isArray(output?.items)) {
    throw new Error("저장할 브리핑의 items가 배열이 아닙니다.");
  }
  if (output.totalCount !== output.items.length) {
    throw new Error(
      `브리핑 개수 불일치: totalCount=${output.totalCount}, items.length=${output.items.length}`
    );
  }
  const categoryTotal = Object.values(output.categoryCounts || {}).reduce(
    (sum, count) => sum + Number(count || 0),
    0
  );
  if (categoryTotal !== output.items.length) {
    throw new Error(
      `카테고리 개수 불일치: categoryCounts=${categoryTotal}, items.length=${output.items.length}`
    );
  }
  for (const item of output.items) {
    const quality = validateFinalArticleItem(item);
    if (!quality.isValid) {
      throw new Error(`최종 기사 필드 검증 실패: ${quality.reason}`);
    }
  }
}

function validateFinalArticleItem(item) {
  const requiredTextFields = [
    "title",
    "url",
    "source",
    "category",
    "summary",
    "summaryType",
  ];
  const missingField = requiredTextFields.find(
    (field) => !cleanText(item?.[field] || "")
  );
  if (missingField) return { isValid: false, reason: `missing_${missingField}` };
  if (isGoogleNewsUrl(item.url)) {
    return { isValid: false, reason: "google_news_url_forbidden" };
  }
  const hardExcludeReason = finalHardExcludeReason(item);
  if (hardExcludeReason) return { isValid: false, reason: hardExcludeReason };
  try {
    const parsed = new URL(item.url);
    if (!/^https?:$/u.test(parsed.protocol)) {
      return { isValid: false, reason: "invalid_article_url" };
    }
  } catch {
    return { isValid: false, reason: "invalid_article_url" };
  }
  return { isValid: true, reason: null };
}

async function saveBriefing(output, generatedDate) {
  validateBriefingOutput(output);
  const archivePath = path.join(ARCHIVE_DIR, `${generatedDate}.json`);
  const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(OUTPUT_PATH, serializedOutput, "utf8"),
    fs.writeFile(archivePath, serializedOutput, "utf8"),
  ]);

  const dates = await readArchiveDates();
  if (!dates.includes(generatedDate)) {
    dates.push(generatedDate);
    dates.sort((left, right) => left.localeCompare(right));
  }
  const archiveIndex = {
    dates,
    latest: dates.at(-1) || generatedDate,
  };
  await fs.writeFile(
    ARCHIVE_INDEX_PATH,
    `${JSON.stringify(archiveIndex, null, 2)}\n`,
    "utf8"
  );

  return { archivePath, archiveIndex };
}

async function collectNews() {
  await loadLocalEnvironment();
  resetOpenAIRequestMetrics();
  const summaryCache = await loadSummaryCache();
  const rangeTo = new Date();
  const rangeFrom = new Date(rangeTo.getTime() - 24 * 60 * 60 * 1_000);
  const includeUnlisted = /^true$/i.test(process.env.ALLOW_UNLISTED_SOURCES || "false");
  const maxItemsPerCategory = readPositiveInteger(
    process.env.MAX_ITEMS_PER_CATEGORY,
    5
  );
  const minDomesticArticles = readNonNegativeInteger(
    process.env.MIN_DOMESTIC_ARTICLES,
    DEFAULT_MIN_DOMESTIC_ARTICLES
  );
  const minFinalArticles = readPositiveInteger(
    process.env.MIN_FINAL_ARTICLES,
    DEFAULT_MIN_FINAL_ARTICLES
  );
  const maxFinalArticles = Math.max(
    minFinalArticles,
    readPositiveInteger(process.env.MAX_FINAL_ARTICLES, DEFAULT_MAX_FINAL_ARTICLES)
  );
  const maxExtractionCandidates = readPositiveInteger(
    process.env.MAX_EXTRACTION_CANDIDATES,
    DEFAULT_MAX_EXTRACTION_CANDIDATES
  );
  const candidateItemsPerCategory = Math.max(maxItemsPerCategory * 2, 8);
  const saveDebugCandidates = /^true$/i.test(
    process.env.SAVE_DEBUG_CANDIDATES || (process.env.CI === "true" ? "false" : "true")
  );
  const discoveryFallbackEnabled = /^true$/i.test(
    process.env.ENABLE_DISCOVERY_FALLBACK ||
      process.env.ENABLE_GOOGLE_NEWS_FALLBACK ||
      "false"
  );
  const discoveryMaxResultsPerQuery = readPositiveInteger(
    process.env.DISCOVERY_MAX_RESULTS_PER_QUERY,
    5
  );
  const discoveryMaxTotalResults = readPositiveInteger(
    process.env.DISCOVERY_MAX_TOTAL_RESULTS,
    40
  );
  const discoveryRequireOriginalUrl = !/^false$/i.test(
    process.env.DISCOVERY_REQUIRE_ORIGINAL_URL || "true"
  );

  console.log(
    `[수집 시작] ${formatKstIso(rangeFrom)} ~ ${formatKstIso(rangeTo)} / 카테고리당 최대 ${maxItemsPerCategory}건`
  );

  const diagnostics = {
    metadataOrDateExcludedCount: 0,
    broadCandidateCount: 0,
    keywordFilterPassedCount: 0,
    keywordExcludedCount: 0,
    relevanceScoreExcludedCount: 0,
    generalIndustryExcludedCount: 0,
    lowValueEditorialExcludedCount: 0,
    overseasVcSignalExcludedCount: 0,
    stockMarketExcludedCount: 0,
    ecosystemLinkMissingCount: 0,
    discoveryUrlUnresolvedCount: 0,
    strongConnectionPassedCount: 0,
    publicCompanyOrLargeCorpExcludedCount: 0,
    sourceFilterPassedCount: 0,
    sourceExcludedCount: 0,
    sourceRecoveryCandidateCount: 0,
    finalHardExcludedCount: 0,
  };
  const candidateAudit = new Map();
  const sourceRecoveryCandidates = [];
  const enabledSources = sourceFeeds;
  console.log(`[비활성 placeholder 수] ${disabledSources.length}개`);
  const primaryFeeds = enabledSources.filter(
    (feed) => feed.priority === "primary" && !feed.fallbackFor
  );
  const fallbackFeeds = enabledSources.filter(
    (feed) => feed.priority === "primary" && feed.fallbackFor
  );
  const discoveryFeeds = enabledSources
    .filter((feed) => feed.priority !== "primary")
    .map((feed) => ({
      ...feed,
      maxItems: Math.min(feed.maxItems, discoveryMaxResultsPerQuery),
    }));
  console.log(
    `[실제 활성 수집원 수] ${enabledSources.length}개 (primary ${primaryFeeds.length + fallbackFeeds.length}, discovery ${discoveryFeeds.length})`
  );
  const primaryBaseResults = await mapWithConcurrency(primaryFeeds, 4, fetchSource);
  const rawCountsBySource = new Map();
  for (const result of primaryBaseResults) {
    const key = result.feed.sourceName || result.feed.name;
    rawCountsBySource.set(key, (rawCountsBySource.get(key) || 0) + result.rawCount);
  }
  const enabledFallbackFeeds = fallbackFeeds.filter(
    (feed) => (rawCountsBySource.get(feed.fallbackFor) || 0) < feed.fallbackThreshold
  );
  for (const feed of enabledFallbackFeeds) {
    console.log(
      `[source fallback] ${feed.name}: ${feed.fallbackFor} 원본 ${rawCountsBySource.get(feed.fallbackFor) || 0}건`
    );
  }
  const primaryFallbackResults = await mapWithConcurrency(
    enabledFallbackFeeds,
    2,
    fetchSource
  );
  const primaryResults = [...primaryBaseResults, ...primaryFallbackResults];
  const primaryFetched = primaryResults.flatMap((result) => result.entries);
  const primaryNormalized = primaryFetched
    .map((entry) =>
      normalizeFeedItem(
        entry,
        rangeFrom,
        rangeTo,
        includeUnlisted,
        diagnostics,
        candidateAudit,
        sourceRecoveryCandidates
      )
    )
    .filter(Boolean)
    .sort(compareForDedup);
  const primaryDeduplicated = deduplicateArticles(primaryNormalized).sort(compareForOutput);
  const primaryCandidates = limitByCategory(
    primaryDeduplicated,
    candidateItemsPerCategory
  ).slice(0, maxExtractionCandidates);

  let discoveryResults = [];
  let discoveryFetched = [];
  let discoveryNormalized = [];
  const primaryStrongCandidateCount = primaryCandidates.filter(
    (article) => article.strongConnectionType
  ).length;
  const primaryStrongDomesticCount = primaryCandidates.filter(
    (article) => article.isDomestic && article.strongConnectionType
  ).length;
  const shouldUseDiscovery =
    discoveryFallbackEnabled &&
    (primaryStrongCandidateCount < minFinalArticles ||
      primaryStrongDomesticCount < minDomesticArticles);
  console.log(
    `[discovery fallback 사용 여부] ${discoveryFallbackEnabled ? "활성" : "비활성"}`
  );
  console.log(
    `[discovery 원문 URL 필수] ${discoveryRequireOriginalUrl ? "예" : "아니오"}`
  );
  if (shouldUseDiscovery) {
    console.log(
      `[discovery fallback 실행] 강한 연결 primary ${primaryStrongCandidateCount}건 / 국내 ${primaryStrongDomesticCount}건`
    );
    discoveryResults = await Promise.all(discoveryFeeds.map(fetchSource));
    discoveryFetched = discoveryResults
      .flatMap((result) => result.entries)
      .slice(0, discoveryMaxTotalResults);
    discoveryNormalized = discoveryFetched
      .map((entry) =>
        normalizeFeedItem(
          entry,
          rangeFrom,
          rangeTo,
          includeUnlisted,
          diagnostics,
          candidateAudit,
          sourceRecoveryCandidates
        )
      )
      .filter(Boolean)
      .sort(compareForDedup);
  } else if (discoveryFallbackEnabled) {
    console.log(
      `[discovery fallback 생략] 강한 연결 primary ${primaryStrongCandidateCount}건 / 국내 ${primaryStrongDomesticCount}건`
    );
  } else {
    console.log("[discovery fallback 생략] ENABLE_DISCOVERY_FALLBACK=false");
  }

  const sourceResults = [...primaryResults, ...discoveryResults];
  const fetched = [...primaryFetched, ...discoveryFetched];
  const normalized = [...primaryNormalized, ...discoveryNormalized].sort(compareForDedup);
  const recoveryNormalized = deduplicateArticles(sourceRecoveryCandidates).sort(compareForDedup);
  const deduplicated = deduplicateArticles([...normalized, ...recoveryNormalized]).sort(
    compareForOutput
  );
  const primaryPool = deduplicated.filter((article) => article.feedPriority === "primary");
  const discoveryPool = deduplicated.filter((article) => article.feedPriority !== "primary");
  const selected = fillCandidatesByPriority(
    primaryPool,
    shouldUseDiscovery ? discoveryPool : [],
    candidateItemsPerCategory,
    maxExtractionCandidates
  );
  const selectedCandidateKeys = new Set(
    selected.map((article) => candidateAuditKey(article.title, article.url))
  );
  for (const article of deduplicated) {
    if (!selectedCandidateKeys.has(candidateAuditKey(article.title, article.url))) {
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason:
          article.provisionalExcludeReason ||
          "preselection_rank_or_category_limit",
      });
    }
  }

  console.log(`[primary 직접 수집 기사 수] ${primaryFetched.length}건`);
  console.log(`[Google News RSS 수집 기사 수] ${discoveryFetched.length}건`);
  console.log(`[discovery 후보 수] ${discoveryNormalized.length}건`);
  console.log(`[전체 수집 원본 기사 수] ${fetched.length}건`);
  if (!sourceResults.some((result) => result.succeeded)) {
    console.warn(
      "[직접 소스 전체 실패] 모든 RSS·목록 소스에 연결하지 못했습니다. 빈 결과 저장 안전장치로 기존 데이터를 보존합니다."
    );
  }
  console.log(`[1차 키워드 필터 통과 수] ${diagnostics.keywordFilterPassedCount}건`);
  console.log(`[넓은 후보 수] ${diagnostics.broadCandidateCount}건`);
  console.log(`[출처 필터 통과 수] ${diagnostics.sourceFilterPassedCount}건`);
  console.log(`[source_not_allowed 보충 후보 수] ${recoveryNormalized.length}건`);
  console.log(`[관련성 점수 미달로 제외] ${diagnostics.relevanceScoreExcludedCount}건`);
  console.log(`[일반 산업 기사로 제외] ${diagnostics.generalIndustryExcludedCount}건`);
  console.log(`[칼럼·조언·전망 기사로 제외] ${diagnostics.lowValueEditorialExcludedCount}건`);
  console.log(`[해외 VC 사건 키워드 미달로 제외] ${diagnostics.overseasVcSignalExcludedCount}건`);
  console.log(`[증시·주가 기사로 제외] ${diagnostics.stockMarketExcludedCount}건`);
  console.log(`[생태계 연결 부족으로 제외] ${diagnostics.ecosystemLinkMissingCount}건`);
  console.log(`[중복 제거 후 기사 수] ${deduplicated.length}건`);
  console.log(`[본문 추출 후보 수] ${selected.length}건`);
  console.log(
    `[명확한 사건 preselection 보호] ${selected.filter(isProtectedPreselectionCandidate).length}건`
  );
  console.log(`[국내 후보 수] ${selected.filter((article) => article.isDomestic).length}건`);
  console.log(`[해외 후보 수] ${selected.filter((article) => !article.isDomestic).length}건`);
  console.log(`[카테고리별 후보 수] ${categoryCountSummary(selected)}`);
  console.log(
    `[전체 직접 원문 URL 기사 수] ${selected.filter((article) => !article.googleNewsUrl).length}건`
  );
  console.log(
    `[Google News 중계 URL 기사 수] ${selected.filter((article) => article.googleNewsUrl).length}건`
  );
  for (const result of sourceResults) {
    const passed = normalized.filter(
      (article) => article.feedName === result.feed.name
    ).length;
    console.log(
      `[source 통계] ${sourceStatsKey(result.feed)} | 방식 ${result.feed.type} | 원본 ${result.rawCount}건 | 필터 통과 ${passed}건`
    );
  }

  const useFullTextExtraction = /^true$/i.test(
    process.env.USE_FULL_TEXT_EXTRACTION || "true"
  );
  const articleFetchConcurrency = readPositiveInteger(
    process.env.MAX_ARTICLE_FETCH_CONCURRENCY,
    3
  );
  const articleFetchTimeoutMs = readPositiveInteger(
    process.env.ARTICLE_FETCH_TIMEOUT_MS,
    8_000
  );
  const minArticleTextLength = readPositiveInteger(
    process.env.MIN_ARTICLE_TEXT_LENGTH,
    300
  );
  const maxTitleFallbackItems =
    String(process.env.MAX_TITLE_FALLBACK_ITEMS || "0").trim() === "1" ? 1 : 0;
  const openAIDescriptionMaxItems = readNonNegativeInteger(
    process.env.OPENAI_DESCRIPTION_MAX_ITEMS,
    6
  );
  const openAIBodyMaxItems = readNonNegativeInteger(
    process.env.OPENAI_BODY_MAX_ITEMS,
    8
  );
  const forceSaveEmpty = /^true$/i.test(process.env.FORCE_SAVE_EMPTY || "false");

  let extractionSuccessCount = 0;
  let extractionFailureCount = 0;
  let googleResolveSuccessCount = 0;
  let googleResolveFailureCount = 0;
  const extractionFailureReasons = new Map();
  const extractionFailuresByFeed = new Map();
  const extractionStatsBySource = new Map();
  const enrichedArticles = (useFullTextExtraction
      ? await mapWithConcurrency(selected, articleFetchConcurrency, async (article) => {
        const publisherConfig = article.googleNewsUrl
          ? publisherSourceConfig(article.source)
          : null;
        const extraction = await extractArticle(article.url, {
          allowedUrlPatterns: publisherConfig?.allowedUrlPatterns,
          bodySelector: publisherConfig?.bodySelector || article.sourceConfig?.bodySelector,
          minTextLength: minArticleTextLength,
          prefetchedHtml: article.prefetchedHtml,
          publisherBaseUrl: publisherConfig?.baseUrl || article.publisherBaseUrl,
          publisherSearchUrl: publisherConfig?.searchUrl,
          removeSelectors:
            publisherConfig?.removeSelectors || article.sourceConfig?.removeSelectors,
          timeoutMs: articleFetchTimeoutMs,
          title: article.title,
        });
        const extractionKey = sourceStatsKey(
          article.sourceConfig || { sourceName: article.source, type: "unknown" }
        );
        const sourceExtractionStats = extractionStatsBySource.get(extractionKey) || {
          success: 0,
          failure: 0,
        };
        if (extraction.text) extractionSuccessCount += 1;
        else {
          extractionFailureCount += 1;
          const reason = extraction.failureReason || "unknown";
          extractionFailureReasons.set(reason, (extractionFailureReasons.get(reason) || 0) + 1);
          const feedFailure = `${article.feedName}: ${reason}`;
          extractionFailuresByFeed.set(
            feedFailure,
            (extractionFailuresByFeed.get(feedFailure) || 0) + 1
          );
        }
        if (extraction.text) sourceExtractionStats.success += 1;
        else sourceExtractionStats.failure += 1;
        extractionStatsBySource.set(extractionKey, sourceExtractionStats);
        if (article.googleNewsUrl && extraction.resolutionStatus === "resolved") {
          googleResolveSuccessCount += 1;
        }
        if (article.googleNewsUrl && extraction.resolutionStatus === "failed") {
          googleResolveFailureCount += 1;
        }
        return {
          ...article,
          extractedArticleText: extraction.text,
          extractionFailureReason: extraction.failureReason,
          resolvedUrl: extraction.resolvedUrl,
          resolutionStatus: extraction.resolutionStatus,
          prefetchedHtml: null,
        };
      })
    : selected.map((article) => ({
        ...article,
        extractedArticleText: null,
        extractionFailureReason: null,
        resolvedUrl: null,
        resolutionStatus: "not_attempted",
        prefetchedHtml: null,
      }))).map((article) => ({
        ...article,
        score:
          article.score +
          calculateBodyPriorityAdjustment(article.extractedArticleText || ""),
      }));

  for (const article of enrichedArticles) {
    const strongAnalysis = evaluateStrongConnectionArticle({
      title: article.title,
      description: article.description,
      articleBody: article.extractedArticleText || "",
      isDomestic: article.isDomestic,
      categoryHints: article.feedCategories || [],
    });
    const bodySignals = collectMatchedSignals(
      article.title,
      article.description,
      article.extractedArticleText || ""
    );
    article.matchedSignals = [...new Set([...(article.matchedSignals || []), ...bodySignals])];
    article.includeReason = article.matchedSignals.slice(0, 5).join(", ");
    if (!article.strongConnectionType && strongAnalysis.strongConnectionType) {
      article.score += 24;
    }
    article.strongConnectionType = strongAnalysis.strongConnectionType;
    article.isPublicCompanyOrLargeCorp = strongAnalysis.isPublicCompanyOrLargeCorp;
    article.isGeneralIndustry = strongAnalysis.isGeneralIndustry;
    article.isStartupEcosystemRelated = strongAnalysis.isStartupEcosystemRelated;
    article.missingSignals = strongAnalysis.missingSignals;
    article.category = strongAnalysis.category;
    const postExtractionExcludeReason = strongAnalysis.excludeReason;
    article.postExtractionExcludeReason = postExtractionExcludeReason;
    if (postExtractionExcludeReason === "public_company_or_large_corp_general") {
      diagnostics.publicCompanyOrLargeCorpExcludedCount += 1;
    } else if (postExtractionExcludeReason === "general_industry_article") {
      diagnostics.generalIndustryExcludedCount += 1;
    } else if (postExtractionExcludeReason === "strong_connection_missing") {
      diagnostics.ecosystemLinkMissingCount += 1;
    }
    if (!postExtractionExcludeReason && strongAnalysis.strongConnectionType) {
      diagnostics.strongConnectionPassedCount += 1;
    }
    updateCandidateAuditRecord(candidateAudit, article, {
      relevanceScore: article.score,
      includeReason: article.includeReason,
      matchedSignals: article.matchedSignals,
      category: article.category,
      excludeReason: postExtractionExcludeReason,
      ...strongAnalysis,
    });
  }
  const eligibleEnrichedArticles = enrichedArticles.filter(
    (article) => !article.postExtractionExcludeReason
  );

  console.log(
    `[본문 추출 성공] ${extractionSuccessCount}건 / [본문 추출 실패] ${extractionFailureCount}건`
  );
  console.log(`[Google News resolve 성공] ${googleResolveSuccessCount}건`);
  console.log(`[Google News resolve 실패] ${googleResolveFailureCount}건`);
  console.log(`[원문 URL resolve 성공 수] ${googleResolveSuccessCount}건`);
  console.log(`[원문 URL resolve 실패 수] ${googleResolveFailureCount}건`);
  if (selected.some((article) => article.googleNewsUrl) && googleResolveSuccessCount === 0) {
    console.warn(
      "[discovery 경고] Google News 원문 URL resolve 성공이 0건입니다. 원문을 찾지 못한 discovery 후보는 최종 저장하지 않습니다."
    );
  }
  const extractionAttemptCount = extractionSuccessCount + extractionFailureCount;
  const extractionSuccessRate = extractionAttemptCount
    ? ((extractionSuccessCount / extractionAttemptCount) * 100).toFixed(1)
    : "0.0";
  console.log(`[본문 추출 성공률] ${extractionSuccessRate}%`);
  for (const [source, stats] of extractionStatsBySource) {
    console.log(
      `[source 본문] ${source} | 성공 ${stats.success}건 | 실패 ${stats.failure}건`
    );
  }
  if (extractionFailureReasons.size) {
    console.log(
      `[본문 추출 실패 사유] ${[...extractionFailureReasons.entries()]
        .map(([reason, count]) => `${reason}=${count}`)
        .join(", ")}`
    );
  }
  if (extractionFailuresByFeed.size) {
    console.log(
      `[본문 추출 실패 소스] ${[...extractionFailuresByFeed.entries()]
        .map(([feed, count]) => `${feed}=${count}`)
        .join(", ")}`
    );
  }
  if (!useFullTextExtraction) console.log(`[본문 추출 미시도] ${selected.length}건`);
  console.log(`[강한 연결 조건 통과 수] ${diagnostics.strongConnectionPassedCount}건`);
  console.log(
    `[상장사/대기업 일반 기사 제외 수] ${diagnostics.publicCompanyOrLargeCorpExcludedCount}건`
  );

  const items = [];
  let openAISummaryAttemptCount = 0;
  let openAISummarySuccessCount = 0;
  let openAISummaryFailureCount = 0;
  let openAIBodyAttemptCount = 0;
  let openAIBodySuccessCount = 0;
  let openAIBodyFailureCount = 0;
  let openAIDescriptionAttemptCount = 0;
  let openAIDescriptionSuccessCount = 0;
  let openAIDescriptionFailureCount = 0;
  let openAIDescriptionValidationPassedCount = 0;
  let openAIDescriptionSimilarityExcludedCount = 0;
  let openAIDescriptionEventExcludedCount = 0;
  let localFallbackCount = 0;
  let extractiveBodySummaryAttemptCount = 0;
  let descriptionFallbackAttemptCount = 0;
  let titleFallbackAttemptCount = 0;
  let extractiveBodySummarySavedCount = 0;
  let openAIBodySummarySavedCount = 0;
  let openAIDescriptionSummarySavedCount = 0;
  let descriptionFallbackSavedCount = 0;
  let titleFallbackSavedCount = 0;
  let savedTitleFallbackCount = 0;
  let titleFallbackLimitExcludedCount = 0;
  let similarTitleSummaryExcludedCount = 0;
  let similarCandidateRetryCount = 0;
  let metadataSentenceExcludedCount = 0;
  let fallbackQualityExcludedCount = 0;
  let nounPhraseSummaryExcludedCount = 0;
  let otherQualityExcludedCount = 0;
  let openAICacheHitCount = 0;
  const openAISummaryRequested = /^true$/i.test(
    process.env.USE_OPENAI_SUMMARY || "false"
  );
  const openAISummaryEnabled =
    openAISummaryRequested && Boolean(process.env.OPENAI_API_KEY);
  if (openAISummaryRequested && !process.env.OPENAI_API_KEY) {
    console.warn(
      "[OpenAI 요약 건너뜀] OPENAI_API_KEY가 없어 local_extractive 요약을 사용합니다."
    );
  }

  const summaryProcessingArticles = [...eligibleEnrichedArticles].sort((left, right) => {
    const leftHasBody = Array.from(cleanText(left.extractedArticleText || "")).length >= 300;
    const rightHasBody = Array.from(cleanText(right.extractedArticleText || "")).length >= 300;
    return Number(rightHasBody) - Number(leftHasBody);
  });
  const openAIBodyCandidates = summaryProcessingArticles.filter(
    (article) =>
      Array.from(cleanText(article.extractedArticleText || "")).length >= 300
  );
  const allowedOpenAIBodyArticles = new Set(
    openAIBodyCandidates.slice(0, openAIBodyMaxItems)
  );
  const openAIBodyLimitSkippedCount = Math.max(
    0,
    openAIBodyCandidates.length - allowedOpenAIBodyArticles.size
  );
  const openAIDescriptionCandidates = summaryProcessingArticles.filter((article) => {
    const hasBody = Array.from(cleanText(article.extractedArticleText || "")).length >= 300;
    return !hasBody && isOpenAIDescriptionEligible(article.title, article.description);
  });
  const allowedOpenAIDescriptionArticles = new Set(
    openAIDescriptionCandidates.slice(0, openAIDescriptionMaxItems)
  );
  const openAIDescriptionLimitSkippedCount = Math.max(
    0,
    openAIDescriptionCandidates.length - allowedOpenAIDescriptionArticles.size
  );

  for (const article of summaryProcessingArticles) {
    try {
    if (article.googleNewsUrl && article.resolutionStatus !== "resolved") {
      diagnostics.discoveryUrlUnresolvedCount += 1;
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: "discovery_original_url_unresolved",
      });
      article.extractedArticleText = null;
      continue;
    }

    const hardExcludeReason = finalHardExcludeReason({
      title: article.title,
      description: article.description,
      articleBody: article.extractedArticleText || "",
    });
    if (hardExcludeReason) {
      diagnostics.finalHardExcludedCount += 1;
      console.warn(`[최종 hard exclude] ${hardExcludeReason} | ${article.title}`);
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: hardExcludeReason,
      });
      article.extractedArticleText = null;
      continue;
    }
    const hasBody = Array.from(cleanText(article.extractedArticleText || "")).length >= 300;
    const desiredOpenAISource = hasBody
      ? "openai_body"
      : isOpenAIDescriptionEligible(article.title, article.description)
        ? "openai_description"
        : null;
    const cachedSummary =
      openAISummaryEnabled && desiredOpenAISource
        ? findCachedSummary(summaryCache, article, desiredOpenAISource)
        : null;
    let summaryResult;
    if (cachedSummary) {
      openAICacheHitCount += 1;
      console.log(`[OpenAI cache hit] ${cachedSummary.summarySource} | ${article.title}`);
      summaryResult = {
        summary: cachedSummary.summary,
        summarySource: cachedSummary.summarySource,
        metaRejectedCount: 0,
        similarRejectedCount: 0,
        openAIAttempted: false,
        openAISucceeded: false,
        openAIFailed: false,
        openAIBodyAttempted: false,
        openAIBodySucceeded: false,
        openAIBodyFailed: false,
        openAIDescriptionAttempted: false,
        openAIDescriptionSucceeded: false,
        openAIDescriptionFailed: false,
        usedLocalFallback: false,
        usedOpenAI: true,
        cacheHit: true,
      };
    } else {
      summaryResult = await summarizeArticleSafely(article, {
        allowOpenAIBody: allowedOpenAIBodyArticles.has(article),
        allowOpenAIDescription: allowedOpenAIDescriptionArticles.has(article),
      });
    }
    if (summaryResult.openAIAttempted) openAISummaryAttemptCount += 1;
    if (summaryResult.openAISucceeded) openAISummarySuccessCount += 1;
    if (summaryResult.openAIFailed) openAISummaryFailureCount += 1;
    if (summaryResult.openAIBodyAttempted) openAIBodyAttemptCount += 1;
    if (summaryResult.openAIBodySucceeded) openAIBodySuccessCount += 1;
    if (summaryResult.openAIBodyFailed) openAIBodyFailureCount += 1;
    if (summaryResult.openAIDescriptionAttempted) openAIDescriptionAttemptCount += 1;
    if (summaryResult.openAIDescriptionSucceeded) openAIDescriptionSuccessCount += 1;
    if (summaryResult.openAIDescriptionFailed) openAIDescriptionFailureCount += 1;
    if (summaryResult.usedLocalFallback) localFallbackCount += 1;
    metadataSentenceExcludedCount += summaryResult.metaRejectedCount || 0;
    similarCandidateRetryCount += summaryResult.similarRejectedCount || 0;
    if (["local_extractive", "extractive_body"].includes(summaryResult.summarySource)) {
      extractiveBodySummaryAttemptCount += 1;
    }
    if (summaryResult.summarySource === "description") descriptionFallbackAttemptCount += 1;
    if (summaryResult.summarySource === "titleFallback") titleFallbackAttemptCount += 1;

    const isOpenAIDescription = summaryResult.summarySource === "openai_description";
    const isLocalExtractive = summaryResult.summarySource === "local_extractive";
    let quality = validateSummaryQuality(article.title, summaryResult.summary, {
      maxLength: isOpenAIDescription ? 120 : 100,
      maxSimilarity: isOpenAIDescription ? 1.01 : isLocalExtractive ? 0.97 : 0.8,
      requireStructured: summaryResult.summarySource === "titleFallback",
    });
    if (isOpenAIDescription && quality.isValid) {
      const descriptionQuality = validateOpenAIDescriptionSummary({
        title: article.title,
        summary: summaryResult.summary,
        source: article.source,
      });
      if (descriptionQuality.isValid) {
        openAIDescriptionValidationPassedCount += 1;
      } else {
        const similarityReasons = new Set([
          "openai_description_same_as_title",
          "openai_description_particle_only_rewrite",
        ]);
        if (similarityReasons.has(descriptionQuality.reason)) {
          openAIDescriptionSimilarityExcludedCount += 1;
        } else {
          openAIDescriptionEventExcludedCount += 1;
        }
        console.warn(
          `[OpenAI description 검증 제외] ${descriptionQuality.reason} | ${article.title} | ${summaryResult.summary}`
        );
        updateCandidateAuditRecord(candidateAudit, article, {
          excludeReason: `summary_${descriptionQuality.reason}`,
        });
        article.extractedArticleText = null;
        continue;
      }
    } else if (isOpenAIDescription && !quality.isValid) {
      openAIDescriptionEventExcludedCount += 1;
      console.warn(
        `[OpenAI description 검증 제외] ${quality.reason} | ${article.title} | ${summaryResult.summary}`
      );
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: `summary_${quality.reason}`,
      });
      article.extractedArticleText = null;
      continue;
    }
    if (
      !quality.isValid &&
      quality.reason === "title_summary_too_similar" &&
      summaryResult.summarySource === "description" &&
      savedTitleFallbackCount < maxTitleFallbackItems
    ) {
      const fallbackSummary = summarizeTitleFallback(article.title);
      const fallbackQuality = validateSummaryQuality(article.title, fallbackSummary, {
        maxLength: 100,
        maxSimilarity: 0.8,
        requireStructured: true,
      });
      titleFallbackAttemptCount += 1;
      if (fallbackQuality.isValid) {
        console.warn(`[description 재구성] title fallback 사용 | ${article.title}`);
        summaryResult = {
          ...summaryResult,
          summary: fallbackSummary,
          summarySource: "titleFallback",
        };
        quality = fallbackQuality;
      }
    }

    const fallbackQuality = validateFallbackSummaryQuality({
      title: article.title,
      summary: summaryResult.summary,
      source: article.source,
      summarySource: summaryResult.summarySource,
    });
    if (!fallbackQuality.isValid) {
      if (fallbackQuality.reason === "noun_phrase_summary") {
        nounPhraseSummaryExcludedCount += 1;
      } else {
        fallbackQualityExcludedCount += 1;
      }
      console.warn(
        `[fallback 품질 제외] ${fallbackQuality.reason} | ${article.title} | ${summaryResult.summary}`
      );
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: `summary_${fallbackQuality.reason}`,
      });
      article.extractedArticleText = null;
      continue;
    }

    if (
      summaryResult.summarySource === "titleFallback" &&
      savedTitleFallbackCount >= maxTitleFallbackItems &&
      !EXPLICIT_STARTUP_PARTNERSHIP_SUPPORT_PATTERN.test(article.title)
    ) {
      titleFallbackLimitExcludedCount += 1;
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: "title_fallback_limit",
      });
      article.extractedArticleText = null;
      continue;
    }

    if (!quality.isValid) {
      if (quality.reason === "title_summary_too_similar") {
        similarTitleSummaryExcludedCount += 1;
      } else if (quality.reason === "summary_contains_metadata") {
        metadataSentenceExcludedCount += 1;
      } else {
        otherQualityExcludedCount += 1;
      }
      console.warn(
        `[요약 품질 제외] ${quality.reason} / 유사도 ${quality.similarity.toFixed(3)} | ${article.title}`
      );
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: `summary_${quality.reason}`,
      });
      article.extractedArticleText = null;
      continue;
    }

    const finalSummaryHardExcludeReason = finalHardExcludeReason({
      title: article.title,
      description: article.description,
      articleBody: article.extractedArticleText || "",
      summary: summaryResult.summary,
    });
    if (finalSummaryHardExcludeReason) {
      diagnostics.finalHardExcludedCount += 1;
      console.warn(
        `[최종 hard exclude] ${finalSummaryHardExcludeReason} | ${article.title}`
      );
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: finalSummaryHardExcludeReason,
      });
      article.extractedArticleText = null;
      continue;
    }

    if (
      !summaryResult.cacheHit &&
      summaryResult.usedOpenAI &&
      ["openai_body", "openai_description"].includes(summaryResult.summarySource)
    ) {
      addSummaryCacheEntry(summaryCache, article, summaryResult);
    }

    if (summaryResult.summarySource === "titleFallback") savedTitleFallbackCount += 1;
    if (["local_extractive", "extractive_body"].includes(summaryResult.summarySource)) {
      extractiveBodySummarySavedCount += 1;
    }
    const finalItem = {
      id: createArticleId(article),
      category: article.category,
      title: article.title,
      publishedAt: formatKstDate(article.publishedAt),
      summary: summaryResult.summary,
      summarySource: summaryResult.summarySource,
      summaryType: summaryResult.summarySource,
      source: article.source,
      url: article.resolvedUrl || article.url,
      resolvedUrl:
        article.resolutionStatus === "resolved" ? article.resolvedUrl : null,
      _isDomestic: article.isDomestic,
      _strongConnectionType: article.strongConnectionType,
      _sourceAllowed: article._sourceAllowed !== false,
      _sourceRecovery: Boolean(article._sourceRecovery),
      score:
        summaryResult.summarySource === "titleFallback"
          ? Math.max(0, article.score - 5)
          : article.googleNewsUrl && article.resolutionStatus === "failed"
            ? Math.max(0, article.score - 8)
            : article.score,
    };
    const finalItemQuality = validateFinalArticleItem(finalItem);
    if (!finalItemQuality.isValid) {
      otherQualityExcludedCount += 1;
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: finalItemQuality.reason,
      });
      article.extractedArticleText = null;
      continue;
    }
    items.push(finalItem);

    article.extractedArticleText = null;
    } catch (error) {
      otherQualityExcludedCount += 1;
      console.warn(`[기사 처리 오류] ${article.title}: ${error.message}`);
      updateCandidateAuditRecord(candidateAudit, article, {
        excludeReason: `article_processing_error:${error.name || "Error"}`,
      });
      article.extractedArticleText = null;
      continue;
    }
  }

  const summarySourcePriority = {
    openai_body: 5,
    openai_description: 4,
    local_extractive: 3,
    extractive_body: 3,
    description: 2,
    titleFallback: 1,
  };
  const finalHardSafeItems = items.filter((item) => {
    const reason = finalHardExcludeReason(item);
    if (!reason) return true;
    diagnostics.finalHardExcludedCount += 1;
    updateCandidateAuditRecord(candidateAudit, item, { excludeReason: reason });
    return false;
  });
  const eventDeduplication = deduplicateSummarizedItems(
    finalHardSafeItems,
    summarySourcePriority
  );
  const finalSelection = selectFinalBriefingItems(eventDeduplication.items, {
    minDomestic: minDomesticArticles,
    minFinal: minFinalArticles,
    maxFinal: maxFinalArticles,
    maxPerCategory: maxItemsPerCategory,
  });
  const finalSelectedIds = new Set(finalSelection.items.map((item) => item.id));
  for (const item of eventDeduplication.items) {
    updateCandidateAuditRecord(candidateAudit, item, {
      excludeReason: finalSelectedIds.has(item.id)
        ? null
        : "final_rank_or_category_limit",
    });
  }
  for (const duplicate of eventDeduplication.removed) {
    updateCandidateAuditRecord(candidateAudit, duplicate, {
      excludeReason: `duplicate_event:${duplicate.reason}`,
    });
  }
  const openAIRequestStats = getOpenAIRequestMetrics();
  items.length = 0;
  items.push(...finalSelection.items);
  openAIBodySummarySavedCount = items.filter(
    (item) => item.summarySource === "openai_body"
  ).length;
  openAIDescriptionSummarySavedCount = items.filter(
    (item) => item.summarySource === "openai_description"
  ).length;
  extractiveBodySummarySavedCount = items.filter(
    (item) => ["local_extractive", "extractive_body"].includes(item.summarySource)
  ).length;
  descriptionFallbackSavedCount = items.filter(
    (item) => item.summarySource === "description"
  ).length;
  titleFallbackSavedCount = items.filter(
    (item) => item.summarySource === "titleFallback"
  ).length;
  items.sort(
    (left, right) =>
      (summarySourcePriority[right.summarySource] || 0) -
        (summarySourcePriority[left.summarySource] || 0) ||
      right.score - left.score ||
      right.publishedAt.localeCompare(left.publishedAt)
  );
  for (const item of items) {
    delete item._isDomestic;
    delete item._strongConnectionType;
    delete item._sourceAllowed;
    delete item._sourceRecovery;
  }

  console.log(
    `[OpenAI body 요약] 시도 ${openAIBodyAttemptCount}건 / 성공 ${openAIBodySuccessCount}건 / 실패 ${openAIBodyFailureCount}건`
  );
  console.log(`[OpenAI body 후보] ${openAIBodyCandidates.length}건`);
  console.log(`[OpenAI body 실제 시도] ${openAIBodyAttemptCount}건`);
  console.log(`[OPENAI_BODY_MAX_ITEMS] ${openAIBodyMaxItems}건`);
  console.log(
    `[OpenAI body 상한 제외] ${openAIBodyLimitSkippedCount}건`
  );
  console.log(
    `[OPENAI_ARTICLE_TEXT_MAX_CHARS] ${openAIRequestStats.articleTextMaxChars}자`
  );
  console.log(
    `[OpenAI description 요약] 시도 ${openAIDescriptionAttemptCount}건 / API 성공 ${openAIDescriptionSuccessCount}건 / 실패 ${openAIDescriptionFailureCount}건`
  );
  console.log(
    `[OpenAI description 검증 통과] ${openAIDescriptionValidationPassedCount}건`
  );
  console.log(
    `[OpenAI description 제목 유사 제외] ${openAIDescriptionSimilarityExcludedCount}건`
  );
  console.log(
    `[OpenAI description 사건 부족 제외] ${openAIDescriptionEventExcludedCount}건`
  );
  console.log(`[OpenAI 실제 API 호출] ${openAIRequestStats.totalCalls}건`);
  console.log(`[OpenAI 캐시 hit] ${openAICacheHitCount}건`);
  console.log(`[OpenAI daily budget] ${openAIRequestStats.dailyCallBudget}건`);
  console.log(
    `[OpenAI daily budget 초과 스킵] ${openAIRequestStats.budgetSkippedCount}건`
  );
  console.log(`[OpenAI description 후보] ${openAIDescriptionCandidates.length}건`);
  console.log(
    `[OpenAI description 상한 제외] ${openAIDescriptionLimitSkippedCount}건 / 최대 ${openAIDescriptionMaxItems}건`
  );
  console.log(
    `[OpenAI description 실제 API 호출] ${openAIRequestStats.descriptionCalls}건`
  );
  console.log(`[OpenAI 요청 딜레이] ${openAIRequestStats.requestDelayMs}ms`);
  console.log(
    `[OpenAI TPM 발생] ${openAIRequestStats.tpmLimitReached || openAIRequestStats.tpmRateLimitCount > 0 ? "예" : "아니오"}`
  );
  console.log(
    `[OpenAI TPM retryAfter] ${openAIRequestStats.tpmRetryAfterSeconds === null ? "없음" : `${openAIRequestStats.tpmRetryAfterSeconds.toFixed(2)}초`}`
  );
  console.log(`[TPM 발생 후 스킵] ${openAIRequestStats.tpmSkippedCount}건`);
  if (openAIRequestStats.tpmLimitReached) {
    console.warn(
      `[OpenAI 호출 중단] 남은 body 요약 ${openAIRequestStats.tpmBodySkippedCount}건 스킵`
    );
  }
  console.log(
    `[OpenAI RPD 발생] ${openAIRequestStats.dailyLimitReached ? "예" : "아니오"}`
  );
  console.log(`[RPD 발생 후 스킵] ${openAIRequestStats.rpdSkippedCount}건`);
  if (openAIRequestStats.dailyLimitReached) {
    console.warn(
      `[OpenAI 호출 중단] 남은 description 요약 ${openAIRequestStats.rpdDescriptionSkippedCount}건 스킵`
    );
  }
  console.log(`[OpenAI RPM 429 발생] ${openAIRequestStats.rpmRateLimitCount}건`);
  console.log(
    `[OpenAI RPM 발생 여부] ${openAIRequestStats.rpmRateLimitCount > 0 ? "예" : "아니오"}`
  );
  console.log(
    `[OpenAI RPM 429 재시도 성공] ${openAIRequestStats.rpmRetrySuccessCount}건`
  );
  console.log(
    `[OpenAI RPM 429 최종 실패] ${openAIRequestStats.rpmFinalFailureCount}건`
  );
  console.log(`[로컬 fallback 요약] ${localFallbackCount}건`);
  console.log(
    `[local_extractive 저장] ${extractiveBodySummarySavedCount}건 / 시도 ${extractiveBodySummaryAttemptCount}건`
  );
  console.log(`[openai_body 저장] ${openAIBodySummarySavedCount}건`);
  console.log(`[openai_description 저장] ${openAIDescriptionSummarySavedCount}건`);
  console.log(
    `[description fallback 최종 저장] ${descriptionFallbackSavedCount}건 / 시도 ${descriptionFallbackAttemptCount}건`
  );
  console.log(
    `[titleFallback 최종 저장] ${titleFallbackSavedCount}건 / 시도 ${titleFallbackAttemptCount}건 / 한도 제외 ${titleFallbackLimitExcludedCount}건`
  );
  console.log(`[fallback 품질 미달 제외] ${fallbackQualityExcludedCount}건`);
  console.log(`[명사구 요약 제외] ${nounPhraseSummaryExcludedCount}건`);
  console.log(`[사건 중복 제거] ${eventDeduplication.removed.length}건`);
  for (const duplicate of eventDeduplication.removed) {
    console.log(
      `[중복 제거 기사] ${duplicate.title} | 유지: ${duplicate.keptTitle} | 사유: ${duplicate.reason}`
    );
  }
  console.log(
    `[title-summary 유사로 제외] ${similarTitleSummaryExcludedCount}건 / 다른 문장 재시도 ${similarCandidateRetryCount}건`
  );
  console.log(`[메타 문구 포함으로 제외] ${metadataSentenceExcludedCount}건`);
  if (otherQualityExcludedCount) {
    console.log(`[기타 요약 품질 제외] ${otherQualityExcludedCount}건`);
  }
  console.log(`[점수 기반 최종 후보 수] ${eventDeduplication.items.length}건`);
  console.log(`[국내 최종 통과 수] ${finalSelection.domesticCount}건`);
  console.log(`[해외 최종 통과 수] ${finalSelection.overseasCount}건`);
  console.log(`[카테고리별 최종 통과 수] ${categoryCountSummary(items)}`);
  console.log(
    `[제외 사유별 건수] broad_signal_missing=${diagnostics.keywordExcludedCount}, ecosystem_link_missing=${diagnostics.ecosystemLinkMissingCount}, stock_market_noise=${diagnostics.stockMarketExcludedCount}, general_industry=${diagnostics.generalIndustryExcludedCount}, editorial=${diagnostics.lowValueEditorialExcludedCount}, overseas_signal_missing=${diagnostics.overseasVcSignalExcludedCount}, source_not_allowed=${diagnostics.sourceExcludedCount}, source_recovery_candidates=${diagnostics.sourceRecoveryCandidateCount}, discovery_unresolved=${diagnostics.discoveryUrlUnresolvedCount}, final_hard_exclude=${diagnostics.finalHardExcludedCount}, preselection_limit=${Math.max(0, deduplicated.length - selected.length)}, summary_quality=${fallbackQualityExcludedCount + nounPhraseSummaryExcludedCount + otherQualityExcludedCount}, final_rank_or_category_limit=${Math.max(0, eventDeduplication.items.length - items.length)}`
  );
  console.log(
    `[보충 로직 적용 여부] ${finalSelection.supplementalApplied ? "적용" : finalSelection.supplementalAttempted ? "후보 없음" : "목표 충족으로 불필요"}`
  );
  console.log(
    `[보충 로직 실행] ${finalSelection.supplementalAttempted ? "실행" : "목표 충족으로 불필요"}`
  );
  console.log(`[보충 추가 기사 수] ${finalSelection.supplementalCount}건`);
  console.log(
    `[source_not_allowed 보충 저장 수] ${finalSelection.sourceRecoverySupplementCount}건`
  );
  console.log(`[최종 hard exclude 수] ${diagnostics.finalHardExcludedCount}건`);
  if (
    finalSelection.supplementalAttempted &&
    finalSelection.supplementalNoCandidateReasons.length
  ) {
    console.warn(
      `[보충 후보 없음] ${finalSelection.supplementalNoCandidateReasons.join(", ")}`
    );
  }
  if (saveDebugCandidates) {
    const finalTitles = new Set(items.map((item) => normalizeForMatch(item.title)));
    for (const record of [...candidateAudit.values()]
      .filter((candidate) => finalTitles.has(normalizeForMatch(candidate.title)))
      .sort((left, right) => right.relevanceScore - left.relevanceScore)) {
      console.log(
        `[후보 평가] 포함 | score=${record.relevanceScore} | category=${record.category} | reason=${record.includeReason || "broad_context"} | ${record.title}`
      );
    }
    for (const record of [...candidateAudit.values()]
      .filter((candidate) => candidate.excludeReason)
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, 20)) {
      console.log(
        `[후보 평가] 제외 | score=${record.relevanceScore} | category=${record.category || "미분류"} | reason=${record.excludeReason} | ${record.title}`
      );
    }
  }
  console.log(`[최종 저장] ${items.length}건`);
  console.log(
    `[최종 저장 목표 달성 여부] ${items.length >= minFinalArticles && finalSelection.domesticCount >= minDomesticArticles ? "달성" : "미달"}`
  );
  for (const [index, item] of items.slice(0, 10).entries()) {
    console.log(
      `[최종 기사 ${index + 1}] ${item.title} | ${item.summary} | ${item.summarySource} | ${item.category} | ${item.source}`
    );
  }
  if (items.length > 0 && items.length < minFinalArticles) {
    console.warn(
      `[최종 저장 목표 미달] ${items.length}건 / 목표 최소 ${minFinalArticles}건. 직접 RSS 연결·본문 추출·요약 품질 로그를 확인하세요.`
    );
  }
  if (finalSelection.domesticCount < minDomesticArticles) {
    console.warn(
      `[국내 기사 목표 미달] ${finalSelection.domesticCount}건 / 목표 최소 ${minDomesticArticles}건`
    );
  }

  const categoryCounts = Object.fromEntries(
    Object.keys(categories).map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ])
  );
  const output = {
    generatedAt: formatKstIso(rangeTo),
    range: {
      from: formatKstIso(rangeFrom),
      to: formatKstIso(rangeTo),
    },
    totalCount: items.length,
    categoryCounts,
    items,
  };
  validateBriefingOutput(output);
  const generatedDate = formatKstDate(rangeTo);
  if (saveDebugCandidates) {
    try {
      const debugPath = await saveCandidateDebugReport(
        candidateAudit,
        generatedDate,
        items
      );
      console.log(`[후보 디버그 리포트] ${debugPath}`);
    } catch (error) {
      console.warn(`[후보 디버그 리포트 실패] ${error.message}`);
    }
  }
  try {
    await saveSummaryCache(summaryCache);
  } catch (error) {
    console.warn(`[OpenAI cache 저장 실패] ${error.message}`);
  }

  const exclusionStages = [
    ["날짜·필수값", diagnostics.metadataOrDateExcludedCount],
    ["키워드", diagnostics.keywordExcludedCount],
    ["관련성 점수", diagnostics.relevanceScoreExcludedCount],
    ["일반 산업 기사", diagnostics.generalIndustryExcludedCount],
    ["칼럼·조언·전망 기사", diagnostics.lowValueEditorialExcludedCount],
    ["해외 VC 사건 키워드", diagnostics.overseasVcSignalExcludedCount],
    ["출처", diagnostics.sourceExcludedCount],
    ["중복", Math.max(0, normalized.length - deduplicated.length)],
    ["사건 중복", eventDeduplication.removed.length],
    ["카테고리별 개수 제한", Math.max(0, deduplicated.length - selected.length)],
    ["title-summary 유사", similarTitleSummaryExcludedCount],
    ["title fallback 한도", titleFallbackLimitExcludedCount],
    ["fallback 품질", fallbackQualityExcludedCount],
    ["명사구 요약", nounPhraseSummaryExcludedCount],
    ["기타 요약 품질", otherQualityExcludedCount],
  ].sort((left, right) => right[1] - left[1]);

  if (!items.length) {
    const topExclusions = exclusionStages
      .filter(([, count]) => count > 0)
      .slice(0, 4)
      .map(([stage, count]) => `${stage} ${count}건`)
      .join(", ");
    console.warn(
      `[최종 0건 진단] ${topExclusions || "RSS 원본 또는 최종 후보가 없음"}`
    );
    if (!forceSaveEmpty) {
      console.warn(
        "[빈 결과 저장 취소] FORCE_SAVE_EMPTY=true가 아니므로 기존 data/news.json과 아카이브를 보존합니다."
      );
      return {
        saved: false,
        output,
        metrics: {
          ...diagnostics,
          extractionSuccessCount,
          extractionFailureCount,
          googleResolveSuccessCount,
          googleResolveFailureCount,
          openAISummaryAttemptCount,
          openAISummarySuccessCount,
          openAISummaryFailureCount,
          openAIBodyAttemptCount,
          openAIBodySuccessCount,
          openAIBodyFailureCount,
          openAIDescriptionAttemptCount,
          openAIDescriptionSuccessCount,
          openAIDescriptionFailureCount,
          openAIDescriptionValidationPassedCount,
          openAIDescriptionSimilarityExcludedCount,
          openAIDescriptionEventExcludedCount,
          openAICacheHitCount,
          openAIDescriptionCandidateCount: openAIDescriptionCandidates.length,
          openAIDescriptionLimitSkippedCount,
          openAIRequestStats,
          openAIBodySummarySavedCount,
          openAIDescriptionSummarySavedCount,
          eventDuplicateRemovedCount: eventDeduplication.removed.length,
          extractiveBodySummarySavedCount,
          descriptionFallbackSavedCount,
          titleFallbackSavedCount,
          similarTitleSummaryExcludedCount,
          fallbackQualityExcludedCount,
          nounPhraseSummaryExcludedCount,
        },
      };
    }
    console.warn("[빈 결과 강제 저장] FORCE_SAVE_EMPTY=true 설정에 따라 0건을 저장합니다.");
  }

  const { archivePath, archiveIndex } = await saveBriefing(output, generatedDate);
  console.log(`[저장 완료] ${OUTPUT_PATH} (${items.length}건)`);
  console.log(`[아카이브 저장] ${archivePath}`);
  console.log(`[아카이브 인덱스] ${archiveIndex.dates.length}일 / 최신 ${archiveIndex.latest}`);
  return {
    saved: true,
    output,
    metrics: {
      ...diagnostics,
      extractionSuccessCount,
      extractionFailureCount,
      googleResolveSuccessCount,
      googleResolveFailureCount,
      openAISummaryAttemptCount,
      openAISummarySuccessCount,
      openAISummaryFailureCount,
      openAIBodyAttemptCount,
      openAIBodySuccessCount,
      openAIBodyFailureCount,
      openAIDescriptionAttemptCount,
      openAIDescriptionSuccessCount,
      openAIDescriptionFailureCount,
      openAIDescriptionValidationPassedCount,
      openAIDescriptionSimilarityExcludedCount,
      openAIDescriptionEventExcludedCount,
      openAICacheHitCount,
      openAIDescriptionCandidateCount: openAIDescriptionCandidates.length,
      openAIDescriptionLimitSkippedCount,
      openAIRequestStats,
      openAIBodySummarySavedCount,
      openAIDescriptionSummarySavedCount,
      eventDuplicateRemovedCount: eventDeduplication.removed.length,
      extractiveBodySummarySavedCount,
      descriptionFallbackSavedCount,
      titleFallbackSavedCount,
      similarTitleSummaryExcludedCount,
      fallbackQualityExcludedCount,
      nounPhraseSummaryExcludedCount,
    },
  };
}

if (require.main === module) {
  collectNews().catch((error) => {
    console.error(`[치명적 오류] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeStrongConnection,
  normalizeCollectedUrl,
  calculateEditorialPriorityAdjustment,
  calculateRelevanceScore,
  collectMatchedSignals,
  collectNews,
  evaluateArticle,
  evaluateStrongConnectionArticle,
  finalHardExcludeReason,
  fillCandidatesByPriority,
  hasEcosystemKeyword,
  hasOverseasVcSignal,
  hasTechKeyword,
  isLowValueEditorialArticle,
  isStartupEcosystemRelevant,
  mapWithConcurrency,
  scoreArticle,
  selectFinalBriefingItems,
  summarizeArticleSafely,
  validateBriefingOutput,
};
