import { minutesToMilliseconds } from 'date-fns';

export async function sleepSeconds(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

/**
 * Return a promise that only resolves when `date` is reached.
 *
 * @param date When the returned promise should resolve
 * @param abortSignal
 *
 * The date is checked every 10 minutes, so it could resolve up to that many minutes later. This
 * is because we want this to work reliably when a computer resumes after being suspended, and
 * we prefer saving CPU cycles over accuracy.
 */
export async function sleepUntilDate(date: Date, abortSignal?: AbortSignal): Promise<void> {
  if (date <= new Date()) {
    return;
  }

  const intervalLengthMs = minutesToMilliseconds(10);
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (date <= new Date()) {
        cleanUpAndResolve();
      }
    }, intervalLengthMs);

    const cleanUpAndResolve = () => {
      clearInterval(interval);
      resolve();
    };

    abortSignal?.addEventListener('abort', cleanUpAndResolve);
  });
}
