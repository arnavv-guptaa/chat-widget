// Native Node type-stripping harness, NOT a compiler or an SDK replacement in
// production. Pure helpers use real source; hosted/MCP tests explicitly fake the
// MCP client. No test outside this opt-in harness is affected.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
    if (specifier === '@ai-sdk/mcp') return { url: new URL('./stubs/sandbox-native-mcp.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith(root) && !/\.[a-z]+(?:\?.*)?$/i.test(specifier)) {
      const target = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context);
    }
    return nextResolve(specifier, context);
  },
});
