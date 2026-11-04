import type {
  VolumeBeat,
  VolumeBeatSheet,
  VolumePlan,
  VolumePlanDocument,
} from "@ai-novel/shared/types/novel";
import type { StoryMacroPlan } from "@ai-novel/shared/types/storyMacro";
import { buildDirectorCompletionProfile } from "@ai-novel/shared/types/directorCompletion";
import { runStructuredPrompt } from "../../../prompting/core/promptRunner";
import { logMemoryUsage } from "../../../runtime/memoryTelemetry";
import { createVolumeChapterListPrompt } from "../../../prompting/prompts/novel/volume/chapterList.prompts";
import { chapterTitleDedupPrompt } from "../../../prompting/prompts/novel/volume/chapterTitleDedup.prompts";
import { buildVolumeChapterListContextBlocks } from "../../../prompting/prompts/novel/volume/contextBlocks";
import {
  inferRequiredChapterCountFromBeatSheet,
  resolveTargetChapterCount,
  validateBeatSheetChapterCoverage,
} from "./volumeBeatSheetChapterBudget";
import {
  allocateChapterBudgets,
  deriveChapterBudget,
  resolveEvenShareChapterBudget,
  GeneratedVolumeChapterBlock,
  getBeatExpectedChapterCount,
  getBeatSheet,
  getTargetVolume,
  isVolumeChapterListPartiallyPersisted,
  mergeChapterList,
  resolveVolumeChapterBeatKey,
  setVolumeChapterListPartialStatus,
} from "./volumeGenerationHelpers";
import { assessChapterTitleDiversity } from "./chapterTitleDiversity";
import type {
  VolumeGenerateOptions,
  VolumeGenerationNovel,
  VolumeIntermediateDocumentEvent,
  VolumeWorkspace,
} from "./volumeModels";

type StoryMacroPlanResult = StoryMacroPlan | null;

interface BeatGenerationPlan {
  beat: VolumeBeat;
  chapterCount: number;
  chapterStartOrder: number;
  chapterEndOrder: number;
}

interface FullVolumeResumeState {
  resumeBeatIndex: number;
  resumeBeatKey: string | null;
  preservedBeatBlocks: GeneratedVolumeChapterBlock[];
  isAlreadyComplete: boolean;
}

export function isCompactBookFinaleBeat(params: {
  completionProfile: VolumeGenerationNovel["completionProfile"];
  targetVolumeIndex: number;
  chapterBudgets: number[];
  beatChapterEndOrder: number;
}): boolean {
  if (params.completionProfile?.mode !== "compact_book" || params.targetVolumeIndex < 0) {
    return false;
  }
  const chaptersBeforeCurrentVolume = params.chapterBudgets
    .slice(0, params.targetVolumeIndex)
    .reduce((total, chapterCount) => total + chapterCount, 0);
  return chaptersBeforeCurrentVolume + params.beatChapterEndOrder
    >= params.completionProfile.endingRequiredBy;
}

function buildBeatGenerationPlans(beatSheet: VolumeBeatSheet): BeatGenerationPlan[] {
  let nextChapterOrder = 1;
  return beatSheet.beats.map((beat) => {
    const chapterCount = Math.max(1, getBeatExpectedChapterCount(beat));
    const plan: BeatGenerationPlan = {
      beat,
      chapterCount,
      chapterStartOrder: nextChapterOrder,
      chapterEndOrder: nextChapterOrder + chapterCount - 1,
    };
    nextChapterOrder = plan.chapterEndOrder + 1;
    return plan;
  });
}

function normalizeExplicitChapterCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : null;
}

function scaleBeatSheetToChapterCount(
  beatSheet: VolumeBeatSheet,
  targetChapterCount: number,
): VolumeBeatSheet {
  if (beatSheet.beats.length === 0) {
    return beatSheet;
  }
  const originalCounts = beatSheet.beats.map((beat) => Math.max(1, getBeatExpectedChapterCount(beat)));
  const originalTotal = originalCounts.reduce((sum, count) => sum + count, 0);
  // Every saved beat still needs a chapter to carry its story function. This
  // floor follows the existing small-book tolerance instead of dropping beats.
  const safeTargetChapterCount = Math.max(beatSheet.beats.length, Math.round(targetChapterCount));
  if (originalTotal === safeTargetChapterCount) {
    return beatSheet;
  }

  const scaledCounts = originalCounts.map((count) => Math.max(
    1,
    Math.floor((count * safeTargetChapterCount) / originalTotal),
  ));
  let delta = safeTargetChapterCount - scaledCounts.reduce((sum, count) => sum + count, 0);
  const distributionOrder = originalCounts
    .map((count, index) => ({ count, index }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ index }) => index);
  while (delta > 0) {
    for (const index of distributionOrder) {
      if (delta === 0) break;
      scaledCounts[index] += 1;
      delta -= 1;
    }
  }
  while (delta < 0) {
    let reduced = false;
    for (const index of distributionOrder) {
      if (delta === 0) break;
      if (scaledCounts[index] <= 1) continue;
      scaledCounts[index] -= 1;
      delta += 1;
      reduced = true;
    }
    if (!reduced) break;
  }

  let nextChapterOrder = 1;
  return {
    ...beatSheet,
    beats: beatSheet.beats.map((beat, index) => {
      const chapterCount = scaledCounts[index];
      const chapterStartOrder = nextChapterOrder;
      const chapterEndOrder = chapterStartOrder + chapterCount - 1;
      nextChapterOrder = chapterEndOrder + 1;
      return {
        ...beat,
        chapterSpanHint: chapterCount === 1
          ? `${chapterStartOrder}章`
          : `${chapterStartOrder}-${chapterEndOrder}章`,
      };
    }),
  };
}

