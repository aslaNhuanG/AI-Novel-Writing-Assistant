const test = require("node:test");
const assert = require("node:assert/strict");

const promptRunner = require("../dist/prompting/core/promptRunner.js");
const {
  generateBeatChunkedChapterList,
} = require("../dist/services/novel/volume/volumeChapterListGeneration.js");
const {
  chapterTitleDedupPrompt,
} = require("../dist/prompting/prompts/novel/volume/chapterTitleDedup.prompts.js");
const {
  mergeChapterList,
} = require("../dist/services/novel/volume/volumeGenerationHelpers.js");
const {
  buildVolumeWorkspaceDocument,
} = require("../dist/services/novel/volume/volumeWorkspaceDocument.js");
const {
  resolveStructuredOutlineRecoveryCursor,
} = require("../dist/services/novel/director/recovery/novelDirectorStructuredOutlineRecovery.js");

function createChapter(input) {
  return {
    id: input.id,
    volumeId: "volume-1",
    chapterOrder: input.chapterOrder,
    beatKey: input.beatKey ?? null,
    title: input.title,
    summary: input.summary,
    purpose: input.purpose ?? null,
    conflictLevel: input.conflictLevel ?? null,
    revealLevel: input.revealLevel ?? null,
    targetWordCount: input.targetWordCount ?? null,
    mustAvoid: input.mustAvoid ?? null,
    taskSheet: input.taskSheet ?? null,
    sceneCards: input.sceneCards ?? null,
    payoffRefs: input.payoffRefs ?? [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function createDocument() {
  return buildVolumeWorkspaceDocument({
    novelId: "novel-1",
    volumes: [
      {
        id: "volume-1",
        novelId: "novel-1",
        sortOrder: 1,
        title: "第一卷",
        summary: "卷摘要",
        openingHook: "开卷抓手",
        mainPromise: "主承诺",
        primaryPressureSource: "压力源",
        coreSellingPoint: "核心卖点",
        escalationMode: "升级方式",
        protagonistChange: "主角变化",
        midVolumeRisk: "中段风险",
        climax: "高潮",
        payoffType: "兑现类型",
        nextVolumeHook: "下卷钩子",
        resetPoint: null,
        openPayoffs: [],
        status: "active",
        sourceVersionId: null,
        chapters: [
          createChapter({
            id: "chapter-1",
            chapterOrder: 1,
            beatKey: "open_hook",
            title: "旧开卷一",
            summary: "旧开卷摘要一",
            purpose: "保留旧 purpose 1",
          }),
          createChapter({
            id: "chapter-2",
            chapterOrder: 2,
            beatKey: "open_hook",
            title: "旧开卷二",
            summary: "旧开卷摘要二",
            purpose: "保留旧 purpose 2",
          }),
          createChapter({
            id: "chapter-3",
            chapterOrder: 3,
            beatKey: "midpoint_turn",
            title: "旧转向一",
            summary: "旧转向摘要一",
            purpose: "保留旧 purpose 3",
          }),
          createChapter({
            id: "chapter-4",
            chapterOrder: 4,
            beatKey: "midpoint_turn",
            title: "旧转向二",
            summary: "旧转向摘要二",
            purpose: "保留旧 purpose 4",
          }),
        ],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          {
            key: "open_hook",
            label: "开卷抓手",
            summary: "先把局势危险钉死。",
            chapterSpanHint: "1-2章",
            mustDeliver: ["压迫感"],
          },
          {
            key: "midpoint_turn",
            label: "中段转向",
            summary: "让局势方向发生变化。",
            chapterSpanHint: "3-4章",
            mustDeliver: ["转向"],
          },
        ],
      },
    ],
  });
}

test("mergeChapterList writes explicit beat keys for full-volume beat blocks", () => {
  const document = createDocument();
  const merged = mergeChapterList(
    document,
    "volume-1",
    document.beatSheets[0],
    [
      {
        beatKey: "open_hook",
        beatLabel: "开卷抓手",
        chapterCount: 2,
        chapters: [
          { beatKey: "open_hook", title: "新的开卷一", summary: "新的开卷摘要一" },
          { beatKey: "open_hook", title: "新的开卷二", summary: "新的开卷摘要二" },
        ],
      },
      {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "新的转向一", summary: "新的转向摘要一" },
          { beatKey: "midpoint_turn", title: "新的转向二", summary: "新的转向摘要二" },
        ],
      },
    ],
  );

  const chapters = merged.volumes[0].chapters;
  assert.equal(chapters.length, 4);
  assert.deepEqual(chapters.map((chapter) => chapter.beatKey), ["open_hook", "open_hook", "midpoint_turn", "midpoint_turn"]);
  assert.equal(chapters[0].purpose, "保留旧 purpose 1");
  assert.equal(chapters[2].title, "新的转向一");
});

