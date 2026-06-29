const categories = {
  "VC / AC": [
    "VC",
    "벤처캐피탈",
    "벤처 투자",
    "벤처투자",
    "투자 유치",
    "투자유치",
    "시드 투자",
    "프리A",
    "Series A",
    "시리즈A",
    "AC",
    "액셀러레이터",
    "창업기획자",
    "투자조합",
    "펀드 결성",
    "신규 펀드",
    "벤처펀드",
  ],
  "TIPS / LIPS": [
    "TIPS",
    "팁스",
    "민간투자주도형",
    "LIPS",
    "립스",
    "창업성장기술개발",
    "딥테크 팁스",
    "초격차 스타트업",
    "팁스 선정",
    "운영사",
    "추천기업",
  ],
  "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주": [
    "농식품",
    "푸드테크",
    "애그테크",
    "스마트팜",
    "딥테크",
    "ESG",
    "AI",
    "인공지능",
    "생성형 AI",
    "반도체",
    "팹리스",
    "시스템반도체",
    "항공우주",
    "우주항공",
    "위성",
    "로켓",
    "우주 스타트업",
  ],
  "스타트업 / 벤처기업 / 초기창업": [
    "스타트업",
    "벤처기업",
    "초기창업",
    "창업기업",
    "예비창업",
    "창업지원",
    "보육기업",
    "데모데이",
    "IR 피칭",
    "창업 생태계",
    "액셀러레이팅",
  ],
  "세컨더리 / 구주매각": [
    "세컨더리",
    "구주",
    "구주매각",
    "구주 거래",
    "세컨더리 펀드",
    "벤처 세컨더리",
    "회수시장",
    "엑시트",
    "투자 회수",
    "LP 지분",
    "GP-led",
    "continuation fund",
  ],
  "해외 VC": [
    "글로벌 VC",
    "해외 VC",
    "실리콘밸리",
    "Sequoia",
    "Andreessen Horowitz",
    "a16z",
    "Lightspeed",
    "General Catalyst",
    "Accel",
    "Tiger Global",
    "SoftBank Vision Fund",
    "Y Combinator",
    "글로벌 스타트업 투자",
  ],
};

const techCategoryName = "농식품 / 딥테크 / ESG / AI / 반도체 / 항공우주";

// 기술 키워드만으로 일반 산업 기사가 포함되지 않도록 함께 확인한다.
const techEcosystemKeywords = [
  "스타트업",
  "벤처",
  "창업기업",
  "투자",
  "투자유치",
  "VC",
  "AC",
  "액셀러레이터",
  "TIPS",
  "팁스",
  "지원사업",
  "데모데이",
  "IR",
  "펀드",
  "선정",
  "보육기업",
];

const startupGrowthContextKeywords = [
  "스타트업",
  "벤처",
  "창업",
  "투자",
  "VC",
  "AC",
  "액셀러레이터",
  "TIPS",
  "팁스",
  "지원사업",
  "데모데이",
  "IR",
  "펀드",
  "보육기업",
  "사업화",
  "기업 성장",
  "스케일업",
  "시장 진출",
];

// 매체 표기가 달라질 수 있으므로 실제 RSS의 source 값에 맞춰 자유롭게 추가/삭제한다.
const allowedSources = [
  "연합뉴스",
  "매일경제",
  "한국경제",
  "서울경제",
  "머니투데이",
  "아시아경제",
  "파이낸셜뉴스",
  "이데일리",
  "조선비즈",
  "중앙일보",
  "동아일보",
  "한겨레",
  "전자신문",
  "디지털타임스",
  "ZDNet Korea",
  "지디넷코리아",
  "블로터",
  "플래텀",
  "벤처스퀘어",
  "스타트업투데이",
  "더벨",
  "딜사이트",
  "DealSite경제TV",
  "비즈워치",
  "테크M",
  "테크42",
  "CIO Korea",
  "중소벤처기업부",
  "과학기술정보통신부",
  "농림축산식품부",
  "산업통상자원부",
  "금융위원회",
  "K-Startup",
  "창업진흥원",
  "한국벤처투자",
  "한국무역협회",
  "코트라",
  "KOTRA",
];

function googleNewsRss(query) {
  const params = new URLSearchParams({
    q: `${query} when:1d`,
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

// 직접 RSS를 추가할 때도 { name, url } 형식을 유지한다.
const rssSources = [
  {
    name: "Google 뉴스 - VC·AC",
    url: googleNewsRss(
      '("벤처캐피탈" OR "벤처투자" OR "투자유치" OR "액셀러레이터" OR "벤처펀드")'
    ),
  },
  {
    name: "Google 뉴스 - TIPS·LIPS",
    url: googleNewsRss(
      '("팁스" OR "TIPS" OR "립스" OR "LIPS" OR "초격차 스타트업")'
    ),
  },
  {
    name: "Google 뉴스 - 딥테크",
    url: googleNewsRss(
      '("딥테크" OR "푸드테크" OR "애그테크" OR "생성형 AI" OR "팹리스" OR "우주 스타트업")'
    ),
  },
  {
    name: "Google 뉴스 - 스타트업",
    url: googleNewsRss(
      '("스타트업" OR "벤처기업" OR "초기창업" OR "창업지원" OR "데모데이")'
    ),
  },
  {
    name: "Google 뉴스 - 세컨더리",
    url: googleNewsRss(
      '("벤처 세컨더리" OR "구주매각" OR "회수시장" OR "투자 회수" OR "LP 지분")'
    ),
  },
  {
    name: "Google 뉴스 - 해외 VC",
    url: googleNewsRss(
      '("글로벌 VC" OR "해외 VC" OR "Sequoia" OR "a16z" OR "Y Combinator")'
    ),
  },
];

module.exports = {
  categories,
  allowedSources,
  rssSources,
  startupGrowthContextKeywords,
  techCategoryName,
  techEcosystemKeywords,
};