function resolveFullVolumeResumeState(params: {
  beatPlans: BeatGenerationPlan[];
  existingBeatBlocks: GeneratedVolumeChapterBlock[];
}): FullVolumeResumeState {
  let resumeBeatIndex = params.beatPlans.length;
  for (const [index, beatPlan] of params.beatPlans.entries()) {
    const existingBlock = params.existingBeatBlocks[index];
    if (existingBlock && existingBlock.chapters.length === beatPlan.chapterCount) {
      continue;
    }
    resumeBeatIndex = index;
    break;
  }

  if (resumeBeatIndex >= params.beatPlans.length) {
    return {
      resumeBeatIndex,
      resumeBeatKey: null,
      preservedBeatBlocks: params.existingBeatBlocks.slice(),
      isAlreadyComplete: true,
    };
  }

  return {
    resumeBeatIndex,
    resumeBeatKey: params.beatPlans[resumeBeatIndex]?.beat.key ?? null,
    preservedBeatBlocks: params.existingBeatBlocks.slice(0, resumeBeatIndex),
    isAlreadyComplete: false,
  };
}

function summarizeBeatBlocks(blocks: GeneratedVolumeChapterBlock[]): string {
  if (blocks.length === 0) {
    return "none";
  }
  return blocks
    .map((block) => (
      `${block.beatLabel} (${block.beatKey}) | ${block.chapterCount}章 | ${
        block.chapters.map((chapter, index) => `第${index + 1}章 ${chapter.title}`).join(" / ")
      }`
    ))
    .join("\n");
}

function buildExistingBeatBlocks(params: {
  volume: VolumePlan;
  beatSheet: VolumeBeatSheet;
}): GeneratedVolumeChapterBlock[] {
  return params.beatSheet.beats.map((beat) => {
    const chapters = params.volume.chapters
      .slice()
      .sort((left, right) => left.chapterOrder - right.chapterOrder)
      .filter((chapter) => resolveVolumeChapterBeatKey({
        chapter,
        volume: params.volume,
        beatSheet: params.beatSheet,
      }) === beat.key)
      .map((chapter) => ({
        beatKey: beat.key,
        title: chapter.title,
        summary: chapter.summary,
        ...(chapter.plannedCharacterIds !== undefined ? {plannedCharacterIds: chapter.plannedCharacterIds} : {}),
      }));

    return {
      beatKey: beat.key,
      beatLabel: beat.label,
      chapterCount: chapters.length,
      chapters,
    };
  });
}

function buildPreviousBeatSummary(params: {
  generationMode: "full_volume" | "single_beat";
  generatedBlocks: GeneratedVolumeChapterBlock[];
  existingBeatBlocks: GeneratedVolumeChapterBlock[];
  preservedBeatBlocks?: GeneratedVolumeChapterBlock[];
  targetBeatIndex: number;
}): string {
  if (params.generationMode === "full_volume") {
    return summarizeBeatBlocks([...(params.preservedBeatBlocks ?? []), ...params.generatedBlocks]);
  }
  return summarizeBeatBlocks(params.existingBeatBlocks.slice(0, params.targetBeatIndex));
}

function buildPreservedBeatSummary(params: {
  existingBeatBlocks: GeneratedVolumeChapterBlock[];
  targetBeatIndex: number;
}): string {
  return summarizeBeatBlocks(params.existingBeatBlocks
    .slice(params.targetBeatIndex + 1)
    .filter((block) => block.chapters.length > 0));
}

function assertMergedVolumeChapterList(params: {
  volume: VolumePlan;
  beatSheet: VolumeBeatSheet;
  generationMode: "full_volume" | "single_beat";
  targetBeatKey?: string | null;
}): void {
  const sortedChapters = params.volume.chapters
    .slice()
    .sort((left, right) => left.chapterOrder - right.chapterOrder);

  for (const beat of params.beatSheet.beats) {
    if (params.generationMode === "single_beat" && beat.key !== params.targetBeatKey) {
      continue;
    }
    const expectedChapterCount = Math.max(1, getBeatExpectedChapterCount(beat));
    const matchedChapters = sortedChapters.filter((chapter) => resolveVolumeChapterBeatKey({
      chapter,
      volume: params.volume,
      beatSheet: params.beatSheet,
    }) === beat.key);
    if (matchedChapters.length !== expectedChapterCount) {
      throw new Error(`当前卷节奏段「${beat.label}」应有 ${expectedChapterCount} 章，实际只有 ${matchedChapters.length} 章。`);
    }
  }
}