test("mergeChapterList single-beat mode only replaces the targeted beat block", () => {
  const document = createDocument();
  const merged = mergeChapterList(
    document,
    "volume-1",
    document.beatSheets[0],
    [
      {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "重写转向一", summary: "重写转向摘要一" },
          { beatKey: "midpoint_turn", title: "重写转向二", summary: "重写转向摘要二" },
        ],
      },
    ],
    {
      generationMode: "single_beat",
      targetBeatKey: "midpoint_turn",
    },
  );

  const chapters = merged.volumes[0].chapters;
  assert.equal(chapters.length, 4);
  assert.equal(chapters[0].title, "旧开卷一");
  assert.equal(chapters[1].title, "旧开卷二");
  assert.equal(chapters[2].title, "重写转向一");
  assert.equal(chapters[3].title, "重写转向二");
  assert.equal(chapters[2].purpose, "保留旧 purpose 3");
});

test("mergeChapterList full-volume resume preserves completed prefix beats", () => {
  const document = createDocument();
  const merged = mergeChapterList(
    document,
    "volume-1",
    document.beatSheets[0],
    [
      {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "续跑转向一", summary: "续跑转向摘要一" },
          { beatKey: "midpoint_turn", title: "续跑转向二", summary: "续跑转向摘要二" },
        ],
      },
    ],
    {
      generationMode: "full_volume",
      resumeFromBeatKey: "midpoint_turn",
    },
  );

  const chapters = merged.volumes[0].chapters;
  assert.equal(chapters.length, 4);
  assert.equal(chapters[0].title, "旧开卷一");
  assert.equal(chapters[1].title, "旧开卷二");
  assert.equal(chapters[2].title, "续跑转向一");
  assert.equal(chapters[3].title, "续跑转向二");
  assert.equal(chapters[0].purpose, "保留旧 purpose 1");
});

test("single-beat generation does not repeat completed beat titles in locked context", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let receivedPromptInput = null;

  promptRunner.runStructuredPrompt = async ({ promptInput }) => {
    receivedPromptInput = promptInput;
    return {
      output: {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "转折逼近", summary: "主角面对新局面，必须改变原有判断。" },
          { beatKey: "midpoint_turn", title: "退路封死", summary: "新的压力落地，迫使主角进入下一阶段。" },
        ],
      },
    };
  };

  try {
    await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 4, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "midpoint_turn" },
      notifyPhase: async () => {},
    });

    assert.match(receivedPromptInput.previousBeatChapterSummary, /旧开卷一/);
    assert.equal(receivedPromptInput.preservedBeatChapterSummary, "none");
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test('V2 saves initial cast schedules in the existing beat calls without a separate model step',async()=>{
  const document=createDocument();
  document.volumes[0].chapters=[];
  const original=promptRunner.runStructuredPrompt;
  let calls=0;
  promptRunner.runStructuredPrompt=async({asset,promptInput})=>{
    calls++;
    assert.equal(asset.version,'v10');
    return {output:asset.outputSchema.parse({beatKey:promptInput.targetBeat.key,beatLabel:promptInput.targetBeat.label,
      chapterCount:promptInput.targetBeatChapterCount,chapters:Array.from({length:promptInput.targetBeatChapterCount},(_,i)=>({
        title:(promptInput.targetBeat.key==='open_hook'?'药铺开门':'医馆封门')+i,summary:'青禾主动选择救治伤者，打破官差追捕的僵局并承担药方暴露的代价。',
        beatKey:promptInput.targetBeat.key,plannedCharacterIds:i===0?['qing']:[],
      }))})};
  };
  try{
    const result=await generateBeatChunkedChapterList({document,
      novel:{title:'测试',estimatedChapterCount:4,characters:[{id:'qing',name:'青禾',role:'主角'}]},
      workspace:{...document,workspaceVersion:'v2',readiness:{}},storyMacroPlan:null,
      options:{targetVolumeId:'volume-1',generationMode:'full_volume',entrypoint:'director_next'},notifyPhase:async()=>{}});
    assert.equal(calls,2,'two beats use only the original two split requests');
    assert.deepEqual(result.mergedDocument.volumes[0].chapters.map(c=>c.plannedCharacterIds),[['qing'],[],['qing'],[]]);
  }finally{promptRunner.runStructuredPrompt=original;}
});

