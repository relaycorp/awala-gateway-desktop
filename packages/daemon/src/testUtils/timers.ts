export async function setImmediateAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
