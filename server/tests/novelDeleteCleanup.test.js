const test = require("node:test");
const assert = require("node:assert/strict");

const { NovelCoreCrudService } = require("../dist/services/novel/novelCoreCrudService.js");
const { prisma } = require("../dist/db/prisma.js");
const { ragServices } = require("../dist/services/rag/index.js");

test("deleteNovel removes failed novel tasks and their archive markers before deleting the novel", async () => {
  const originalTransaction = prisma.$transaction;
  const originalEnqueueDelete = ragServices.ragIndexService.enqueueDelete;
  const calls = [];

  const transaction = {
    novelWorkflowTask: {
      findMany: async (query) => {
        calls.push(["findNovelWorkflowTasks", query]);
        if (query.where.lane === "auto_director") {
          return [{ id: "director_task_1" }, { id: "director_task_2" }];
        }
        return [{ id: "failed_task_1" }, { id: "failed_task_2" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteNovelWorkflowTasks", query]);
        return { count: 2 };
      },
    },
    agentRun: {
      findMany: async (query) => {
        calls.push(["findFailedAgentRuns", query]);
        return [{ id: "failed_agent_1" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteFailedAgentRuns", query]);
        return { count: 1 };
      },
    },
    generationJob: {
      findMany: async (query) => {
        calls.push(["findFailedPipelineJobs", query]);
        return [{ id: "failed_pipeline_1" }];
      },
    },
    imageGenerationTask: {
      findMany: async (query) => {
        calls.push(["findFailedImageTasks", query]);
        return [{ id: "failed_image_1" }];
      },
    },
    taskCenterArchive: {
      deleteMany: async (query) => {
        calls.push(["deleteArchiveMarkers", query]);
        return { count: 1 };
      },
    },
    directorRun: {
      findMany: async (query) => {
        calls.push(["findDirectorRuns", query]);
        return [{ id: "director_run_1" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteDirectorRuns", query]);
        return { count: 1 };
      },
    },
    directorLlmUsageRecord: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorLlmUsageRecords", query]);
        return { count: 1 };
      },
    },
    directorStepRun: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorStepRuns", query]);
        return { count: 1 };
      },
    },
    directorEvent: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorEvents", query]);
        return { count: 1 };
      },
    },
    directorArtifact: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorArtifacts", query]);
        return { count: 1 };
      },
    },
    directorRunCommand: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorRunCommands", query]);
        return { count: 1 };
      },
    },
    directorNextRun: {
      findMany: async (query) => {
        calls.push(["findDirectorNextRuns", query]);
        return [{ id: "director_next_run_1" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextRuns", query]);
        return { count: 1 };
      },
    },
    directorNextRunControl: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextRunControls", query]);
        return { count: 1 };
      },
    },
    directorNextEvent: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextEvents", query]);
        return { count: 1 };
      },
    },
    directorNextCommand: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextCommands", query]);
        return { count: 1 };
      },
    },
    directorNextArtifact: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextArtifacts", query]);
        return { count: 1 };
      },
    },
    directorNextQualityDebt: {
      deleteMany: async (query) => {
        calls.push(["deleteDirectorNextQualityDebts", query]);
        return { count: 1 };
      },
    },
    novel: {
      delete: async (query) => {
        calls.push(["deleteNovel", query]);
        return { id: "novel_1" };
      },
    },
  };

  prisma.$transaction = async (callback) => callback(transaction);
  ragServices.ragIndexService.enqueueDelete = async (ownerType, ownerId) => {
    calls.push(["queueRagDelete", { ownerType, ownerId }]);
  };

  try {
    await new NovelCoreCrudService().deleteNovel("novel_1");

    const callNames = calls.map(([name]) => name);
    assert.deepEqual(callNames, [
      "findNovelWorkflowTasks",
      "findFailedAgentRuns",
      "findFailedPipelineJobs",
      "findFailedImageTasks",
      "deleteArchiveMarkers",
      "deleteNovelWorkflowTasks",
      "deleteFailedAgentRuns",
      "findNovelWorkflowTasks",
      "findDirectorRuns",
      "deleteDirectorLlmUsageRecords",
      "deleteDirectorStepRuns",
      "deleteDirectorEvents",
      "deleteDirectorArtifacts",
      "deleteDirectorRunCommands",
      "deleteDirectorLlmUsageRecords",
      "deleteDirectorRuns",
      "deleteNovelWorkflowTasks",
      "findDirectorNextRuns",
      "deleteDirectorNextCommands",
      "deleteDirectorNextEvents",
      "deleteDirectorNextArtifacts",
      "deleteDirectorNextQualityDebts",
      "deleteDirectorNextRunControls",
      "deleteDirectorNextRuns",
      "deleteNovel",
      "queueRagDelete",
      "queueRagDelete",
    ]);

    const byName = (name) => calls.filter(([entryName]) => entryName === name);
    assert.deepEqual(calls[0][1], {
      where: { novelId: "novel_1", status: "failed" },
      select: { id: true },
    });
    // auto_director 旧链路：不限状态整链清理
    assert.deepEqual(calls[7][1], {
      where: { novelId: "novel_1", lane: "auto_director" },
      select: { id: true },
    });
    assert.deepEqual(byName("deleteDirectorRuns")[0][1], {
      where: { taskId: { in: ["director_task_1", "director_task_2"] } },
    });
    // director-next 链路：DirectorNextRun.novelId 是裸列，必须显式清理
    assert.deepEqual(calls[17][1], {
      where: { novelId: "novel_1" },
      select: { id: true },
    });
    assert.deepEqual(byName("deleteDirectorNextRunControls")[0][1], {
      where: { runId: { in: ["director_next_run_1"] } },
    });
    // Artifact 与 run 是 producedByRunId 可空关系（SetNull 不级联），按 novelId 清
    assert.deepEqual(byName("deleteDirectorNextArtifacts")[0][1], {
      where: { novelId: "novel_1" },
    });
    assert.deepEqual(byName("deleteDirectorNextRuns")[0][1], {
      where: { id: { in: ["director_next_run_1"] } },
    });
    // 小说删除必须发生在全部导演链路清理之后
    assert.ok(callNames.indexOf("deleteNovel") > callNames.lastIndexOf("deleteDirectorNextRuns"));
    assert.deepEqual(calls[24][1], { where: { id: "novel_1" } });
    assert.deepEqual(calls.slice(-2), [
      ["queueRagDelete", { ownerType: "novel", ownerId: "novel_1" }],
      ["queueRagDelete", { ownerType: "bible", ownerId: "novel_1" }],
    ]);
  } finally {
    prisma.$transaction = originalTransaction;
    ragServices.ragIndexService.enqueueDelete = originalEnqueueDelete;
  }
});