function isMergedVolumeChapterListComplete(params: {
  volume: VolumePlan;
  beatSheet: VolumeBeatSheet;
}): boolean {
  const sortedChapters = params.volume.chapters
    .slice()
    .sort((left, right) => left.chapterOrder - right.chapterOrder);

  return params.beatSheet.beats.every((beat) => {
    const expectedChapterCount = Math.max(1, getBeatExpectedChapterCount(beat));
    const matchedChapterCount = sortedChapters.filter((chapter) => resolveVolumeChapterBeatKey({
      chapter,
      volume: params.volume,
      beatSheet: params.beatSheet,
    }) === beat.key).length;
    return matchedChapterCount === expectedChapterCount;
  });
}

// 章节列表单次生成的输出 token 预算与分块阈值。
// 背景：一次要求生成的章数过多时，整段 JSON 会超过输出上限被截断，归类为
// incomplete_json；补括号式截断修复救不回字符串中间的截断，语义重试又不调预算，
// 于是连续失败。这里抬高单次预算，并对超过安全章数的 beat 再分块，保证每次请求的
// 输出都落在预算内，从根因上消除该失败。
const CHAPTER_LIST_MAX_OUTPUT_TOKENS = 8192;
const CHAPTER_LIST_CHUNK_SAFE_CHAPTERS = 12;

function resolveChapterListMaxTokens(chapterCount: number, entrypoint?: string): number {
  const perChapterTokens = entrypoint === "director_next" ? 600 : 420;
  return Math.min(
    CHAPTER_LIST_MAX_OUTPUT_TOKENS,
    900 + chapterCount * perChapterTokens,
  );
}

interface ChapterChunkPlan {
  chapterCount: number;
  chapterStartOrder: number;
  chapterEndOrder: number;
}

function splitBeatIntoChapterChunks(beatPlan: BeatGenerationPlan): ChapterChunkPlan[] {
  const total = beatPlan.chapterCount;
  if (total <= CHAPTER_LIST_CHUNK_SAFE_CHAPTERS) {
    return [{
      chapterCount: total,
      chapterStartOrder: beatPlan.chapterStartOrder,
      chapterEndOrder: beatPlan.chapterEndOrder,
    }];
  }
  const chunks: ChapterChunkPlan[] = [];
  let cursor = beatPlan.chapterStartOrder;
  let remaining = total;
  while (remaining > 0) {
    const size = Math.min(CHAPTER_LIST_CHUNK_SAFE_CHAPTERS, remaining);
    chunks.push({
      chapterCount: size,
      chapterStartOrder: cursor,
      chapterEndOrder: cursor + size - 1,
    });
    cursor += size;
    remaining -= size;
  }
  return chunks;
}

function appendChunkCarryoverSummary(
  base: string | null | undefined,
  chapters: GeneratedVolumeChapterBlock["chapters"],
  beatLabel: string,
): string {
  const lines = chapters.map((chapter) => `- ${chapter.title}：${chapter.summary}`);
  const block = [
    `【同一节奏段「${beatLabel}」已生成的前置章节，后续章节必须承接其局面，不得重复起线】`,
    ...lines,
    "【以上章节名均已被占用，后续章节不得重复使用】",
  ].join("\n");
  const trimmedBase = base?.trim();
  return trimmedBase ? `${trimmedBase}\n${block}` : block;
}

const CHAPTER_TITLE_COLLISION_REPAIR_ROUNDS = 2;

function isChapterTitleCollisionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("章节标题出现重复");
}

function buildChapterTitleCollisionRepairReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const matched = message.match(/章节标题出现重复：(.+?)。/);
  const collidedTitle = matched?.[1]?.trim();
  return [
    collidedTitle
      ? `标题撞车：「${collidedTitle}」已被其他章节占用。`
      : "标题撞车：输出中仍有章节标题与已占用标题重复。",
    "必须把这些章节的标题完全换一个写法：更换对象、动作、地点或角度。",
    "不得使用近似变体——只增删一两个字、只换语序都算没有换。",
    "也不得使用已占用清单中的任何其他标题；其余章节标题如无重复可保持不变。",
  ].join("\n");
}

interface MergedChapterTitleDedupContext {
  volumeTitle: string;
  beatLabels: Map<string, string>;
  options: VolumeGenerateOptions;
  novelId: string;
  volumeId: string;
}

function findDuplicateChapterTitleGroups<T extends { title: string }>(chapters: T[]): T[][] {
  const byTitle = new Map<string, T[]>();
  for (const chapter of chapters) {
    const title = chapter.title.trim();
    if (!title) continue;
    const bucket = byTitle.get(title);
    if (bucket) {
      bucket.push(chapter);
    } else {
      byTitle.set(title, [chapter]);
    }
  }
  return [...byTitle.values()].filter((bucket) => bucket.length > 1);
}

