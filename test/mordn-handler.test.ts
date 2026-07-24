import { describe, expect, it, vi } from 'vitest';
import { createMordnHandler } from '../src/server/stores/hosted/mordn-handler';

const published = {
  agent: 'agent-hosted',
  revision: 'rev-1',
  config: {
    schemaVersion: 1 as const,
    runtime: { model: 'gateway/model' },
    client: { capabilitiesPrompt: 'Hosted client' },
  },
};

function hostedFetch() {
  return vi.fn(async () => new Response(JSON.stringify(published), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

async function bootstrap(handler: ReturnType<typeof createMordnHandler>) {
  const response = await handler.GET(new Request('https://app.example/api/chat/bootstrap'));
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

describe('createMordnHandler bootstrap wiring', () => {
  it('derives a key-rotation-safe storage scope while returning only client config', async () => {
    const firstFetch = hostedFetch();
    const first = createMordnHandler({
      apiKey: 'server-secret-one',
      getUserId: () => 'verified-user',
      fetch: firstFetch,
    });
    // Same agent + user, DIFFERENT api key — simulates key rotation.
    const rotated = createMordnHandler({
      apiKey: 'server-secret-two',
      getUserId: () => 'verified-user',
      fetch: hostedFetch(),
    });
    const otherUser = createMordnHandler({
      apiKey: 'server-secret-one',
      getUserId: () => 'other-user',
      fetch: hostedFetch(),
    });

    const firstBody = await bootstrap(first);
    const repeatedBody = await bootstrap(first);
    const rotatedBody = await bootstrap(rotated);
    const otherUserBody = await bootstrap(otherUser);

    expect(firstBody.storageScope).toMatch(/^[a-f0-9]{36}$/);
    expect(repeatedBody.storageScope).toBe(firstBody.storageScope);
    // Rotating the server API key must NOT change end users' storage
    // namespace — the scope derives from the resolved agent + verified user.
    expect(rotatedBody.storageScope).toBe(firstBody.storageScope);
    // A different verified user still gets a different namespace.
    expect(otherUserBody.storageScope).not.toBe(firstBody.storageScope);
    expect(firstBody).toMatchObject({
      protocolVersion: 1,
      agent: 'agent-hosted',
      revision: 'rev-1',
      client: { capabilitiesPrompt: 'Hosted client' },
    });
    expect(JSON.stringify(firstBody)).not.toContain('gateway/model');
    expect(firstFetch).toHaveBeenCalledWith(
      'https://api.mordn.com/v1/config',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer server-secret-one' }),
      }),
    );
  });

  it('allows an advanced handler to explicitly override storage scope resolution', async () => {
    const handler = createMordnHandler({
      apiKey: 'server-secret',
      getUserId: () => 'verified-user',
      fetch: hostedFetch(),
      resolveStorageScope: (ctx, agent) => `${agent}:${ctx.userId}:custom`,
    });

    expect((await bootstrap(handler)).storageScope).toBe('agent-hosted:verified-user:custom');
  });
});