test("single-beat generation repairs a copied beat title instead of failing the run", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let intermediateDocumentCount = 0;
  let dedupPromptInput = null;

  promptRunner.runStructuredPrompt = async ({ asset, promptInput }) => {
    if (asset.id === "novel.volume.chapter_title_dedup") {
      dedupPromptInput = promptInput;
      return {
        output: {
          renames: [{ chapterOrder: promptInput.duplicates[0].chapterOrder, title: "旧名换新题" }],
        },
      };
    }
    return {
      output: {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "旧开卷一", summary: "错误地复述了已有章节标题。" },
          { beatKey: "midpoint_turn", title: "退路封死", summary: "新的压力落地，迫使主角进入下一阶段。" },
        ],
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 4, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "midpoint_turn" },
      notifyPhase: async () => {},
      notifyIntermediateDocument: async () => { intermediateDocumentCount += 1; },
    });

    // 撞车不再抛错：走聚焦重命名，中间态与最终文档都带着修复后的标题继续
    assert.ok(dedupPromptInput, "应调用标题消重提示词");
    assert.equal(dedupPromptInput.duplicates.length, 1);
    assert.equal(dedupPromptInput.duplicates[0].title, "旧开卷一");
    assert.ok(dedupPromptInput.reservedTitles.includes("旧开卷一"));
    const titles = result.mergedDocument.volumes[0].chapters.map((chapter) => chapter.title);
    assert.deepEqual(titles, ["旧开卷一", "旧开卷二", "旧名换新题", "退路封死"]);
    assert.equal(new Set(titles).size, titles.length);
    assert.ok(intermediateDocumentCount >= 1);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("merged duplicate titles fall back to deterministic disambiguation when dedup fails", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;

  promptRunner.runStructuredPrompt = async ({ asset }) => {
    if (asset.id === "novel.volume.chapter_title_dedup") {
      throw new Error("模型服务暂时不可用。");
    }
    return {
      output: {
        beatKey: "midpoint_turn",
        beatLabel: "中段转向",
        chapterCount: 2,
        chapters: [
          { beatKey: "midpoint_turn", title: "旧开卷一", summary: "错误地复述了已有章节标题。" },
          { beatKey: "midpoint_turn", title: "退路封死", summary: "新的压力落地，迫使主角进入下一阶段。" },
        ],
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 4, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "midpoint_turn" },
      notifyPhase: async () => {},
    });

    // 消重调用失败也不阻断：确定性兜底保证唯一（保留第一个，其余加「·二」）
    const titles = result.mergedDocument.volumes[0].chapters.map((chapter) => chapter.title);
    assert.deepEqual(titles, ["旧开卷一", "旧开卷二", "旧开卷一·二", "退路封死"]);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList skips full-volume regeneration when all beats are already complete", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let promptCallCount = 0;
  const notifyCalls = [];

  promptRunner.runStructuredPrompt = async () => {
    promptCallCount += 1;
    throw new Error("should not generate chapter list again");
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...document,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "full_volume",
      },
      notifyPhase: async (label) => {
        notifyCalls.push(label);
      },
    });

    assert.equal(promptCallCount, 0);
    assert.deepEqual(notifyCalls, []);
    assert.deepEqual(result.mergedDocument.volumes[0].chapters, document.volumes[0].chapters);
    assert.deepEqual(result.mergedWorkspace.volumes[0].chapters, document.volumes[0].chapters);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList rejects beat sheets that cover far fewer chapters than the budget target", async () => {
  const document = buildVolumeWorkspaceDocument({
    ...createDocument(),
    volumes: [
      {
        ...createDocument().volumes[0],
        chapters: Array.from({ length: 53 }, (_, index) => createChapter({
          id: `volume-1-chapter-${index + 1}`,
          chapterOrder: index + 1,
          beatKey: "open_hook",
          title: `第一卷第${index + 1}章`,
          summary: `第一卷第${index + 1}章摘要`,
        })),
      },
      {
        ...createDocument().volumes[0],
        id: "volume-2",
        sortOrder: 2,
        title: "第二卷",
        chapters: [],
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...createDocument().volumes[0],
        id: `volume-${index + 3}`,
        sortOrder: index + 3,
        title: `第${index + 3}卷`,
        chapters: [],
      })),
    ],
    beatSheets: [
      {
        volumeId: "volume-2",
        volumeSortOrder: 2,
        status: "generated",
        beats: [
          { key: "b1", label: "开局", summary: "开局", chapterSpanHint: "1章", mustDeliver: ["开局"] },
          { key: "b2", label: "推进", summary: "推进", chapterSpanHint: "2章", mustDeliver: ["推进"] },
          { key: "b3", label: "转向", summary: "转向", chapterSpanHint: "3-4章", mustDeliver: ["转向"] },
          { key: "b4", label: "挤压", summary: "挤压", chapterSpanHint: "5章", mustDeliver: ["挤压"] },
          { key: "b5", label: "高潮", summary: "高潮", chapterSpanHint: "6章", mustDeliver: ["高潮"] },
          { key: "b6", label: "尾钩", summary: "尾钩", chapterSpanHint: "7章", mustDeliver: ["尾钩"] },
        ],
      },
    ],
  });
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let promptCallCount = 0;

  promptRunner.runStructuredPrompt = async () => {
    promptCallCount += 1;
    throw new Error("chapter-list prompt should not run for an under-covered beat sheet");
  };

  try {
    await assert.rejects(
      () => generateBeatChunkedChapterList({
        document,
        novel: {
          title: "测试小说",
          description: null,
          targetAudience: null,
          bookSellingPoint: null,
          competingFeel: null,
          first30ChapterPromise: null,
          commercialTagsJson: null,
          estimatedChapterCount: 430,
          narrativePov: null,
          pacePreference: null,
          emotionIntensity: null,
          storyModePromptBlock: null,
          genre: null,
          characters: [],
        },
        workspace: {
          ...document,
          workspaceVersion: "v2",
          readiness: {},
        },
        storyMacroPlan: null,
        options: {
          targetVolumeId: "volume-2",
          generationMode: "full_volume",
        },
        notifyPhase: async () => {},
      }),
      /节奏板/,
    );
    assert.equal(promptCallCount, 0);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList rejects disconnected beat sheet spans before prompting", async () => {
  const document = buildVolumeWorkspaceDocument({
    ...createDocument(),
    volumes: [
      {
        ...createDocument().volumes[0],
        id: "volume-1",
        sortOrder: 1,
        title: "第一卷",
        chapters: [],
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        ...createDocument().volumes[0],
        id: `volume-${index + 2}`,
        sortOrder: index + 2,
        title: `第${index + 2}卷`,
        chapters: [],
      })),
    ],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          { key: "b1", label: "开局", summary: "开局", chapterSpanHint: "1-7章", mustDeliver: ["开局"] },
          { key: "b2", label: "尾钩", summary: "尾钩", chapterSpanHint: "54章", mustDeliver: ["尾钩"] },
        ],
      },
    ],
  });
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let promptCallCount = 0;

  promptRunner.runStructuredPrompt = async () => {
    promptCallCount += 1;
    throw new Error("chapter-list prompt should not run for disconnected beat sheet spans");
  };

  try {
    await assert.rejects(
      () => generateBeatChunkedChapterList({
        document,
        novel: {
          title: "测试小说",
          description: null,
          targetAudience: null,
          bookSellingPoint: null,
          competingFeel: null,
          first30ChapterPromise: null,
          commercialTagsJson: null,
          estimatedChapterCount: 430,
          narrativePov: null,
          pacePreference: null,
          emotionIntensity: null,
          storyModePromptBlock: null,
          genre: null,
          characters: [],
        },
        workspace: {
          ...document,
          workspaceVersion: "v2",
          readiness: {},
        },
        storyMacroPlan: null,
        options: {
          targetVolumeId: "volume-1",
          generationMode: "full_volume",
        },
        notifyPhase: async () => {},
      }),
      /连续覆盖|节奏板/,
    );
    assert.equal(promptCallCount, 0);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList resumes after the last persisted complete beat", async () => {
  const document = createDocument();
  const partialDocument = {
    ...document,
    volumes: [{
      ...document.volumes[0],
      chapters: document.volumes[0].chapters.slice(0, 2),
    }],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const generatedBeatKeys = [];
  const intermediateEvents = [];

  promptRunner.runStructuredPrompt = async ({ promptInput }) => {
    generatedBeatKeys.push(promptInput.targetBeat.key);
    return {
      output: {
        beatKey: promptInput.targetBeat.key,
        beatLabel: promptInput.targetBeat.label,
        chapterCount: promptInput.targetBeatChapterCount,
        chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
          beatKey: promptInput.targetBeat.key,
          title: `${promptInput.targetBeat.label}-续跑${index + 1}`,
          summary: `${promptInput.targetBeat.label}续跑摘要${index + 1}`,
        })),
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document: partialDocument,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...partialDocument,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "full_volume",
      },
      notifyPhase: async () => {},
      notifyIntermediateDocument: async (event) => {
        intermediateEvents.push(event);
      },
    });

    assert.deepEqual(generatedBeatKeys, ["midpoint_turn"]);
    assert.equal(intermediateEvents[0].isFinal, false);
    assert.equal(intermediateEvents[0].targetBeatKey, "midpoint_turn");
    assert.deepEqual(
      intermediateEvents[0].document.volumes[0].chapters.map((chapter) => chapter.title),
      ["旧开卷一", "旧开卷二", "中段转向-续跑1", "中段转向-续跑2"],
    );
    assert.deepEqual(
      result.mergedDocument.volumes[0].chapters.map((chapter) => chapter.title),
      ["旧开卷一", "旧开卷二", "中段转向-续跑1", "中段转向-续跑2"],
    );
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList marks non-final complete chunks as a resumable ready beat window", async () => {
  const document = {
    ...createDocument(),
    volumes: [{
      ...createDocument().volumes[0],
      chapters: [],
    }],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const intermediateEvents = [];

  promptRunner.runStructuredPrompt = async ({ promptInput }) => ({
    output: {
      beatKey: promptInput.targetBeat.key,
      beatLabel: promptInput.targetBeat.label,
      chapterCount: promptInput.targetBeatChapterCount,
      chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
        beatKey: promptInput.targetBeat.key,
        title: `${promptInput.targetBeat.label}-中间${index + 1}`,
        summary: `${promptInput.targetBeat.label}中间摘要${index + 1}`,
      })),
    },
  });

  try {
    await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...document,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "full_volume",
      },
      notifyPhase: async () => {},
      notifyIntermediateDocument: async (event) => {
        intermediateEvents.push(event);
      },
    });

    const lastNonFinal = intermediateEvents.filter((event) => event.isFinal === false).at(-1);
    assert.ok(lastNonFinal);
    assert.equal(lastNonFinal.document.volumes[0].chapters.length, 4);
    assert.equal(lastNonFinal.document.volumes[0].status, "chapter_list_partial:active");
    const nonFinalCursor = resolveStructuredOutlineRecoveryCursor({
      workspace: lastNonFinal.document,
      plan: { mode: "volume", volumeOrder: 1 },
      allowPartialChapterListReady: true,
    });
    assert.equal(nonFinalCursor.step, "chapter_detail_bundle");
    assert.equal(nonFinalCursor.beatChapterListReady, true);
    assert.equal(nonFinalCursor.volumeChapterListComplete, true);

    const finalEvent = intermediateEvents.find((event) => event.isFinal === true);
    assert.ok(finalEvent);
    assert.equal(finalEvent.document.volumes[0].status, "active");
    assert.equal(resolveStructuredOutlineRecoveryCursor({
      workspace: finalEvent.document,
      plan: { mode: "volume", volumeOrder: 1 },
    }).step, "chapter_detail_bundle");
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList emits a single-beat intermediate document without replacing other beats", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const intermediateEvents = [];

  promptRunner.runStructuredPrompt = async ({ promptInput }) => ({
    output: {
      beatKey: promptInput.targetBeat.key,
      beatLabel: promptInput.targetBeat.label,
      chapterCount: promptInput.targetBeatChapterCount,
      chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
        beatKey: promptInput.targetBeat.key,
        title: `${promptInput.targetBeat.label}-单段${index + 1}`,
        summary: `${promptInput.targetBeat.label}单段摘要${index + 1}`,
      })),
    },
  });

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...document,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "single_beat",
        targetBeatKey: "midpoint_turn",
      },
      notifyPhase: async () => {},
      notifyIntermediateDocument: async (event) => {
        intermediateEvents.push(event);
      },
    });

    assert.equal(intermediateEvents.length, 2);
    assert.equal(intermediateEvents[0].isFinal, false);
    assert.equal(intermediateEvents[0].targetBeatKey, "midpoint_turn");
    assert.deepEqual(
      intermediateEvents[0].document.volumes[0].chapters.map((chapter) => chapter.title),
      ["旧开卷一", "旧开卷二", "中段转向-单段1", "中段转向-单段2"],
    );
    assert.deepEqual(intermediateEvents[0].document.volumes[0].chapters, result.mergedDocument.volumes[0].chapters);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList supports incremental single-beat generation into an empty volume", async () => {
  const baseDocument = createDocument();
  const emptyDocument = {
    ...baseDocument,
    volumes: [{
      ...baseDocument.volumes[0],
      chapters: [],
    }],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;

  promptRunner.runStructuredPrompt = async ({ promptInput }) => ({
    output: {
      beatKey: promptInput.targetBeat.key,
      beatLabel: promptInput.targetBeat.label,
      chapterCount: promptInput.targetBeatChapterCount,
      chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
        beatKey: promptInput.targetBeat.key,
        title: `${promptInput.targetBeat.label}-增量${index + 1}`,
        summary: `${promptInput.targetBeat.label}增量摘要${index + 1}`,
      })),
    },
  });

  try {
    const firstResult = await generateBeatChunkedChapterList({
      document: emptyDocument,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...emptyDocument,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "single_beat",
        targetBeatKey: "open_hook",
      },
      notifyPhase: async () => {},
    });

    assert.equal(firstResult.mergedDocument.volumes[0].status, "chapter_list_partial:active");
    assert.deepEqual(
      firstResult.mergedDocument.volumes[0].chapters.map((chapter) => chapter.beatKey),
      ["open_hook", "open_hook"],
    );

    const secondResult = await generateBeatChunkedChapterList({
      document: firstResult.mergedDocument,
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...firstResult.mergedWorkspace,
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "single_beat",
        targetBeatKey: "midpoint_turn",
      },
      notifyPhase: async () => {},
    });

    assert.equal(secondResult.mergedDocument.volumes[0].status, "active");
    assert.deepEqual(
      secondResult.mergedDocument.volumes[0].chapters.map((chapter) => chapter.chapterOrder),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      secondResult.mergedDocument.volumes[0].chapters.map((chapter) => chapter.beatKey),
      ["open_hook", "open_hook", "midpoint_turn", "midpoint_turn"],
    );
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList emits a resumable intermediate document after each generated beat", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const intermediateEvents = [];

  promptRunner.runStructuredPrompt = async ({ promptInput }) => ({
    output: {
      beatKey: promptInput.targetBeat.key,
      beatLabel: promptInput.targetBeat.label,
      chapterCount: promptInput.targetBeatChapterCount,
      chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
        beatKey: promptInput.targetBeat.key,
        title: `${promptInput.targetBeat.label}-${index + 1}`,
        summary: `${promptInput.targetBeat.label}摘要${index + 1}`,
      })),
    },
  });

  try {
    const result = await generateBeatChunkedChapterList({
      document: {
        ...document,
        volumes: [{
          ...document.volumes[0],
          chapters: [],
        }],
      },
      novel: {
        title: "测试小说",
        description: null,
        targetAudience: null,
        bookSellingPoint: null,
        competingFeel: null,
        first30ChapterPromise: null,
        commercialTagsJson: null,
        estimatedChapterCount: 4,
        narrativePov: null,
        pacePreference: null,
        emotionIntensity: null,
        storyModePromptBlock: null,
        genre: null,
        characters: [],
      },
      workspace: {
        ...document,
        volumes: [{
          ...document.volumes[0],
          chapters: [],
        }],
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: {
        targetVolumeId: "volume-1",
        generationMode: "full_volume",
      },
      notifyPhase: async () => {},
      notifyIntermediateDocument: async (event) => {
        intermediateEvents.push(event);
      },
    });

    assert.equal(intermediateEvents.length, 3);
    assert.equal(intermediateEvents[0].isFinal, false);
    assert.equal(intermediateEvents[0].targetBeatKey, "open_hook");
    assert.deepEqual(
      intermediateEvents[0].document.volumes[0].chapters.map((chapter) => chapter.title),
      ["开卷抓手-1", "开卷抓手-2"],
    );
    assert.equal(intermediateEvents[1].isFinal, false);
    assert.equal(intermediateEvents[1].targetBeatKey, "midpoint_turn");
    assert.deepEqual(
      intermediateEvents[1].document.volumes[0].chapters.map((chapter) => chapter.title),
      ["开卷抓手-1", "开卷抓手-2", "中段转向-1", "中段转向-2"],
    );
    assert.equal(intermediateEvents[2].isFinal, true);
    assert.equal(intermediateEvents[2].targetBeatKey, "midpoint_turn");
    assert.deepEqual(intermediateEvents[2].document.volumes[0].chapters, result.mergedDocument.volumes[0].chapters);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList passes previously generated beat titles to later beats", async () => {
  const document = createDocument();
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const renderedHumanMessages = [];
  const EMPTY_CONTEXT = {
    blocks: [],
    selectedBlockIds: [],
    droppedBlockIds: [],
    summarizedBlockIds: [],
    estimatedInputTokens: 0,
  };

  promptRunner.runStructuredPrompt = async ({ asset, promptInput }) => {
    const messages = asset.render(promptInput, EMPTY_CONTEXT);
    renderedHumanMessages.push(String(messages[messages.length - 1].content));
    return {
      output: {
        beatKey: promptInput.targetBeat.key,
        beatLabel: promptInput.targetBeat.label,
        chapterCount: promptInput.targetBeatChapterCount,
        chapters: Array.from({ length: promptInput.targetBeatChapterCount }, (_, index) => ({
          beatKey: promptInput.targetBeat.key,
          title: `${promptInput.targetBeat.label}-章${index + 1}`,
          summary: `${promptInput.targetBeat.label}第${index + 1}章摘要，主角主动做出选择并改变局面。`,
        })),
      },
    };
  };

  try {
    await generateBeatChunkedChapterList({
      document: {
        ...document,
        volumes: [{ ...document.volumes[0], chapters: [] }],
      },
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 4, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: {
        ...document,
        volumes: [{ ...document.volumes[0], chapters: [] }],
        workspaceVersion: "v2",
        readiness: {},
      },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "full_volume" },
      notifyPhase: async () => {},
    });

    assert.equal(renderedHumanMessages.length, 2);
    // 第一个 beat：无已占用标题
    assert.doesNotMatch(renderedHumanMessages[0], /已被占用/);
    // 第二个 beat：必须看到第一个 beat 的全部标题（跨 beat 防撞）
    assert.match(renderedHumanMessages[1], /已被占用/);
    assert.match(renderedHumanMessages[1], /- 开卷抓手-章1/);
    assert.match(renderedHumanMessages[1], /- 开卷抓手-章2/);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("chunk generation repairs a title collision with a focused retry before giving up", async () => {
  const base = createDocument();
  const document = {
    ...base,
    volumes: [{ ...base.volumes[0], chapters: [] }],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          {
            key: "mega",
            label: "大节奏段",
            summary: "一个超长节奏段，用来验证撞车聚焦修复。",
            chapterSpanHint: "1-26章",
            mustDeliver: ["持续推进"],
          },
        ],
      },
    ],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const retryReasons = [];
  let secondChunkAttempts = 0;

  promptRunner.runStructuredPrompt = async ({ promptInput }) => {
    const size = promptInput.targetBeatChapterCount;
    if (promptInput.targetChapterStartOrder === 13) {
      secondChunkAttempts += 1;
      if (secondChunkAttempts === 1) {
        // 模拟模型无视占用清单、产出与第一块重复的标题
        throw new Error("章节标题出现重复：大节奏段之1。请确保每章标题唯一。");
      }
      retryReasons.push(String(promptInput.retryReason ?? ""));
    }
    return {
      output: {
        beatKey: promptInput.targetBeat.key,
        beatLabel: promptInput.targetBeat.label,
        chapterCount: size,
        chapters: Array.from({ length: size }, (_, index) => ({
          beatKey: promptInput.targetBeat.key,
          title: `大节奏段之${promptInput.targetChapterStartOrder + index}`,
          summary: `大节奏段第${promptInput.targetChapterStartOrder + index}章摘要，主角主动做出选择并改变局面。`,
        })),
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 26, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "mega" },
      notifyPhase: async () => {},
    });

    // 第二块撞车后聚焦修复成功，整体不中断
    assert.equal(secondChunkAttempts, 2);
    assert.equal(retryReasons.length, 1);
    assert.match(retryReasons[0], /标题撞车：「大节奏段之1」已被其他章节占用/);
    assert.match(retryReasons[0], /完全换一个写法/);
    assert.match(retryReasons[0], /近似变体/);
    assert.equal(result.mergedDocument.volumes[0].chapters.length, 26);
    const titles = result.mergedDocument.volumes[0].chapters.map((chapter) => chapter.title);
    assert.equal(new Set(titles).size, 26, "修复后标题全部唯一");
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("chunk generation lets non-collision errors propagate without repair retries", async () => {
  const base = createDocument();
  const document = {
    ...base,
    volumes: [{ ...base.volumes[0], chapters: [] }],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          {
            key: "mega",
            label: "大节奏段",
            summary: "一个超长节奏段，用来验证非撞车错误不被修复循环吞掉。",
            chapterSpanHint: "1-26章",
            mustDeliver: ["持续推进"],
          },
        ],
      },
    ],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  let callCount = 0;

  promptRunner.runStructuredPrompt = async () => {
    callCount += 1;
    throw new Error("模型服务暂时不可用。");
  };

  try {
    await assert.rejects(
      () => generateBeatChunkedChapterList({
        document,
        novel: {
          title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
          first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 26, narrativePov: null,
          pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
        },
        workspace: { ...document, workspaceVersion: "v2", readiness: {} },
        storyMacroPlan: null,
        options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "mega" },
        notifyPhase: async () => {},
      }),
      /模型服务暂时不可用/,
    );
    assert.equal(callCount, 1, "非撞车错误立即抛出，不消耗修复轮次");
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("generateBeatChunkedChapterList splits an oversized beat into bounded chapter chunks", async () => {
  const base = createDocument();
  const document = {
    ...base,
    volumes: [{ ...base.volumes[0], chapters: [] }],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          {
            key: "mega",
            label: "大节奏段",
            summary: "一个超长节奏段，用来验证分块。",
            chapterSpanHint: "1-26章",
            mustDeliver: ["持续推进"],
          },
        ],
      },
    ],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const chunkSizes = [];
  const carryovers = [];

  promptRunner.runStructuredPrompt = async ({ promptInput }) => {
    const size = promptInput.targetBeatChapterCount;
    chunkSizes.push(size);
    carryovers.push(promptInput.previousBeatChapterSummary ?? null);
    return {
      output: {
        beatKey: promptInput.targetBeat.key,
        beatLabel: promptInput.targetBeat.label,
        chapterCount: size,
        chapters: Array.from({ length: size }, (_, index) => ({
          beatKey: promptInput.targetBeat.key,
          title: `大节奏段之${promptInput.targetChapterStartOrder + index}`,
          summary: `大节奏段第${promptInput.targetChapterStartOrder + index}章摘要，主角主动做出选择并改变局面。`,
        })),
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 26, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "mega" },
      notifyPhase: async () => {},
    });

    const chapters = result.mergedDocument.volumes[0].chapters;
    assert.equal(chapters.length, 26);
    assert.deepEqual(chunkSizes, [12, 12, 2]);
    assert.ok(chunkSizes.every((size) => size <= 12));
    assert.deepEqual(
      chapters.map((chapter) => chapter.chapterOrder),
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    assert.ok(chapters.every((chapter) => chapter.beatKey === "mega"));
    // 后续 chunk 必须收到前序 chunk 的承接摘要，保证章节连续推进
    assert.match(String(carryovers[1] ?? ""), /大节奏段之1/);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("chunked beat generation exposes accumulated reserved titles and chapter range to later chunks", async () => {
  const base = createDocument();
  const document = {
    ...base,
    volumes: [{ ...base.volumes[0], chapters: [] }],
    beatSheets: [
      {
        volumeId: "volume-1",
        volumeSortOrder: 1,
        status: "generated",
        beats: [
          {
            key: "mega",
            label: "大节奏段",
            summary: "一个超长节奏段，用来验证分块间的标题防重。",
            chapterSpanHint: "1-26章",
            mustDeliver: ["持续推进"],
          },
        ],
      },
    ],
  };
  const originalRunStructuredPrompt = promptRunner.runStructuredPrompt;
  const renderedHumanMessages = [];
  const EMPTY_CONTEXT = {
    blocks: [],
    selectedBlockIds: [],
    droppedBlockIds: [],
    summarizedBlockIds: [],
    estimatedInputTokens: 0,
  };

  promptRunner.runStructuredPrompt = async ({ asset, promptInput }) => {
    const messages = asset.render(promptInput, EMPTY_CONTEXT);
    renderedHumanMessages.push(String(messages[messages.length - 1].content));
    const size = promptInput.targetBeatChapterCount;
    return {
      output: {
        beatKey: promptInput.targetBeat.key,
        beatLabel: promptInput.targetBeat.label,
        chapterCount: size,
        chapters: Array.from({ length: size }, (_, index) => ({
          beatKey: promptInput.targetBeat.key,
          title: `大节奏段之${promptInput.targetChapterStartOrder + index}`,
          summary: `大节奏段第${promptInput.targetChapterStartOrder + index}章摘要，主角主动做出选择并改变局面。`,
        })),
      },
    };
  };

  try {
    const result = await generateBeatChunkedChapterList({
      document,
      novel: {
        title: "测试小说", description: null, targetAudience: null, bookSellingPoint: null, competingFeel: null,
        first30ChapterPromise: null, commercialTagsJson: null, estimatedChapterCount: 26, narrativePov: null,
        pacePreference: null, emotionIntensity: null, storyModePromptBlock: null, genre: null, characters: [],
      },
      workspace: { ...document, workspaceVersion: "v2", readiness: {} },
      storyMacroPlan: null,
      options: { targetVolumeId: "volume-1", generationMode: "single_beat", targetBeatKey: "mega" },
      notifyPhase: async () => {},
    });

    assert.equal(result.mergedDocument.volumes[0].chapters.length, 26);
    assert.equal(renderedHumanMessages.length, 3);

    // 第一个 chunk：无已占用标题，但有明确章节范围
    assert.match(renderedHumanMessages[0], /第 1-12 章/);
    assert.doesNotMatch(renderedHumanMessages[0], /已被占用/);

    // 第二个 chunk：必须看到第一块全部标题（防跨块撞车）与自身章节范围
    assert.match(renderedHumanMessages[1], /已被占用/);
    assert.match(renderedHumanMessages[1], /- 大节奏段之1/);
    assert.match(renderedHumanMessages[1], /- 大节奏段之12/);
    assert.match(renderedHumanMessages[1], /第 13-24 章/);

    // 第三个 chunk：累积前两块的标题
    assert.match(renderedHumanMessages[2], /- 大节奏段之13/);
    assert.match(renderedHumanMessages[2], /- 大节奏段之24/);
    assert.match(renderedHumanMessages[2], /第 25-26 章/);
  } finally {
    promptRunner.runStructuredPrompt = originalRunStructuredPrompt;
  }
});

test("chapter title dedup prompt validates rename coverage and reserved collisions", () => {
  const baseInput = {
    volumeTitle: "第一卷",
    duplicates: [
      { chapterOrder: 3, beatLabel: "早期变数", title: "重复标题", summary: "第三章摘要" },
      { chapterOrder: 7, beatLabel: "中段转向", title: "重复标题", summary: "第七章摘要" },
    ],
    reservedTitles: ["别的一章", "另一章"],
  };

  // 漏掉一个重复章节 → 抛错
  assert.throws(() => chapterTitleDedupPrompt.postValidate({
    renames: [{ chapterOrder: 3, title: "新标题甲" }],
  }, baseInput), /第 7 章缺少重命名结果/);

  // 重命名撞已占用标题 → 抛错
  assert.throws(() => chapterTitleDedupPrompt.postValidate({
    renames: [
      { chapterOrder: 3, title: "新标题甲" },
      { chapterOrder: 7, title: "别的一章" },
    ],
  }, baseInput), /重复/);

  // 合法重命名 → 通过
  const output = chapterTitleDedupPrompt.postValidate({
    renames: [
      { chapterOrder: 3, title: "新标题甲" },
      { chapterOrder: 7, title: "新标题乙" },
    ],
  }, baseInput);
  assert.equal(output.renames.length, 2);
});
