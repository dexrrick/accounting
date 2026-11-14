export const ANSWER_PROGRESS_LABELS = Object.freeze({
  preparing: 'Preparing your answer',
  receiving: 'Receiving the answer',
  checking: 'Checking the answer'
} as const);

export type AnswerProgressStage = keyof typeof ANSWER_PROGRESS_LABELS;
export type AnswerProgressObserver = (stage: AnswerProgressStage) => void | Promise<void>;

export function notifyAnswerProgress(observer: AnswerProgressObserver | undefined, stage: AnswerProgressStage): void {
  if (!observer) return;
  try {
    const result = observer(stage);
    if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Progress observers are best-effort and cannot change answer generation.
  }
}
