// 네이버 뉴스스탠드 주요 언론사의 RSS 주소 탐색 목록.
// 주소를 추측해 바로 수집하지 않고, "Probe news sources"(discover 모드)로 실제 응답을 확인한 뒤
// 정상인 피드만 scripts/sources.js의 수집원으로 옮긴다.
// feedUrls: 공식 안내로 알려진 후보 주소, guideUrls: 피드 링크를 찾을 RSS 안내 페이지·홈페이지,
// keywords: 안내 페이지에서 우선 시험할 경제·산업·IT 섹션 단서.
const ECONOMY_KEYWORDS = ["econom", "money", "finance", "biz", "business", "industry", "it", "tech", "science", "all", "total", "news", "경제", "산업"];

const discoveryTargets = [
  // 경제지
  { sourceName: "머니투데이", feedUrls: ["https://rss.mt.co.kr/mt_news.xml"], guideUrls: ["https://www.mt.co.kr/rss", "https://news.mt.co.kr/rss"] },
  { sourceName: "서울경제", feedUrls: ["https://www.sedaily.com/rss/newsall"], guideUrls: ["https://www.sedaily.com/Rss", "https://www.sedaily.com/rss"] },
  { sourceName: "아시아경제", feedUrls: ["https://www.asiae.co.kr/rss/all.htm"], guideUrls: ["https://www.asiae.co.kr/rss/"] },
  { sourceName: "이데일리", feedUrls: ["http://rss.edaily.co.kr/edaily_news.xml", "https://rss.edaily.co.kr/edaily_news.xml"], guideUrls: ["https://www.edaily.co.kr/rss"] },
  { sourceName: "파이낸셜뉴스", feedUrls: ["https://www.fnnews.com/rss/r20/fn_realnews_all.xml"], guideUrls: ["https://www.fnnews.com/rss"] },
  { sourceName: "헤럴드경제", feedUrls: ["https://biz.heraldcorp.com/rss/google/economy"], guideUrls: ["https://biz.heraldcorp.com/rss", "https://www.heraldcorp.com/rss"] },
  { sourceName: "이투데이", feedUrls: ["https://rss.etoday.co.kr/eto/etoday_news_all.xml"], guideUrls: ["https://www.etoday.co.kr/rss"] },
  { sourceName: "아주경제", feedUrls: [], guideUrls: ["https://www.ajunews.com/rss", "https://www.ajunews.com/"] },
  { sourceName: "뉴스핌", feedUrls: [], guideUrls: ["https://www.newspim.com/rss", "https://www.newspim.com/"] },
  { sourceName: "조선비즈", feedUrls: ["https://biz.chosun.com/arc/outboundfeeds/rss/?outputType=xml"], guideUrls: [] },
  { sourceName: "비즈니스포스트", feedUrls: [], guideUrls: ["https://www.businesspost.co.kr/BP?command=rss", "https://www.businesspost.co.kr/"] },
  // 종합지
  { sourceName: "국민일보", feedUrls: ["https://www.kmib.co.kr/rss/data/kmibEcoRss.xml"], guideUrls: ["https://www.kmib.co.kr/rss/index.asp"] },
  { sourceName: "서울신문", feedUrls: ["https://www.seoul.co.kr/xml/rss/rss_economy.xml"], guideUrls: ["https://www.seoul.co.kr/rss"] },
  { sourceName: "세계일보", feedUrls: ["https://www.segye.com/Articles/RSSList/segye_economy.xml"], guideUrls: ["https://www.segye.com/rss", "https://www.segye.com/"] },
  { sourceName: "한국일보", feedUrls: [], guideUrls: ["https://www.hankookilbo.com/Rss", "https://www.hankookilbo.com/"] },
  { sourceName: "문화일보", feedUrls: [], guideUrls: ["https://www.munhwa.com/rss", "https://www.munhwa.com/"] },
  { sourceName: "내일신문", feedUrls: [], guideUrls: ["https://www.naeil.com/rss", "https://www.naeil.com/"] },
  // 통신·인터넷
  { sourceName: "뉴스1", feedUrls: [], guideUrls: ["https://www.news1.kr/rss", "https://www.news1.kr/"] },
  { sourceName: "노컷뉴스", feedUrls: [], guideUrls: ["https://www.nocutnews.co.kr/rss", "https://www.nocutnews.co.kr/"] },
  // IT 전문지
  { sourceName: "디지털타임스", feedUrls: [], guideUrls: ["https://www.dt.co.kr/rss", "https://www.dt.co.kr/"] },
  { sourceName: "아이뉴스24", feedUrls: [], guideUrls: ["https://www.inews24.com/rss", "https://www.inews24.com/"] },
  { sourceName: "블로터", feedUrls: ["https://www.bloter.net/rss/allArticle.xml"], guideUrls: ["https://www.bloter.net/"] },
  { sourceName: "디지털데일리", feedUrls: ["https://www.ddaily.co.kr/rss/allArticle.xml"], guideUrls: ["https://www.ddaily.co.kr/"] },
  { sourceName: "테크M", feedUrls: ["https://www.techm.kr/rss/allArticle.xml"], guideUrls: ["https://www.techm.kr/"] },
  { sourceName: "IT조선", feedUrls: ["https://it.chosun.com/arc/outboundfeeds/rss/?outputType=xml"], guideUrls: ["https://it.chosun.com/"] },
  // 방송
  { sourceName: "SBS", feedUrls: ["https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER"], guideUrls: ["https://news.sbs.co.kr/news/rss.do"] },
  { sourceName: "SBS Biz", feedUrls: [], guideUrls: ["https://biz.sbs.co.kr/rss", "https://biz.sbs.co.kr/"] },
  { sourceName: "JTBC", feedUrls: ["https://fs.jtbc.co.kr/RSS/economy.xml"], guideUrls: ["https://news.jtbc.co.kr/rss"] },
  { sourceName: "MBC", feedUrls: ["https://imnews.imbc.com/rss/google_news/economy.rss"], guideUrls: ["https://imnews.imbc.com/rss/"] },
  { sourceName: "KBS", feedUrls: [], guideUrls: ["https://news.kbs.co.kr/rss", "https://news.kbs.co.kr/"] },
  { sourceName: "YTN", feedUrls: [], guideUrls: ["https://www.ytn.co.kr/rss", "https://www.ytn.co.kr/"] },
  { sourceName: "연합뉴스TV", feedUrls: ["https://www.yonhapnewstv.co.kr/category/news/economy/feed/"], guideUrls: ["https://www.yonhapnewstv.co.kr/"] },
  { sourceName: "MBN", feedUrls: [], guideUrls: ["https://www.mbn.co.kr/rss", "https://www.mbn.co.kr/"] },
  { sourceName: "채널A", feedUrls: [], guideUrls: ["https://www.ichannela.com/rss", "https://www.ichannela.com/"] },
  { sourceName: "TV조선", feedUrls: [], guideUrls: ["https://news.tvchosun.com/rss", "https://news.tvchosun.com/"] },
].map((target) => ({ keywords: ECONOMY_KEYWORDS, ...target }));

module.exports = { discoveryTargets };
