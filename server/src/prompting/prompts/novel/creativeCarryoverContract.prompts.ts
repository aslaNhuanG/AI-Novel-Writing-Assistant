import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  assertCreativeCarryoverFocusForMode,
  creativeCarryoverContractDraftSchema,
  type CreativeCarryoverContractDraft,
  type CreativeCarryoverMode,
} from "@ai-novel/shared/types/creativeCarryoverContract";
import type { PromptAsset } from "../../core/promptTypes";
import { NOVEL_PROMPT_BUDGETS } from "./promptBudgetProfiles";

export interface CreativeCarryoverContractPromptInput {
  mode: CreativeCarryoverMode;
  analysisTitle: string;
  documentTitle: string;
  documentVersionNumber: number;
  sectionSummaries: string;
}

export const creativeCarryoverContractPrompt: PromptAsset<
  CreativeCarryoverContractPromptInput,
  CreativeCarryoverContractDraft
> = {
  id: "novel.creative_carryover.contract",
  version: "v1",
  taskType: "planner",
  mode: "structured",
  language: "zh",
  management: {
    productPrompt: true,
    editModes: ["readonly"],
  },
  contextPolicy: {
    maxTokensBudget: NOVEL_PROMPT_BUDGETS.creativeCarryoverContract,
  },
  outputSchema: creativeCarryoverContractDraftSchema,
  structuredOutputHint: {
    mode: "auto",
    note: "openingChapters 必须恰好覆盖第 1、2、3 章；续写只填 continuationFocus；参考创作与改书只填 adaptationFocus（改书时它表示可复用方法与改书执行方案）。",
    example: {
      sourceTraits: ["原书特点示例"],
      bookRealization: ["本书如何落地示例"],
      openingChapters: [
        { chapterNumber: 1, direction: "第一章方向" },
        { chapterNumber: 2, direction: "第二章方向" },
        { chapterNumber: 3, direction: "第三章方向" },
      ],
      basis: [{ sectionKey: "plot_structure", fieldKeys: ["mainlineSummary"], summary: "依据摘要" }],
      continuationFocus: {
        finalCharacterStates: ["主角终局状态"],
        unfinishedThreads: ["未完线索"],
      },
      adaptationFocus: null,
    },
  },
  postValidate: (output, input) => {
    assertCreativeCarryoverFocusForMode(input.mode, output);
    return {
      ...output,
      continuationFocus: input.mode === "continuation" ? (output.continuationFocus ?? null) : null,
      // 改书复用 adaptationFocus 的四个字段，只是语义从「换皮新书」变成「可复用方法 + 改书执行方案」。
      adaptationFocus: input.mode === "continuation" ? null : (output.adaptationFocus ?? null),
    };
  },
  render: (input) => {
    const isContinuation = input.mode === "continuation";
    const isRewrite = input.mode === "rewrite";
    const modeLabel = isContinuation ? "续写原作" : isRewrite ? "改书（采用用户设定与章纲）" : "参考创作新书";
    return [
      new SystemMessage([
        "你是长篇网文开书顾问，负责把已完成的拆书结论整理成一份「创作承接合同」。",
        "服务对象是不懂写作流程的新手；输出必须让用户一眼看懂：原书特点、本书如何实现、前三章往哪走。",
        "",
        "只输出严格 JSON，不要 Markdown、解释或额外字段。",
        "字段：sourceTraits、bookRealization、openingChapters、basis、continuationFocus、adaptationFocus。",
        "",
        isContinuation
          ? [
            "当前模式：续写原作。",
            "必须保留原作角色、世界规则、时间线事实与未完线索。",
            "continuationFocus 必填：finalCharacterStates（终局人物状态）、unfinishedThreads（未完线索）。",
            "adaptationFocus 必须为 null。",
            "bookRealization 要说明本书如何承接这些事实继续写，而不是另起炉灶。",
          ].join("\n")
          : isRewrite
            ? [
              "当前模式：改书（采用用户设定与章纲）。",
              "新书正史以用户提供的设定与章纲为准：原书专名、角色、世界事实与具体剧情不得覆盖或改写用户设定。",
              "原书只提供结构方法、节奏与写法参考；不强制换皮，也不得凭空另造世界观或新主角。",
              "adaptationFocus 必填：hooks、conflictLoops、payoffRhythm（写成可复用的抽象方法，不绑定原书专名）、conversionPlan（改书执行方案：沿用哪些结构方法、如何映射到用户章纲、哪些原书元素明确丢弃）。",
              "continuationFocus 必须为 null。",
              "bookRealization 要说明如何把原书的结构方法落到用户的设定与章纲上。",
              "信息不足时不得编造用户的设定或章纲内容；缺少用户资料时只给方法、映射建议与注意事项。",
            ].join("\n")
            : [
              "当前模式：参考创作新书。",
              "只继承钩子、冲突循环、爽点节奏与结构方法；禁止沿用原作专名、角色、世界事实或具体剧情当新书正史。",
              "adaptationFocus 必填：hooks、conflictLoops、payoffRhythm、conversionPlan（如何转成独立新书）。",
              "continuationFocus 必须为 null。",
              "bookRealization 要说明新书如何转化这些阅读体验，并形成独立故事。",
            ].join("\n"),
        "",
        "通用要求：",
        "1. sourceTraits：提炼原书可感知特点，短句，面向读者体验。",
        "2. bookRealization：对应说明本书怎么实现，与 sourceTraits 一一可对照。",
        "3. openingChapters：恰好 3 项，chapterNumber 为 1、2、3，写出可执行开篇方向。",
        "4. basis：每条依据写清 sectionKey、可用 fieldKeys 与一句话 summary，必须能在给定拆书材料里找到依据。",
        "5. 信息不足时保守归纳，禁止编造拆书里没有的关键事实。",
      ].join("\n")),
      new HumanMessage([
        `模式：${modeLabel}`,
        `拆书标题：${input.analysisTitle}`,
        `来源文档：${input.documentTitle} v${input.documentVersionNumber}`,
        "",
        "拆书材料：",
        input.sectionSummaries,
      ].join("\n")),
    ];
  },
};
