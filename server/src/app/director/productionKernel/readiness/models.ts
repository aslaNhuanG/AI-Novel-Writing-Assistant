import type {RunContract} from "../../../../modules/director";
import {captureKernelModelPolicy, type KernelModelPolicySources} from "../modelPolicy/source";
import {AppError} from "../../../../middleware/errorHandler";
import type {KernelReadiness, KernelReadinessIssue} from "./storage";

export class KernelReadinessError extends AppError {
  readonly code: KernelReadinessIssue["code"];
  constructor(issue: KernelReadinessIssue) {super(issue.message, 503); this.code = issue.code; this.name = "KernelReadinessError";}
}
export async function inspectKernelModels(contract: RunContract, sources?: KernelModelPolicySources): Promise<KernelReadiness> {
  try {
    await captureKernelModelPolicy(contract, sources);
    return {ready: true};
  } catch (error) {
    // 把底层具体原因带出来：缺窗口、输出额度不足、模型路由不一致的处理方式完全不同，
    // 只回一句通用提示会让用户无从下手。
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "";
    return {ready: false, issues: [{code: "production_model_capability_missing",
      message: `正文模型配置未就绪：请为准确的主备提供商和模型配置上下文窗口及可执行的输出上限。${detail ? `（${detail}）` : ""}`}]};
  }
}
