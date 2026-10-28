import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PromptAsset } from "../../../core/promptTypes";
import {
  getChapterTitleCollisionIssue,
  getChapterTitleDiversityIssue,
} from "../../../../services/novel/volume/chapterTitleDiversity";

const CHAPTER_TITLE_MAX_CORE_CHARS = 16;

export const chapterTitleDedupOutputSchema = z.object({
  renames: z
    .array(
      z.object({
        chapterOrder: z.number().int().positive(),
        title: z.string().trim().min(1),
      }),
    )
    .min(1),
});

export type ChapterTitleDedupPromptInput = {
  volumeTitle: string;
  duplicates: Array<{
    chapterOrder: number;
    beatLabel: string;
    title: string;
    summary: string;
  }>;
  reservedTitles: string[];
};

/**
 * 卷内章节标题消重：分块/跨 beat 生成后，合并层发现重复标题时，
 * 只对重复章节做聚焦重命名（小块输入 + 明确禁用清单，命中率远高于全块重写）。
 */
export const chapterTitleDedupPrompt: PromptAsset<
  ChapterTitleDedupPromptInput,
  z.infer<typeof chapterTitleDedupOutputSchema>
> = {
  id: "novel.volume.chapter_title_dedup",
  version: "v1",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  contextPolicy: {
    maxTokensBudget: 1024,
  },
  outputSchema: chapterTitleDedupOutputSchema,
  render: (input) => [
    new SystemMessage([
      "你是网文章节标题消重助手。",
      "卷内章节列表生成了重复标题，你的任务只是为重命名章节取一个新标题。",
      "",
      "【硬性要求】",
      "1. 只为用户列出的重复章节重命名，不得改动其他章节，不得增删章节。",
      "2. 新标题必须与该章 summary 的内容相符，体现这一章真实发生的事。",
      "3. 新标题不得与「已占用章节名」中的任何标题相同，也不得与其他重命名结果相同。",
      `4. 标题必须短促客观，不超过 ${CHAPTER_TITLE_MAX_CORE_CHARS} 个核心字，不用第一人称，不写成长句或剧情梗概。`,
      "5. 必须换一个与旧标题不同的角度：更换对象、动作、地点或局面变化，不得只改一两个字。",
      "6. 只输出严格 JSON，不要输出 Markdown、解释或额外字段。",
      "",
      "【输出格式】",
      '{ "renames": [ { "chapterOrder": 12, "title": "新标题" } ] }',
    ].join("\n")),
    new HumanMessage([
      `当前卷：${input.volumeTitle}`,
      "",
      "【需要重命名的重复章节】",
      ...input.duplicates.map((duplicate) => [
        `- 第 ${duplicate.chapterOrder} 章（${duplicate.beatLabel}）原标题：${duplicate.title}`,
        `  summary：${duplicate.summary}`,
      ].join("\n")),
      "",
      "【已占用章节名（新标题不得与其中任何一项相同）】",
      ...input.reservedTitles.map((title) => `- ${title}`),
      "",
      "请输出 JSON：renames 必须覆盖上面每一条重复章节，且只覆盖这些章节。",
    ].join("\n")),
  ],
  postValidate: (output, input) => {
    const duplicateOrders = new Set(input.duplicates.map((duplicate) => duplicate.chapterOrder));
    const renameOrders = output.renames.map((rename) => rename.chapterOrder);
    if (new Set(renameOrders).size !== renameOrders.length) {
      throw new Error("renames 中存在重复的 chapterOrder。");
    }
    for (const order of duplicateOrders) {
      if (!renameOrders.includes(order)) {
        throw new Error(`第 ${order} 章缺少重命名结果。`);
      }
    }
    for (const order of renameOrders) {
      if (!duplicateOrders.has(order)) {
        throw new Error(`第 ${order} 章不在重复章节清单中，不得重命名。`);
      }
    }

    const newTitles = output.renames.map((rename) => rename.title);
    const diversityIssue = getChapterTitleDiversityIssue(newTitles);
    if (diversityIssue) {
      throw new Error(diversityIssue);
    }

    const collisionIssue = getChapterTitleCollisionIssue(input.reservedTitles, newTitles);
    if (collisionIssue) {
      throw new Error(collisionIssue);
    }

    return output;
  },
};
