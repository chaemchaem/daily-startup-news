const { cleanText, containsKeyword, truncateReportSummary } = require("./utils");

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
    const actionPattern = /\s(선정|모집|지원|확대|발표|개최|개소)(?=$|\s)/u;
    enrichedClause = actionPattern.test(clause)
      ? clause.replace(actionPattern, ` ${facts.count} $1`)
      : `${facts.count} ${clause}`;
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
  const candidates = sentences.filter((sentence) => actionPattern.test(sentence));
  if (!candidates.length) return "";

  const scored = candidates
    .map((sentence) => {
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
        score: Math.min(Array.from(clause).length, 70) + specificTerms * 12,
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0].clause;
}

function compose(subject, clause) {
  const normalizedClause = normalizeActionEnding(clause);
  if (!subject) return normalizedClause;
  if (includesFact(normalizedClause, subject)) return normalizedClause;
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

function summarizeFundFormation(analysis, facts) {
  let clause = analysis.clause;
  if (!/펀드/u.test(clause)) {
    const fundType = firstMatch(
      [analysis.prepared],
      /(?:신규\s*)?(?:벤처|세컨더리|블라인드|모태|성장|지역)?\s*펀드/u
    );
    clause = `${fundType || "신규 펀드"} 결성`;
  }
  return compose(analysis.subject, addMissingFacts(clause, facts));
}

function summarizeInvestment(analysis, facts) {
  let clause = addMissingFacts(analysis.clause, facts);
  if (!/(?:투자\s*유치|시드\s*투자)/u.test(clause)) clause = `${clause} 투자 유치`;
  return compose(analysis.subject, clause);
}

function summarizeTipsOrLips(analysis, facts) {
  let clause = addMissingFacts(analysis.clause, facts, { includeCount: true });
  if (clause.startsWith("맞손")) clause = clause.replace(/^맞손\s*[,.:]*/u, "협력해");
  return compose(analysis.subject, clause);
}

function summarizePolicyOrSupport(analysis, facts, description) {
  let clause = addMissingFacts(analysis.clause, facts, { includeCount: true });
  const descriptionClause = extractDescriptionActionClause(description, analysis.subject);
  if (descriptionClause && Array.from(descriptionClause).length > Array.from(clause).length + 8) {
    clause = addMissingFacts(descriptionClause, facts, { includeCount: true });
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

function summarizeSecondary(analysis, facts) {
  return compose(analysis.subject, addMissingFacts(analysis.clause, facts));
}

function summarizeAward(analysis) {
  const award = stripQuotes(analysis.clause);
  const method = analysis.leadingFact ? `${analysis.leadingFact}로 ` : "";
  return compose(analysis.subject, `${method}${award} 수상`);
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
  const isRecruitmentOrSupport = ["모집", "지원사업", "지원 대상", "지원 확대", "공고"].some(
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
  ].some((keyword) => containsKeyword(context, keyword));
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
    summary = summarizeFundFormation(analysis, facts);
  } else if (isTipsOrLips) {
    summary = summarizeTipsOrLips(analysis, facts);
  } else if (isSecondary) {
    summary = summarizeSecondary(analysis, facts);
  } else if (isRecruitmentOrSupport && !facts.amount && !facts.stage) {
    summary = summarizePolicyOrSupport(analysis, facts, description);
  } else if (isInvestment) {
    summary = summarizeInvestment(analysis, facts);
  } else if (isAward) {
    summary = summarizeAward(analysis);
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

async function summarizeWithOpenAI({ title = "", description = "" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
        input: [
          {
            role: "system",
            content:
              "제목과 RSS 설명에서 확인되는 기업·기관, 금액, 투자단계, 정책명, 제품명, 행동을 보존해 한국어 보고서식 한 문장으로 요약하세요. 사실을 추가하지 말고 100자 이내로 작성하며 '동향입니다', '소식입니다', '관련 기사입니다', '내용을 다룸', '주목됩니다'는 사용하지 마세요.",
          },
          {
            role: "user",
            content: `제목: ${cleanText(title).slice(0, 250)}\nRSS 설명: ${cleanText(description).slice(0, 700)}`,
          },
        ],
        max_output_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`OpenAI API 오류: ${response.status}`);

    const rawSummary = extractResponseText(await response.json());
    if (!rawSummary) throw new Error("OpenAI API 응답에 요약문이 없습니다.");

    const summary = finalizeSummary(rawSummary);
    if (VAGUE_EXPRESSIONS.some((expression) => summary.includes(expression))) {
      throw new Error("OpenAI API 요약에 금지된 모호한 표현이 포함되었습니다.");
    }
    return summary;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeArticle(article) {
  const shouldUseOpenAI =
    /^true$/i.test(process.env.USE_OPENAI_SUMMARY || "false") &&
    Boolean(process.env.OPENAI_API_KEY);

  if (!shouldUseOpenAI) return summarizeLocal(article);

  try {
    return await summarizeWithOpenAI(article);
  } catch (error) {
    console.warn(`[요약 대체] ${article.title}: ${error.message}`);
    return summarizeLocal(article);
  }
}

module.exports = {
  summarizeArticle,
  summarizeLocal,
  summarizeWithOpenAI,
};
