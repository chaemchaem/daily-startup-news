const assert = require("node:assert/strict");
const test = require("node:test");

const { runCli } = require("../scripts/collect-news");

test("CLI 수집 성공 후 저장 완료를 기다리고 종료 코드 0을 전달한다", async () => {
  const events = [];
  const exitCode = await runCli({
    collect: async () => {
      events.push("collect");
    },
    flush: async () => {
      events.push("flush");
    },
    terminate: (code) => {
      events.push(`exit:${code}`);
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ["collect", "flush", "exit:0"]);
});

test("CLI 수집 실패 시 종료 코드 1을 전달하고 예외를 미처리 상태로 남기지 않는다", async () => {
  const events = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const exitCode = await runCli({
      collect: async () => {
        events.push("collect");
        throw new Error("synthetic collect failure");
      },
      flush: async () => {
        events.push("flush");
      },
      terminate: (code) => {
        events.push(`exit:${code}`);
      },
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(events, ["collect", "flush", "exit:1"]);
  } finally {
    console.error = originalError;
    process.exitCode = 0;
  }
});
