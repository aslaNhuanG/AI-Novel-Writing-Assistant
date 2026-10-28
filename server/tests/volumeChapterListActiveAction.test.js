const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createVolumeChapterListPrompt,
  CHAPTER_ACTIVE_ACTION_VERBS,
  CHAPTER_PAYOFF_WORDS,
  CHAPTER_HOOK_WORDS,
} = require("../dist/prompting/prompts/novel/volume/chapterList.prompts.js");
const {
  runStructuredPrompt,
  setPromptRunnerStructuredInvokerForTests,
} = require("../dist/prompting/core/promptRunner.js");

const EMPTY_CONTEXT = {
  blocks: [],
  selectedBlockIds: [],
  droppedBlockIds: [],
  summarizedBlockIds: [],
  estimatedInputTokens: 0,
};

function createPromptInput(targetChapterCount = 12) {
  return {
    novel: {
      title: "测试小说",
      description: null,
      targetAudience: null,
      bookSellingPoint: null,
      competingFeel: null,
      first30ChapterPromise: null,
      commercialTagsJson: "[]",
      estimatedChapterCount: targetChapterCount,
      narrativePov: null,
      pacePreference: null,
      emotionIntensity: null,
      storyModePromptBlock: null,
      genre: null,
      characters: [],
    },
    workspace: {
      novelId: "novel-1",
      workspaceVersion: "v2",
      volumes: [],
      strategyPlan: null,
      critiqueReport: null,
      beatSheets: [],
      rebalanceDecisions: [],
      readiness: {
        canGenerateStrategy: true,
        canGenerateSkeleton: true,
        canGenerateBeatSheet: true,
        canGenerateChapterList: true,
        blockingReasons: [],
      },
      source: "volume",
      activeVersionId: null,
    },
    storyMacroPlan: null,
    strategyPlan: null,
    targetVolume: {
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
      chapters: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    targetBeatSheet: {
      volumeId: "volume-1",
      volumeSortOrder: 1,
      status: "generated",
      beats: [
        {
          key: "first_escalation",
          label: "首次升级",
          summary: "把主角推入第一轮正面冲突。",
          chapterSpanHint: `1-${targetChapterCount}章`,
          mustDeliver: ["压迫感", "困境"],
        },
      ],
    },
    targetBeat: {
      key: "first_escalation",
      label: "首次升级",
      summary: "把主角推入第一轮正面冲突。",
      chapterSpanHint: `1-${targetChapterCount}章`,
      mustDeliver: ["压迫感", "困境"],
    },
    targetBeatChapterCount: targetChapterCount,
    targetChapterStartOrder: 1,
    targetChapterEndOrder: targetChapterCount,
    nextAvailableChapterOrder: 1,
    previousBeatChapterSummary: null,
    preservedBeatChapterSummary: null,
    retryReason: null,
  };
}

// 真实夹具：2026-10-23 导演台 run 53423051 中 glm-5.3-flash 对「首次升级」
// beat 的原始章节列表输出（12 章）。旧版 19 动词校验表下仅命中 2/12，
// 被误判「主动行动不足」并打满两次校验重试。
const REAL_GLM_OUTPUT = {
  beatKey: "first_escalation",
  beatLabel: "首次升级",
  chapterCount: 12,
  chapters: [
        { beatKey: "first_escalation", title: "揽头牌子挂上门", summary: "计三斗把官府颁的揽头木牌挂上米铺门楣，当日就有乡邻在门口啐骂、孩童绕铺而走。他夜里翻新收的税册，发现夏税之外多出一笔无名加耗，官税之外还压着胥吏的第二层手。收数人的身份立住，靶子也立住了。" },
        { beatKey: "first_escalation", title: "催数帖进了门", summary: "县衙钱房第一次下催数帖，限十日缴足半斛桥秋税四成。三斗带账去衙门核对数目，被胥吏借'笔误'多划两成，嘴上应下、心里记账。回镇路上他把税册抄了一份藏进米柜，官府的嘴和账本第一次对不上。" },
        { beatKey: "first_escalation", title: "收税收出对头", summary: "大珠替三斗走户收税，按账实收却在粮户董家吃了闭门羹，董老汉扬言宁可吃官司。大珠当场不争，回头从账上查出董家实际田亩远少于籍册，是替逃户顶的名。收税的钉子户，反成了账目里第一道裂缝。" },
        { beatKey: "first_escalation", title: "顶名田的窟窿", summary: "三斗带大珠夜核全镇籍册，查出三十七户顶名田，税落在活人头上、粮进了逃户口袋。他面临选择：报官可得赏，却把一镇人推向匠籍；瞒下则自家垫赔。三斗咬牙先按住不报，揽头与乡邻的怨气之间出现第一条缝。" },
        { beatKey: "first_escalation", title: "垫税垫进米仓", summary: "催数日到，加耗照缴、顶名田的空额三斗自垫三十石，米仓当场见底。大禾提出把西滩的荒田买下补仓，三斗被逼放权。家账第一次出现为制度窟窿付出的真金白银，置田从打算变成必须。" },
        { beatKey: "first_escalation", title: "西滩田贱过草", summary: "三斗父子去西滩看田，地主因'洼地年年淹'贱卖。大禾蹲田埂抠土发现淤泥肥得流油，淹的只是外围，田契签字时地主还白搭一间废谷仓。别人眼里的死地，被计家按账上的亏空价买成活路。" },
        { beatKey: "first_escalation", title: "一家人分了工", summary: "米铺垫税亏空，三斗在饭桌上立分工：大珠管总账、大禾管田庄、大川押货跑码头，承策专心读书不沾钱粮。大川嫌跑腿丢人闹脾气，被一场码头短斤缺两的哑巴亏教育。计家的经营架子，被亏空逼着搭了起来。" },
        { beatKey: "first_escalation", title: "大川的秤星亏", summary: "大川押米去码头，被粮行用灌水秤连亏三船，回来还要面子不肯说。大珠对账发现码头进项对不上，逼出实情，顺手记下一本粮行秤码的暗账。纨绔交了第一笔学费，家里多了半份对手的底细。" },
        { beatKey: "first_escalation", title: "公道秤挂上桥头", summary: "大珠提议在桥头铺挂自家的准秤，明码标价、童叟可校，被压秤粮行的伙计当场砸了秤盘。三斗本想忍，镇上被坑过的粮户却自发围拢撑场。砸秤一夜，米铺丢了一杆秤，赚回了半镇人心。" },
        { beatKey: "first_escalation", title: "粮行递来和书", summary: "粮行掌柜反常登门赔秤，提出包销计家新田三年的谷子，价给得漂亮。大珠核价发现'高价'实则锁死秋粮贱卖权，识破是吞田的软刀子。三斗表面虚与委蛇，暗地里把谷仓改作米铺后库，拒了这口糖。" },
        { beatKey: "first_escalation", title: "加耗里省出一笔", summary: "大珠替胥吏代收加耗，从'笔误'的乱码里算出多收部分根本不入官账，而是落进钱房私袋。她试探着截下一小笔走自家账，一夜平安无事。账面第一次出现靠制度漏洞赚到的钱，三斗盯着那串数字，又喜又睡不着。" },
        { beatKey: "first_escalation", title: "秋粮入仓人入局", summary: "西滩新田头一季谷子入仓，垫掉的三十石补齐还多出两成，米铺凭公道秤成了镇上第二处粮源。三斗把这笔进项单独记一页，写着'账要平'；大珠却在页脚多抄了钱房私袋的数。家业站稳一步，账上的洞也记下了第一个名字。" },
  ],
};

const PASSIVE_ONLY_OUTPUT = {
  beatKey: "first_escalation",
  beatLabel: "首次升级",
  chapterCount: 6,
  chapters: [
    { beatKey: "first_escalation", title: "税册里的风声", summary: "三斗得知税册加耗的消息，意识到事情不简单。" },
    { beatKey: "first_escalation", title: "邻镇同样的怪事", summary: "他听说邻镇也出了同样的状况，发现其中似有关联。" },
    { beatKey: "first_escalation", title: "危险临近", summary: "察觉到危险临近，三斗意识到必须早做打算。" },
    { beatKey: "first_escalation", title: "账目露出破绽", summary: "得知钱房的人手布局后，他发现自己的账目露出破绽。" },
    { beatKey: "first_escalation", title: "上头要来查账", summary: "听说上头要来查账，他意识到这次恐怕在劫难逃。" },
    { beatKey: "first_escalation", title: "大珠神色反常", summary: "发现大珠近日神色反常，他意识到家中还有隐情。" },
  ],
};

const SETUP_ONLY_OUTPUT = {
  beatKey: "first_escalation",
  beatLabel: "首次升级",
  chapterCount: 6,
  chapters: [
    { beatKey: "first_escalation", title: "衙门探口风", summary: "三斗决定先去衙门探探口风，摸清钱房的底细。" },
    { beatKey: "first_escalation", title: "一句话的试探", summary: "他试探着递了一句话，观察书办的反应。" },
    { beatKey: "first_escalation", title: "三本旧账", summary: "大珠核出三本旧账的差别，记下关键的数字。" },
    { beatKey: "first_escalation", title: "排队递状", summary: "三斗连夜排队等着递状，张罗见面的门路。" },
    { beatKey: "first_escalation", title: "拦住大珠", summary: "他抢先一步拦住大珠，压住当场发作的念头。" },
    { beatKey: "first_escalation", title: "分头探路", summary: "两人商量着下一步的去处，约定分头探路。" },
  ],
};

test("volume chapter list accepts natural protagonist action after verb库 expansion", async () => {
  const calls = [];

  setPromptRunnerStructuredInvokerForTests(async (input) => {
    calls.push(input);
    return { data: REAL_GLM_OUTPUT, repairUsed: false, repairAttempts: 0 };
  });

  try {
    const result = await runStructuredPrompt({
      asset: createVolumeChapterListPrompt({
        targetChapterCount: 12,
        targetBeatKey: "first_escalation",
        targetBeatLabel: "首次升级",
      }),
      promptInput: createPromptInput(12),
    });

    assert.equal(calls.length, 1, "自然主动表述不得再触发校验重试");
    assert.equal(result.meta.invocation.semanticRetryUsed, false);
    assert.equal(result.output.chapters.length, 12);
    assert.equal(result.output.chapters[0].title, "揽头牌子挂上门");
  } finally {
    setPromptRunnerStructuredInvokerForTests();
  }
});

test("volume chapter list still rejects passive-only chapter blocks", async () => {
  const calls = [];

  setPromptRunnerStructuredInvokerForTests(async (input) => {
    calls.push(input);
    return { data: PASSIVE_ONLY_OUTPUT, repairUsed: false, repairAttempts: 0 };
  });

  try {
    const result = await runStructuredPrompt({
      asset: createVolumeChapterListPrompt({
        targetChapterCount: 6,
        targetBeatKey: "first_escalation",
        targetBeatLabel: "首次升级",
        reservedChapterTitles: ["已占用章名甲", "已占用章名乙"],
      }),
      promptInput: createPromptInput(6),
    });

    assert.equal(calls.length, 3, "纯被动块仍应打满 base + 两次校验重试");
    assert.equal(result.meta.invocation.semanticRetryAttempts, 2);
    assert.equal(result.output.chapters.length, 6, "功能质量问题降级接受原始输出");
    assert.equal(result.output.chapters[0].title, "税册里的风声");

    const retryMessage = String(calls[1].messages[calls[1].messages.length - 1].content);
    assert.match(retryMessage, /主动动作词库/);
    assert.match(retryMessage, /至少 2 章/);
    assert.match(retryMessage, /拍板/);
    // 已占用标题必须进入重试指令，模型才能避开跨块/跨 beat 撞车
    assert.match(retryMessage, /已占用章名甲、已占用章名乙/);
  } finally {
    setPromptRunnerStructuredInvokerForTests();
  }
});

test("volume chapter list still rejects setup-only blocks without payoff", async () => {
  const calls = [];

  setPromptRunnerStructuredInvokerForTests(async (input) => {
    calls.push(input);
    return { data: SETUP_ONLY_OUTPUT, repairUsed: false, repairAttempts: 0 };
  });

  try {
    const result = await runStructuredPrompt({
      asset: createVolumeChapterListPrompt({
        targetChapterCount: 6,
        targetBeatKey: "first_escalation",
        targetBeatLabel: "首次升级",
      }),
      promptInput: createPromptInput(6),
    });

    assert.equal(calls.length, 3, "主动但纯铺垫块仍应打满 base + 两次校验重试");
    assert.equal(result.meta.invocation.semanticRetryAttempts, 2);

    const retryMessage = String(calls[1].messages[calls[1].messages.length - 1].content);
    assert.match(retryMessage, /阶段性兑现/);
    assert.match(retryMessage, /补齐|翻盘|落袋/);
  } finally {
    setPromptRunnerStructuredInvokerForTests();
  }
});

test("chapter list prompt and validator share one verb库 without drift", () => {
  const messages = createVolumeChapterListPrompt({
    targetChapterCount: 12,
    targetBeatKey: "first_escalation",
    targetBeatLabel: "首次升级",
    reservedChapterTitles: ["已占用章名甲"],
  }).render(createPromptInput(12), EMPTY_CONTEXT);

  const system = String(messages[0].content);
  assert.match(system, /主动动作词库/);
  assert.match(system, /至少 4 章/);
  assert.ok(system.includes("拍板") && system.includes("自垫") && system.includes("识破"));
  assert.ok(!system.includes("隐忍"), "提示词不得再使用校验表之外的动词");

  assert.ok(CHAPTER_ACTIVE_ACTION_VERBS.includes("决定"), "保留原有动词");
  assert.ok(CHAPTER_ACTIVE_ACTION_VERBS.includes("拍板"), "补充模型自然表述动词");
  assert.ok(!CHAPTER_ACTIVE_ACTION_VERBS.includes("隐忍"));

  assert.ok(CHAPTER_PAYOFF_WORDS.includes("兑现"), "保留原兑现词");
  assert.ok(CHAPTER_PAYOFF_WORDS.includes("补齐"), "补充模型自然兑现表述");
  assert.ok(CHAPTER_HOOK_WORDS.includes("却"), "保留原钩子词");
  assert.ok(CHAPTER_HOOK_WORDS.includes("浮出"), "补充前压词");

  assert.ok(system.includes("补齐"), "系统提示同步兑现词库");

  const human = String(messages[messages.length - 1].content);
  assert.match(human, /已被占用/);
  assert.match(human, /已占用章名甲/);
  assert.match(human, /第 1-12 章/);
});
