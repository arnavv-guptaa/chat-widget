/**
 * Generative component registry contract: the steering prompt the model
 * receives and the fence routes the client renders come from ONE source, and
 * every registered fence language actually has a renderer route.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATIVE_COMPONENTS,
  MERMAID_FENCE_LANGUAGE,
  buildRenderingSystem,
} from '../src/generative/registry';
import { isChartFenceLanguage } from '../src/charts/chart-spec';

const response = readFileSync('src/components/response.tsx', 'utf8');
const handler = readFileSync('src/server/handler.ts', 'utf8');
const mermaidBlock = readFileSync('src/components/mermaid-block.tsx', 'utf8');

describe('generative component registry', () => {
  it('assembles the rendering system prompt from every component', () => {
    const prompt = buildRenderingSystem();
    expect(prompt).toContain('GitHub-Flavored Markdown');
    expect(prompt).toContain('pipe tables');
    expect(prompt).toContain('mordn-chart');
    expect(prompt).toContain('"schemaVersion": 2');
    expect(prompt).toContain('`mermaid`');
    // Every registered component contributed its vocabulary.
    for (const component of GENERATIVE_COMPONENTS) {
      expect(prompt).toContain(component.prompt);
    }
  });

  it('registers unique names and fence languages', () => {
    const names = GENERATIVE_COMPONENTS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const langs = GENERATIVE_COMPONENTS.flatMap((c) => c.fenceLanguages ?? []);
    expect(new Set(langs).size).toBe(langs.length);
  });

  it('every registered fence language has a client renderer route', () => {
    for (const component of GENERATIVE_COMPONENTS) {
      for (const lang of component.fenceLanguages ?? []) {
        const routed = isChartFenceLanguage(lang) || lang === MERMAID_FENCE_LANGUAGE;
        expect(routed, `no renderer route for fence language "${lang}"`).toBe(true);
      }
    }
    // And the client actually wires both routes.
    expect(response).toContain('isChartFenceLanguage(language)');
    expect(response).toContain('MERMAID_FENCE_LANGUAGE');
  });

  it('the server prompt is assembled from the registry, not a parallel blob', () => {
    expect(handler).toContain('buildRenderingSystem()');
    expect(handler).not.toContain("'Formatting: replies render as GitHub-Flavored Markdown.'");
  });

  it('mermaid renders model output under strict security and degrades to code', () => {
    expect(mermaidBlock).toContain("securityLevel: 'strict'");
    expect(mermaidBlock).toContain('CollapsibleCode');
    // Lazy import: mermaid must not load until a diagram appears.
    expect(mermaidBlock).toContain("import('mermaid')");
  });
});