/**
 * 确定性兜底：消重调用失败或仍有残留时，保证标题唯一（进程不中断）。
 * 每组重复标题保留第一个，其余按「·二 / ·三」追加序号直到唯一。
 */
function applyDeterministicChapterTitleFallback<T extends { title: string }>(chapters: T[]): string[] {
  const usedTitles = new Set(chapters.map((chapter) => chapter.title.trim()).filter(Boolean));
  const occurrenceCounts = new Map<string, number>();
  const fallbackTitles: string[] = [];
  const ordinalLabels = ["二", "三", "四", "五", "六", "七", "八", "九", "十"];

  for (const chapter of chapters) {
    const title = chapter.title.trim();
    if (!title) continue;
    const occurrence = (occurrenceCounts.get(title) ?? 0) + 1;
    occurrenceCounts.set(title, occurrence);
    if (occurrence === 1) continue;

    let ordinal = occurrence;
    let candidate = `${title}·${ordinalLabels[ordinal - 2] ?? ordinal}`;
    while (usedTitles.has(candidate)) {
      ordinal += 1;
      candidate = `${title}·${ordinalLabels[ordinal - 2] ?? ordinal}`;
    }
    usedTitles.add(candidate);
    chapter.title = candidate;
    fallbackTitles.push(candidate);
  }

  return fallbackTitles;
}

/**
 * 合并层标题消重：分块/跨 beat 生成后，模型无视长占用清单时仍可能漏出重复标题。
 * 以前这里直接抛错葬送整个 attempt；现在先做聚焦重命名（小块输入 + 明确禁用清单），
 * 失败再走确定性兜底，最后才交给 assertChapterTitleDiversity 兜底校验。
 */
async function ensureUniqueMergedChapterTitles<T extends { title: string; summary: string; beatKey?: string | null; chapterOrder: number }>(
  chapters: T[],
  context: MergedChapterTitleDedupContext,
): Promise<{ repairedTitles: string[]; fallbackTitles: string[] }> {
  const duplicateGroups = findDuplicateChapterTitleGroups(chapters);
  if (duplicateGroups.length === 0) {
    return { repairedTitles: [], fallbackTitles: [] };
  }

  const renameTargets = duplicateGroups.flatMap((group) => group.slice(1).map((chapter) => ({
    chapterOrder: chapter.chapterOrder,
    beatLabel: context.beatLabels.get(chapter.beatKey ?? "") ?? "未知节奏段",
    title: chapter.title,
    summary: chapter.summary,
  })));
  const reservedTitles = chapters.map((chapter) => chapter.title.trim()).filter(Boolean);

  const renames = new Map<number, string>();
  try {
    const result = await runStructuredPrompt({
      asset: chapterTitleDedupPrompt,
      promptInput: {
        volumeTitle: context.volumeTitle,
        duplicates: renameTargets,
        reservedTitles,
      },
      options: {
        provider: context.options.provider,
        model: context.options.model,
        temperature: 0.3,
        maxTokens: 1024,
        novelId: context.novelId,
        volumeId: context.volumeId,
        taskId: context.options.taskId,
        stage: "structured_outline",
        itemKey: "chapter_title_dedup",
        scope: "chapter_list",
        entrypoint: context.options.entrypoint,
        signal: context.options.signal,
      },
    });
    for (const rename of result.output.renames) {
      renames.set(rename.chapterOrder, rename.title.trim());
    }
  } catch {
    // 消重调用失败不阻断生成：走确定性兜底
  }

  for (const chapter of chapters) {
    const renamed = renames.get(chapter.chapterOrder);
    if (renamed) {
      chapter.title = renamed;
    }
  }

  const fallbackTitles = applyDeterministicChapterTitleFallback(chapters);
  return { repairedTitles: [...renames.values()], fallbackTitles };
}

/**
 * Whole-volume chapter-title gate for merged chapter lists.
 *
 * Title quality findings split into three bands:
 * - blocking (duplicate titles, first-person, overlong, synopsis-like titles)
 *   fail at every phase, including intermediate merges;
 * - severe concentration (a single surface frame covering half of the list or
 *   more) fails at the final gate;
 * - marginal concentration (over the frame allowance by at most one title and
 *   still below half of the list) no longer fails generation: the finished
 *   list is accepted and the finding is handed to the caller as quality debt.
 *
 * Concentration is judged only at the final gate because it is a whole-volume
 * property: a partial merge can still be diluted by later beats.
 */
