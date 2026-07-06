const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveOriginalArticleUrl } = require("../scripts/article-extractor");

test("Google 중계 해석 실패 시 등록된 매체 주소에서 제목으로 원문을 찾는다", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("robots.txt")) {
      return new Response("", { status: 404 });
    }
    if (url.includes("batchexecute")) {
      return new Response("batch response without article URL", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.startsWith("https://news.google.com/")) {
      return new Response("<html><body>Google News relay</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.startsWith("https://publisher.example/?s=")) {
      return new Response(
        '<html><body><a href="https://publisher.example/articles/carbon-six">카본식스, 623억 규모 시리즈A 투자 유치</a></body></html>',
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await resolveOriginalArticleUrl(
      "https://news.google.com/rss/articles/CBMiTest",
      {
        title: "카본식스, 623억 규모 시리즈A 투자 유치…한·미 투자사 총출동",
        publisherBaseUrl: "https://publisher.example",
        allowedUrlPatterns: ["^https://publisher\\.example/articles/"],
        timeoutMs: 1_000,
      }
    );
    assert.equal(result.resolutionStatus, "resolved");
    assert.equal(result.resolvedUrl, "https://publisher.example/articles/carbon-six");
    assert.match(result.detail, /publisher_title_search/u);
  } finally {
    global.fetch = originalFetch;
  }
});
