// Native-test transport double. No real SDK, network, provider or workspace.
export function createMCPClient(options) {
  return globalThis.__sandboxMcpFactory(options);
}
