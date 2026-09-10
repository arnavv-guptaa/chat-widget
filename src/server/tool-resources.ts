import type { BuiltTools } from './handler-types';

/** Own late-arriving tool resources as well as success/error/abort teardown. */
export function createToolResourceScope(onError: (error: unknown) => void) {
  let closed = false;
  let closing: Promise<void> | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  return {
    async adopt<T extends BuiltTools>(built: T): Promise<T> {
      let once: Promise<void> | undefined;
      const cleanup = () => once ??= Promise.resolve().then(() => built.cleanup?.()).then(() => {}).catch(onError);
      if (closed) await cleanup();
      else cleanups.push(cleanup);
      return built;
    },
    cleanup(): Promise<void> {
      closed = true;
      return closing ??= Promise.all(cleanups.map((close) => close())).then(() => {});
    },
  };
}
