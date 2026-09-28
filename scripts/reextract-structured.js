// 저장된 브리핑의 구조화 필드(company·fundingAmount·fundingStage·eventType·industry)를
// 현재 추출 규칙으로 다시 계산한다. 입력은 저장된 제목·요약뿐이며 기사·요약 문장은 바꾸지 않는다.
//
//   node scripts/reextract-structured.js          # 변경 예정 내역만 출력(dry-run)
//   node scripts/reextract-structured.js --write  # data/news.json과 아카이브에 반영
const fs = require("node:fs/promises");
const path = require("node:path");

const { extractStructuredArticleInfo } = require("./utils");

const DATA_DIR = path.join(__dirname, "..", "data");
const FIELDS = ["company", "fundingAmount", "fundingStage", "eventType", "industry"];

function reextractItem(item) {
  const info = extractStructuredArticleInfo({ title: item.title || "", summary: item.summary || "" });
  const next = { ...item };
  for (const field of FIELDS) delete next[field];
  // 저장 위치와 순서는 수집 스크립트와 같게 score 앞에 둔다.
  const { score, ...rest } = next;
  const structured = Object.fromEntries(FIELDS.filter((field) => info[field]).map((field) => [field, info[field]]));
  return { ...rest, ...structured, ...(score !== undefined ? { score } : {}) };
}

function diffItem(before, after) {
  return FIELDS.filter((field) => (before[field] || null) !== (after[field] || null)).map(
    (field) => `${field}: ${before[field] ?? "∅"} → ${after[field] ?? "∅"}`
  );
}

async function processFile(filePath, write) {
  const data = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!Array.isArray(data.items)) return { changed: 0, lines: [] };
  const lines = [];
  let changed = 0;
  data.items = data.items.map((item) => {
    const next = reextractItem(item);
    const diff = diffItem(item, next);
    if (diff.length) {
      changed += 1;
      lines.push(`  - ${String(item.title || "").slice(0, 60)} | ${diff.join(", ")}`);
    }
    return next;
  });
  if (write && changed) {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  return { changed, lines };
}

async function main() {
  const write = process.argv.includes("--write");
  const archiveFiles = (await fs.readdir(path.join(DATA_DIR, "archive")))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(file))
    .sort()
    .map((file) => path.join(DATA_DIR, "archive", file));
  let totalChanged = 0;
  let filesChanged = 0;
  for (const filePath of [path.join(DATA_DIR, "news.json"), ...archiveFiles]) {
    const { changed, lines } = await processFile(filePath, write);
    if (!changed) continue;
    totalChanged += changed;
    filesChanged += 1;
    console.log(`${path.relative(DATA_DIR, filePath)} (${changed}건)`);
    for (const line of lines) console.log(line);
  }
  console.log(
    `\n${write ? "반영" : "변경 예정(dry-run)"}: 파일 ${filesChanged}개, 기사 ${totalChanged}건`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
