import { describe, expect, it } from 'vitest';
import { isAgentBootstrap, isAgentConfig, mergeAgentClientConfig } from '../src/config';

const config = {
  schemaVersion: 1 as const,
  runtime: {
    model: 'test/model',
    temperature: 0.2,
    memory: { enabled: true, inject: true, extract: true, limit: 6 },
  },
  client: {
    greeting: 'How can I help?',
    features: { fileUpload: true, webSearch: false },
    display: { layout: 'popup' as const, toggleButtonPosition: { bottom: '1rem' } },
  },
};

describe('canonical AgentConfig', () => {
  it('validates the schema-v1 envelope and rejects legacy flat config', () => {
    expect(isAgentConfig(config)).toBe(true);
    expect(isAgentConfig({ model: 'test/model' })).toBe(false);
    expect(isAgentConfig({ ...config, schemaVersion: 2 })).toBe(false);
    expect(isAgentConfig({ ...config, runtime: { model: '', temperature: 0.2 } })).toBe(false);
  });

  it('rejects infrastructure fields and out-of-range numeric values', () => {
    // Compression was removed from the product in 0.14.0; the canonical schema
    // rejects it like any other unknown runtime field.
    expect(isAgentConfig({
      ...config,
      runtime: { model: 'test/model', compression: true },
    })).toBe(false);
    expect(isAgentConfig({ ...config, runtime: { model: 'test/model', temperature: 2.01 } })).toBe(false);
    expect(isAgentConfig({ ...config, runtime: { model: 'test/model', maxOutputTokens: 1.5 } })).toBe(false);
    expect(isAgentConfig({ ...config, runtime: { model: 'test/model', followUps: { max: 6 } } })).toBe(false);
    expect(isAgentConfig({
      ...config,
      runtime: { model: 'test/model', memory: { enabled: true, inject: true, extract: true, limit: 21 } },
    })).toBe(false);
    expect(isAgentConfig({ ...config, client: { streamingThrottleMs: -1 } })).toBe(false);
    expect(isAgentConfig({ ...config, client: { features: { fileUploadMaxBytes: 0 } } })).toBe(false);
  });

  it('validates bootstrap as a strict browser-safe runtime payload', () => {
    const bootstrap = {
      protocolVersion: 1,
      agent: 'agent-1',
      revision: 'rev-1',
      client: config.client,
      storageScope: 'opaque-scope',
    };
    expect(isAgentBootstrap(bootstrap)).toBe(true);
    expect(isAgentBootstrap({ ...bootstrap, storageScope: '' })).toBe(false);
    expect(isAgentBootstrap({ ...bootstrap, runtime: config.runtime })).toBe(false);
    expect(isAgentBootstrap({ ...bootstrap, client: { streamingThrottleMs: -1 } })).toBe(false);
  });

  it('merges explicit client fields over published fields without replacing nested sections', () => {
    expect(
      mergeAgentClientConfig(config.client, {
        features: { webSearch: true },
        display: { toggleButtonPosition: { right: '2rem' } },
      }),
    ).toMatchObject({
      features: { fileUpload: true, webSearch: true },
      display: {
        layout: 'popup',
        toggleButtonPosition: { bottom: '1rem', right: '2rem' },
      },
    });
  });
});
