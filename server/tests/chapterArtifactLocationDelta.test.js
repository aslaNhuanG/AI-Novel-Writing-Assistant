const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chapterArtifactCharacterLocationDeltasSchema,
} = require("../dist/prompting/prompts/novel/chapterArtifactDelta.prompts.js");

function createDelta(overrides = {}) {
  return {
    characterId: "cmvkn8fq3001b3w0dqzyd024j",
    characterName: "计三斗",
    fromLocation: null,
    locationName: "米铺",
    movementType: "move",
    timeContext: "present",
    continuityStatus: "consistent",
    evidence: "三斗挂上揽头木牌，转身走进米铺。",
    explanation: null,
    ...overrides,
  };
}

test("character location deltas normalize empty nullable text to null", () => {
  const parsed = chapterArtifactCharacterLocationDeltasSchema.parse([
    createDelta({ fromLocation: "", locationName: "", explanation: "" }),
  ]);

  assert.equal(parsed.length, 1);
  // 空串曾撞 z.string().min(1) 的 too_small 校验，触发按章的修复重试与批次暂停
  assert.equal(parsed[0].fromLocation, null);
  assert.equal(parsed[0].locationName, null);
  assert.equal(parsed[0].explanation, null);
});

test("character location deltas normalize whitespace-only text to null", () => {
  const parsed = chapterArtifactCharacterLocationDeltasSchema.parse([
    createDelta({ fromLocation: "   ", explanation: "\t" }),
  ]);

  assert.equal(parsed[0].fromLocation, null);
  assert.equal(parsed[0].explanation, null);
});

test("character location deltas keep valid nullable text untouched", () => {
  const parsed = chapterArtifactCharacterLocationDeltasSchema.parse([
    createDelta({ fromLocation: "县衙", locationName: "米铺", explanation: "承接上一章离衙。" }),
  ]);

  assert.equal(parsed[0].fromLocation, "县衙");
  assert.equal(parsed[0].locationName, "米铺");
  assert.equal(parsed[0].explanation, "承接上一章离衙。");
});

test("character location deltas keep required fields strict after normalization", () => {
  // 归一化只放松可空文本字段；必填字段为空仍然必须失败
  assert.throws(
    () => chapterArtifactCharacterLocationDeltasSchema.parse([createDelta({ characterName: "" })]),
    /Too small/,
  );
  assert.throws(
    () => chapterArtifactCharacterLocationDeltasSchema.parse([createDelta({ evidence: "" })]),
    /Too small/,
  );
});

test("character location deltas still validate enum fields", () => {
  assert.throws(
    () => chapterArtifactCharacterLocationDeltasSchema.parse([createDelta({ movementType: "teleport" })]),
    /movementType/,
  );
});
