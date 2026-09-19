// Product policy: paid services stay disabled until an explicit future code change.
// API keys or legacy budget settings must never silently enable them.
export const FREE_MODE = true;
export const PAID_AI_DISABLED_MESSAGE = "현재는 무료 기능만 사용해요. 직접 입력과 기록 기반 분석을 이용해 주세요.";

export class PaidAiDisabledError extends Error {
  readonly code = "PAID_AI_DISABLED";
  constructor() { super(PAID_AI_DISABLED_MESSAGE); this.name = "PaidAiDisabledError"; }
}

export function isPaidAiAllowed() { return !FREE_MODE; }
export function assertPaidAiAllowed() {
  if (!isPaidAiAllowed()) throw new PaidAiDisabledError();
}
