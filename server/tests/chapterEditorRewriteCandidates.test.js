const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chapterEditorRewriteCandidatesPrompt,
} = require("../dist/prompting/prompts/novel/chapterEditor/rewriteCandidates.prompts.js");
const {
  hasRegisteredPromptAsset,
} = require("../dist/prompting/registry.js");

function createCandidate(content, label = "方案") {
  return {
    label,
    content,
    summary: "一句话概括主要改动。",
    rationale: "说明这版主要改法。",
    riskNotes: [],
    semanticTags: ["润色"],
  };
}

const LONG_BASE = "三斗把揽头木牌挂上米铺门楣，当日就有乡邻在门口啜骂，孩童绕着铺子走，他夜里翻税册发现多加了一笔火耗，官税之外还压着胥吏的第二层手。";

test("rewrite candidates postValidate accepts genuinely distinct candidates", () => {
  const output = {
    candidates: [
      createCandidate("三斗把揽头木牌挂上米铺门楣，乡邻啜骂，孩童绕行，他夜里翻税册发现多了一笔火耗。", "更克制"),
      createCandidate("木牌挂上门楣那日，三斗当众立规矩，夜里对账发现胥吏在官税之外还加了一层手。", "更强化"),
    ],
  };

  assert.doesNotThrow(() => chapterEditorRewriteCandidatesPrompt.postValidate(output));
});

test("rewrite candidates postValidate rejects identical candidate content", () => {
  // 模型退化形态：标签不同、正文完全相同（schema min(2) 查不出，曾一路漏到服务层精确去重）
  const output = {
    candidates: [
      createCandidate("他把木牌挂上门楣，夜里翻账。", "方案一"),
      createCandidate("他把木牌挂上门楣，夜里翻账。", "方案二"),
    ],
  };

  assert.throws(
    () => chapterEditorRewriteCandidatesPrompt.postValidate(output),
    /候选 1 与候选 2 的改写正文重复/,
  );
});

test("rewrite candidates postValidate rejects near-duplicate long content", () => {
  const variant = LONG_BASE.replace("啜骂", "笑骂");
  const output = {
    candidates: [
      createCandidate(LONG_BASE, "方案一"),
      createCandidate(variant, "方案二"),
    ],
  };

  assert.throws(
    () => chapterEditorRewriteCandidatesPrompt.postValidate(output),
    /重复或几乎相同/,
  );
});

test("rewrite candidates postValidate tolerates short non-identical candidates", () => {
  // 短文本不走相似度阈值，只要不是完全相同就放行（避免误杀短选区的合理差异）
  const output = {
    candidates: [
      createCandidate("他把木牌挂上门楣", "方案一"),
      createCandidate("她把木牌挂上门楣", "方案二"),
    ],
  };

  assert.doesNotThrow(() => chapterEditorRewriteCandidatesPrompt.postValidate(output));
});

test("editor and volume prompt assets stay registered for the runner gate", () => {
  // runStructuredPrompt 的 assertRegistered 会拦截未注册资产；
  // chapter_title_dedup 曾漏注册导致合并消重静默走兜底，这里锁住不再复发
  assert.equal(hasRegisteredPromptAsset("novel.chapter_editor.rewrite_candidates", "v3"), true);
  assert.equal(hasRegisteredPromptAsset("novel.volume.chapter_title_dedup", "v1"), true);
  assert.equal(hasRegisteredPromptAsset("novel.volume.chapter_list", "v10"), true);
});