async function enforceMergedChapterTitleGate(params: {
  volume: VolumePlan;
  options: VolumeGenerateOptions;
  phase: "intermediate" | "final";
}): Promise<void> {
  const sortedChapters = params.volume.chapters
    .slice()
    .sort((left, right) => left.chapterOrder - right.chapterOrder);
  const assessment = assessChapterTitleDiversity(sortedChapters.map((chapter) => chapter.title));
  if (!assessment) {
    return;
  }
  if (assessment.severity === "blocking") {
    throw new Error(assessment.issue);
  }
  if (params.phase === "intermediate") {
    return;
  }
  if (assessment.severity === "severe") {
    throw new Error(assessment.issue);
  }
  const offendingTitles = new Set(assessment.offendingTitles);
  const firstOffendingChapter = sortedChapters.find((chapter) => offendingTitles.has(chapter.title));
  await params.options.onChapterTitleDiversityDebt?.({
    volumeId: params.volume.id,
    issue: assessment.issue,
    chapterOrder: firstOffendingChapter?.chapterOrder ?? sortedChapters[0]?.chapterOrder ?? 1,
  });
}

async function generateBeatChapterBlock(params: {
  document: VolumePlanDocument;
  workspace: VolumeWorkspace;
  novel: VolumeGenerationNovel;
  storyMacroPlan: StoryMacroPlanResult;
  options: VolumeGenerateOptions;
  targetVolume: VolumePlan;
  targetBeatSheet: VolumeBeatSheet;
  beatPlan: BeatGenerationPlan;
  previousBeat?: VolumeBeat | null;
  nextBeat?: VolumeBeat | null;
  previousBeatChapterSummary?: string | null;
  preservedBeatChapterSummary?: string | null;
  chapterBudgets: number[];
  /** 本次运行内已生成 beat 的章节标题（document 不随循环更新，需显式下传，防止跨 beat 撞车） */
  accumulatedChapterTitles?: string[];
}): Promise<GeneratedVolumeChapterBlock> {
  const targetIndex = params.document.volumes.findIndex((volume) => volume.id === params.targetVolume.id);
  const beatIsBookFinale = isCompactBookFinaleBeat({
    completionProfile: params.novel.completionProfile,
    targetVolumeIndex: targetIndex,
    chapterBudgets: params.chapterBudgets,
    beatChapterEndOrder: params.beatPlan.chapterEndOrder,
  });
  const reservedChapterTitles = Array.from(new Set([
    ...(params.accumulatedChapterTitles ?? []),
    ...params.targetVolume.chapters
      .filter((chapter) => chapter.beatKey !== params.beatPlan.beat.key)
      .map((chapter) => chapter.title),
  ]));
  const characterIds = params.options.entrypoint === "director_next" ? params.novel.characters.map(character => {
    if (!character.id) throw new Error("角色出场初排缺少角色 ID。");
    return character.id;
  }) : undefined;

  const runChunk = async (
    chunk: ChapterChunkPlan,
    carryoverSummary: string | null,
    reservedTitles: string[],
  ): Promise<GeneratedVolumeChapterBlock> => {
    const promptInput = {
      novel: params.novel,
      workspace: params.workspace,
      storyMacroPlan: params.storyMacroPlan,
      strategyPlan: params.document.strategyPlan,
      targetVolume: params.targetVolume,
      targetBeatSheet: params.targetBeatSheet,
      targetBeat: params.beatPlan.beat,
      previousBeat: params.previousBeat,
      nextBeat: params.nextBeat,
      previousVolume: targetIndex > 0 ? params.document.volumes[targetIndex - 1] : undefined,
      nextVolume: targetIndex >= 0 && targetIndex < params.document.volumes.length - 1
        ? params.document.volumes[targetIndex + 1]
        : undefined,
      guidance: params.options.guidance,
      targetBeatChapterCount: chunk.chapterCount,
      targetChapterStartOrder: chunk.chapterStartOrder,
      targetChapterEndOrder: chunk.chapterEndOrder,
      nextAvailableChapterOrder: chunk.chapterStartOrder,
      previousBeatChapterSummary: carryoverSummary,
      preservedBeatChapterSummary: params.preservedBeatChapterSummary,
    };

    let retryReason: string | null = null;
    for (let round = 0; round <= CHAPTER_TITLE_COLLISION_REPAIR_ROUNDS; round += 1) {
      try {
        const generated = await runStructuredPrompt({
          asset: createVolumeChapterListPrompt({
            targetChapterCount: chunk.chapterCount,
            targetBeatKey: params.beatPlan.beat.key,
            targetBeatLabel: params.beatPlan.beat.label,
            isBookFinale: beatIsBookFinale && chunk.chapterEndOrder === params.beatPlan.chapterEndOrder,
            reservedChapterTitles: reservedTitles,
            characterIds,
          }),
          promptInput: { ...promptInput, retryReason },
          contextBlocks: buildVolumeChapterListContextBlocks(promptInput),
          options: {
            provider: params.options.provider,
            model: params.options.model,
            temperature: params.options.temperature ?? 0.35,
            maxTokens: resolveChapterListMaxTokens(chunk.chapterCount, params.options.entrypoint),
            novelId: params.document.novelId,
            volumeId: params.targetVolume.id,
            taskId: params.options.taskId,
            stage: "structured_outline",
            itemKey: "chapter_list",
            scope: "chapter_list",
            entrypoint: params.options.entrypoint,
            signal: params.options.signal,
          },
        });

        return generated.output;
      } catch (error) {
        // 仅对标题撞车做聚焦修复：大 beat 分块后占用清单可达上百条，
        // 模型经常无视长清单继续产出近似变体；但对「这个具体标题被占用、
        // 必须完全换角度」的短指令响应良好。其他错误原样抛出。
        if (round >= CHAPTER_TITLE_COLLISION_REPAIR_ROUNDS || !isChapterTitleCollisionError(error)) {
          throw error;
        }
        retryReason = buildChapterTitleCollisionRepairReason(error);
      }
    }

    throw new Error("章节标题撞车修复轮次用尽。");
  };

  const chunks = splitBeatIntoChapterChunks(params.beatPlan);
  const currentBeatTitles: string[] = [];
  // 同 beat 已生成标题排在占用清单最前：分块撞车几乎都发生在同 beat 内
  // （各块重写同一段故事），把最相关的约束放在模型注意力最强的位置。
  const orderedReservedTitles = () => Array.from(new Set([...currentBeatTitles, ...reservedChapterTitles]));
  if (chunks.length <= 1) {
    return runChunk(chunks[0]!, params.previousBeatChapterSummary ?? null, orderedReservedTitles());
  }

  const collectedChapters: GeneratedVolumeChapterBlock["chapters"] = [];
  let carryoverSummary: string | null = params.previousBeatChapterSummary ?? null;
  for (const chunk of chunks) {
    const block = await runChunk(chunk, carryoverSummary, orderedReservedTitles());
    if (block.beatKey !== params.beatPlan.beat.key) {
      throw new Error(`节奏段「${params.beatPlan.beat.label}」分块生成的 beatKey 不一致。`);
    }
    collectedChapters.push(...block.chapters);
    currentBeatTitles.push(...block.chapters.map((chapter) => chapter.title));
    carryoverSummary = appendChunkCarryoverSummary(
      carryoverSummary,
      block.chapters,
      params.beatPlan.beat.label,
    );
  }

  if (collectedChapters.length !== params.beatPlan.chapterCount) {
    throw new Error(
      `节奏段「${params.beatPlan.beat.label}」分块生成后共 ${collectedChapters.length} 章，应为 ${params.beatPlan.chapterCount} 章。`,
    );
  }

  return {
    beatKey: params.beatPlan.beat.key,
    beatLabel: params.beatPlan.beat.label,
    chapterCount: params.beatPlan.chapterCount,
    chapters: collectedChapters,
  };
}

