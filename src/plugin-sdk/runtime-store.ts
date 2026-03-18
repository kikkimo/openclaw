export function createPluginRuntimeStore<T>(errorMessage: string): {
  setRuntime: (next: T) => void;
  clearRuntime: () => void;
  tryGetRuntime: () => T | null;
  getRuntime: () => T;
} {
  // Use globalThis + Symbol.for to share runtime across bundled chunks.
  // Closure-scoped variables break when the bundler duplicates this module
  // into multiple output chunks.
  const sym = Symbol.for(`openclaw.pluginRuntimeStore.${errorMessage}`);
  type StoreState = { runtime: T | null };
  const g = globalThis as typeof globalThis & { [key: symbol]: StoreState };
  if (!g[sym]) {
    g[sym] = { runtime: null };
  }
  const state = g[sym];

  return {
    setRuntime(next: T) {
      state.runtime = next;
    },
    clearRuntime() {
      state.runtime = null;
    },
    tryGetRuntime() {
      return state.runtime;
    },
    getRuntime() {
      if (!state.runtime) {
        throw new Error(errorMessage);
      }
      return state.runtime;
    },
  };
}
