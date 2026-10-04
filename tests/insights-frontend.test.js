const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { parseKrwToEok, summarizeWindow } = require("../scripts/insights");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("원화 금액을 억 원 단위로 바꾸고 해석이 불확실하면 null을 반환한다", () => {
  assert.equal(parseKrwToEok("30억5000만 원"), 30.5);
  assert.equal(parseKrwToEok("1조 2000억 원"), 12000);
  assert.equal(parseKrwToEok("약 50억 원"), 50);
  assert.equal(parseKrwToEok("$3M"), null);
});

test("인사이트는 이틀 연속 실린 같은 기사를 한 번만 센다", () => {
  const article = {
    title: "마케마케, 프리A 30억 원 투자 유치",
    summary: "마케마케가 프리A 투자를 유치했다.",
    url: "https://example.com/a",
    source: "매일경제",
    category: "VC / AC",
    publishedAt: "2026-09-23",
  };
  const overseas = {
    title: "Stockholm’s Spiich raises €3 million",
    summary: "",
    url: "https://www.eu-startups.com/2026/09/spiich",
    source: "EU-Startups",
    category: "해외 VC",
    publishedAt: "2026-09-24",
  };
  const window = summarizeWindow(
    [
      { date: "2026-09-23", items: [article] },
      { date: "2026-09-24", items: [article, overseas] },
    ],
    "2026-09-21",
    "2026-09-27"
  );
  assert.equal(window.articleCount, 2);
  assert.equal(window.overseasCount, 1);
  assert.equal(window.dealCount, 2);
  assert.equal(window.disclosedKrwDealCount, 1);
  assert.equal(window.disclosedKrwTotalEok, 30);
  assert.deepEqual(window.daily.map((day) => day.total), [1, 2]);
});

test("index.html은 CSS·JS에 같은 캐시 버전 쿼리를 붙인다", () => {
  const html = read("index.html");
  const css = html.match(/href="style\.css\?v=([\w.-]+)"/u)?.[1];
  const js = html.match(/src="app\.js\?v=([\w.-]+)"/u)?.[1];
  assert.ok(css, "style.css 캐시 버전 누락");
  assert.ok(js, "app.js 캐시 버전 누락");
  assert.equal(css, js);
  assert.match(html, /ASSET_VERSION/u);
});

test("app.js가 참조하는 요소 id가 index.html에 모두 있다", () => {
  const html = read("index.html");
  const app = read("app.js");
  const ids = [...app.matchAll(/\$\("#([\w-]+)"\)/gu)].map((match) => match[1]);
  assert.ok(ids.length > 10);
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`, "u"), `index.html에 #${id} 없음`);
  }
});

test("프론트는 JSON을 no-store로 읽고 구조화 정보를 브라우저에서 추정하지 않는다", () => {
  const app = read("app.js");
  assert.match(app, /cache:\s*"no-store"/u);
  assert.doesNotMatch(app, /extractClientStructuredInfo/u);
  assert.doesNotMatch(app, /\.match\(\/[^/]*raise/u);
  assert.match(app, /"세컨더리 \/ 구주매각"/u);
});

test("예약 실행은 cron을 유지하고, 오늘 브리핑이 이미 있으면 수집·커밋을 건너뛴다", () => {
  const workflow = read(".github/workflows/daily-news.yml");
  assert.match(workflow, /cron: "15 0 \* \* \*"/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /id: guard\n\s+if: \$\{\{ github\.event_name == 'schedule' \}\}/u);
  assert.match(workflow, /\.briefingDate == \$today/u);
  const guarded = workflow.match(/if: \$\{\{ (?:!cancelled\(\) && )?steps\.guard\.outputs\.skip != 'true' \}\}/gu) || [];
  // pnpm·Node·설치·버퍼·수집·커밋 6단계
  assert.equal(guarded.length, 6);
});

test("1면 카드 덱은 저장된 구조화 값만 표시한다", () => {
  const app = read("app.js");
  const deckSource = app.slice(app.indexOf("function renderCardFace"), app.indexOf("function renderDeck"));
  assert.ok(deckSource.includes("structuredInfo(article)"));
  assert.ok(!/extract|parse(?:Amount|Company)/u.test(deckSource));
});