export async function generateBeatChunkedChapterList(params: {
  document: VolumePlanDocument;
  novel: VolumeGenerationNovel;
  workspace: VolumeWorkspace;
  storyMacroPlan: StoryMacroPlanResult;
  options: VolumeGenerateOptions;
  notifyPhase: (label: string) => Promise<void>;
  notifyIntermediateDocument?: (event: VolumeIntermediateDocumentEvent) => void | Promise<void>;
}): Promise<{
  mergedDocument: VolumePlanDocument;
  mergedWorkspace: VolumeWorkspace;
}> {
  const { document, workspace, storyMacroPlan, options } = params;
  const generationMode = options.generationMode ?? "full_volume";
  const explicitChapterCount = normalizeExplicitChapterCount(options.estimatedChapterCount);
  const novel: VolumeGenerationNovel = explicitChapterCount
    ? {
      ...params.novel,
      estimatedChapterCount: explicitChapterCount,
      completionProfile: buildDirectorCompletionProfile(explicitChapterCount),
    }
    : params.novel;
  const targetVolume = getTargetVolume(document, options.targetVolumeId);
  const savedTargetBeatSheet = getBeatSheet(document, targetVolume.id);
  logMemoryUsage({
    event: "start",
    component: "generateBeatChunkedChapterList",
    taskId: options.taskId,
    novelId: document.novelId,
    stage: "structured_outline",
    itemKey: "chapter_list",
    scope: options.generationMode ?? "full_volume",
    entrypoint: options.entrypoint,
    volumeId: targetVolume.id,
    volumeCount: document.volumes.length,
    chapterCount: document.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0),
    beatSheetCount: document.beatSheets.length,
  });
  if (!savedTargetBeatSheet) {
    throw new Error("当前卷还没有节奏板，不能直接拆章节列表。");
  }

  const chapterBudget = deriveChapterBudget({ novel, workspace, options });
  const chapterBudgets = allocateChapterBudgets({
    volumeCount: Math.max(document.volumes.length, 1),
    chapterBudget,
    existingVolumes: document.volumes,
  });
  const targetIndex = document.volumes.findIndex((volume) => volume.id === targetVolume.id);
  const explicitVolumeChapterCount = explicitChapterCount && generationMode === "full_volume"
    ? Math.max(1, chapterBudgets[targetIndex] ?? explicitChapterCount)
    : null;
  const targetBeatSheet = explicitVolumeChapterCount
    ? scaleBeatSheetToChapterCount(savedTargetBeatSheet, explicitVolumeChapterCount)
    : savedTargetBeatSheet;
  const beatSheetRequiredChapterCount = inferRequiredChapterCountFromBeatSheet(targetBeatSheet);
  // 正在生成的卷当前章数是进度而非计划规模，其预算不得低于均分份额（issue #173）。
  const fallbackTargetChapterCount = Math.max(
    chapterBudgets[targetIndex] ?? 0,
    resolveEvenShareChapterBudget(chapterBudget, document.volumes.length),
  );
  // Legacy or partially generated workspaces may only carry a few seed chapters for the opening beat.
  // Those placeholders should not shrink the trusted chapter budget below the planned volume size.
  const budgetedTargetChapterCount = explicitVolumeChapterCount
    ?? Math.max(targetVolume.chapters.length, fallbackTargetChapterCount);
  const resolvedTargetChapterCount = explicitVolumeChapterCount
    ? {
      targetChapterCount: explicitVolumeChapterCount,
      beatSheetCountAccepted: true,
      maxTrustedChapterCount: explicitVolumeChapterCount,
    }
    : resolveTargetChapterCount({
      budgetedChapterCount: budgetedTargetChapterCount,
      beatSheetRequiredChapterCount,
    });
  if (!resolvedTargetChapterCount.beatSheetCountAccepted && beatSheetRequiredChapterCount > 0) {
    throw new Error("当前卷节奏板的章节跨度异常，建议先重生成节奏板，再继续生成章节标题。");
  }
  if (resolvedTargetChapterCount.targetChapterCount >= 20) {
    const beatSheetCoverage = validateBeatSheetChapterCoverage({
      beatSheet: targetBeatSheet,
      targetChapterCount: resolvedTargetChapterCount.targetChapterCount,
    });
    if (!beatSheetCoverage.accepted) {
      throw new Error(`${beatSheetCoverage.message ?? "当前卷节奏板章节跨度没有覆盖目标章数。"}建议先重生成节奏板，再继续生成章节标题。`);
    }
  }

  const beatPlans = buildBeatGenerationPlans(targetBeatSheet);
  const existingBeatBlocks = buildExistingBeatBlocks({
    volume: targetVolume,
    beatSheet: targetBeatSheet,
  });
  const fullVolumeResumeState = generationMode === "full_volume"
    ? resolveFullVolumeResumeState({
      beatPlans,
      existingBeatBlocks,
    })
    : null;
  const targetBeatIndex = generationMode === "single_beat"
    ? beatPlans.findIndex((plan) => plan.beat.key === options.targetBeatKey)
    : -1;
  if (generationMode === "single_beat" && targetBeatIndex < 0) {
    throw new Error("目标节奏段不存在，无法重生章节标题。");
  }

  const generatedBlocks: GeneratedVolumeChapterBlock[] = [];
  const plansToRun = generationMode === "single_beat"
    ? [beatPlans[targetBeatIndex]]
    : beatPlans.slice(fullVolumeResumeState?.resumeBeatIndex ?? 0);

  if (
    generationMode === "full_volume"
    && fullVolumeResumeState?.isAlreadyComplete
    && !isVolumeChapterListPartiallyPersisted(targetVolume)
  ) {
    return {
      mergedDocument: document,
      mergedWorkspace: {
        ...workspace,
        ...document,
      },
    };
  }

  for (const beatPlan of plansToRun) {
    await params.notifyPhase(
      generationMode === "single_beat"
        ? `正在重写第 ${targetVolume.sortOrder} 卷节奏段：${beatPlan.beat.label}`
        : `正在生成第 ${targetVolume.sortOrder} 卷节奏段：${beatPlan.beat.label}`,
    );

    const currentBeatIndex = beatPlans.findIndex((plan) => plan.beat.key === beatPlan.beat.key);
    const generatedBlock = await generateBeatChapterBlock({
      document,
      workspace,
      novel,
      storyMacroPlan,
      options,
      targetVolume,
      targetBeatSheet,
      beatPlan,
      previousBeat: currentBeatIndex > 0 ? beatPlans[currentBeatIndex - 1]?.beat ?? null : null,
      nextBeat: currentBeatIndex < beatPlans.length - 1 ? beatPlans[currentBeatIndex + 1]?.beat ?? null : null,
      previousBeatChapterSummary: buildPreviousBeatSummary({
        generationMode,
        generatedBlocks,
        existingBeatBlocks,
        preservedBeatBlocks: fullVolumeResumeState?.preservedBeatBlocks,
        targetBeatIndex: currentBeatIndex,
      }),
      preservedBeatChapterSummary: generationMode === "single_beat"
        ? buildPreservedBeatSummary({
            existingBeatBlocks,
            targetBeatIndex: currentBeatIndex,
          })
        : null,
      chapterBudgets,
      // 本次运行内已生成 beat 的标题必须下传给后续 beat：
      // beat 循环复用原始 document，targetVolume.chapters 不会累积，
      // 不下传则每个 beat 的保留标题列表为空，跨 beat 撞车只能等合并断言才炸。
      accumulatedChapterTitles: generatedBlocks.flatMap((block) => block.chapters.map((chapter) => chapter.title)),
    });
    generatedBlocks.push(generatedBlock);

    const intermediateDocument = mergeChapterList(
      document,
      targetVolume.id,
      targetBeatSheet,
      generatedBlocks,
      {
        generationMode,
        targetBeatKey: options.targetBeatKey,
        resumeFromBeatKey: fullVolumeResumeState?.resumeBeatKey,
        markAsPartial: true,
      },
    );
    const intermediateVolume = intermediateDocument.volumes.find((volume) => volume.id === targetVolume.id);
    if (!intermediateVolume) {
      throw new Error("当前卷章节列表已生成，但中间合并结果丢失了目标卷。");
    }
    // 跨块/跨 beat 撞车兜底：聚焦重命名修复 + 确定性兜底，避免一次撞车葬送整个 attempt
    await ensureUniqueMergedChapterTitles(intermediateVolume.chapters, {
      volumeTitle: targetVolume.title,
      beatLabels: new Map(targetBeatSheet.beats.map((beat) => [beat.key, beat.label])),
      options,
      novelId: document.novelId,
      volumeId: targetVolume.id,
    });
    await enforceMergedChapterTitleGate({
      volume: intermediateVolume,
      options,
      phase: "intermediate",
    });
    await params.notifyIntermediateDocument?.({
      scope: "chapter_list",
      document: intermediateDocument,
      isFinal: false,
      targetVolumeId: targetVolume.id,
      targetBeatKey: beatPlan.beat.key,
      generationMode,
    });
  }

  logMemoryUsage({
    event: "before_merge",
    component: "mergeChapterList",
    taskId: options.taskId,
    novelId: document.novelId,
    stage: "structured_outline",
    itemKey: "chapter_list",
    scope: generationMode,
    entrypoint: options.entrypoint,
    volumeId: targetVolume.id,
    chapterCount: generatedBlocks.reduce((sum, block) => sum + block.chapters.length, 0),
  });
  const rawMergedDocument = generatedBlocks.length > 0
    ? mergeChapterList(
      document,
      targetVolume.id,
      targetBeatSheet,
      generatedBlocks,
      {
        generationMode,
        targetBeatKey: options.targetBeatKey,
        resumeFromBeatKey: fullVolumeResumeState?.resumeBeatKey,
        markAsPartial: false,
      },
    )
    : setVolumeChapterListPartialStatus(document, targetVolume.id, false);
  const rawMergedVolume = rawMergedDocument.volumes.find((volume) => volume.id === targetVolume.id);
  if (!rawMergedVolume) {
    throw new Error("当前卷章节列表已生成，但合并结果丢失了目标卷。");
  }
  // 最终合并同样走撞车兜底（此处修复的才是真正返回给调用方的文档）
  await ensureUniqueMergedChapterTitles(rawMergedVolume.chapters, {
    volumeTitle: targetVolume.title,
    beatLabels: new Map(targetBeatSheet.beats.map((beat) => [beat.key, beat.label])),
    options,
    novelId: document.novelId,
    volumeId: targetVolume.id,
  });
  await enforceMergedChapterTitleGate({
    volume: rawMergedVolume,
    options,
    phase: "final",
  });
  assertMergedVolumeChapterList({
    volume: rawMergedVolume,
    beatSheet: targetBeatSheet,
    generationMode,
    targetBeatKey: options.targetBeatKey,
  });
  const mergedDocument = isMergedVolumeChapterListComplete({
    volume: rawMergedVolume,
    beatSheet: targetBeatSheet,
  })
    ? setVolumeChapterListPartialStatus(rawMergedDocument, targetVolume.id, false)
    : setVolumeChapterListPartialStatus(rawMergedDocument, targetVolume.id, true);
  const mergedVolume = mergedDocument.volumes.find((volume) => volume.id === targetVolume.id);
  if (!mergedVolume) {
    throw new Error("当前卷章节列表已生成，但合并结果丢失了目标卷。");
  }
  logMemoryUsage({
    event: "after_merge",
    component: "mergeChapterList",
    taskId: options.taskId,
    novelId: document.novelId,
    stage: "structured_outline",
    itemKey: "chapter_list",
    scope: generationMode,
    entrypoint: options.entrypoint,
    volumeId: targetVolume.id,
    volumeCount: mergedDocument.volumes.length,
    chapterCount: mergedDocument.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0),
    beatSheetCount: mergedDocument.beatSheets.length,
  });
  await params.notifyIntermediateDocument?.({
    scope: "chapter_list",
    document: mergedDocument,
    isFinal: true,
    targetVolumeId: targetVolume.id,
    targetBeatKey: generatedBlocks[generatedBlocks.length - 1]?.beatKey,
    generationMode,
  });

  return {
    mergedDocument,
    mergedWorkspace: {
      ...workspace,
      ...mergedDocument,
    },
  };
}
