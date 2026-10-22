import { describe, it, expect } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelConfigEntry, ScopedCoreApi } from "@voidrift/core";
import { register, buildBedrock } from "./index.js";

/** A minimal in-memory stub of the scoped CoreAPI surface the plugin uses. */
function makeStub() {
  const providers = new Map<string, (entry: ModelConfigEntry) => unknown>();
  const core = {
    pluginId: "@voidrift/plugin-bedrock",
    register: {
      modelProvider: (protocol: string, factory: unknown) => {
        providers.set(protocol, factory as (entry: ModelConfigEntry) => unknown);
      },
    },
  } as unknown as ScopedCoreApi;
  return { core, providers };
}

/** A sample bedrock config entry (the shape §3.1 documents). */
function bedrockEntry(overrides: Partial<ModelConfigEntry> = {}): ModelConfigEntry {
  return {
    model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    protocol: "bedrock",
    region: "us-east-1",
    credentialsSource: "default",
    contextLimit: 200_000,
    maxOutputTokens: 8192,
    ...overrides,
  } as unknown as ModelConfigEntry;
}

describe("bedrock plugin (model-providers-blueprint §2, §3)", () => {
  it("register() wires the `bedrock` protocol to a factory (§2)", () => {
    // Given a stub scoped CoreAPI
    const { core, providers } = makeStub();
    // When the plugin registers
    register(core);
    // Then the `bedrock` protocol is registered with a factory
    expect(providers.has("bedrock")).toBe(true);
    expect(typeof providers.get("bedrock")).toBe("function");
  });

  it("the factory builds a BaseChatModel from a bedrock entry (§3.2) — offline", () => {
    // Given a registered plugin and a sample bedrock entry
    const { core, providers } = makeStub();
    register(core);
    const factory = providers.get("bedrock")!;
    // When the factory runs (default credential chain, no network call)
    const model = factory(bedrockEntry());
    // Then it returns a LangChain BaseChatModel — a true peer of a bundled client
    expect(model).toBeInstanceOf(BaseChatModel);
  });

  it("buildBedrock honors a named profile without hitting AWS (§7) — offline", () => {
    // Given an entry pinning a shared-config profile (a non-secret reference)
    const model = buildBedrock(
      bedrockEntry({ credentialsSource: "profile", profile: "dev" } as Partial<ModelConfigEntry>),
    );
    // Then construction still returns a BaseChatModel; credentials resolve lazily
    expect(model).toBeInstanceOf(BaseChatModel);
  });

  it("region falls back to AWS_REGION when the entry omits it (§3.1)", () => {
    // Given no region on the entry but AWS_REGION in the environment
    const prev = process.env.AWS_REGION;
    process.env.AWS_REGION = "eu-west-1";
    try {
      const model = buildBedrock(bedrockEntry({ region: undefined } as Partial<ModelConfigEntry>));
      expect(model).toBeInstanceOf(BaseChatModel);
    } finally {
      if (prev === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = prev;
    }
  });

  it("throws a clear, contained error when no region is resolvable (§3.1)", () => {
    // Given no region on the entry and none in the environment
    const prevRegion = process.env.AWS_REGION;
    const prevDefault = process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    try {
      expect(() =>
        buildBedrock(bedrockEntry({ region: undefined } as Partial<ModelConfigEntry>)),
      ).toThrow(/region/);
    } finally {
      if (prevRegion !== undefined) process.env.AWS_REGION = prevRegion;
      if (prevDefault !== undefined) process.env.AWS_DEFAULT_REGION = prevDefault;
    }
  });

  it("never materializes a secret: no access-key fields on the built client (§7)", () => {
    // Given a built client
    const model = buildBedrock(bedrockEntry()) as unknown as Record<string, unknown>;
    // Then no literal credential value is present on it or its serialized form
    const serialized = JSON.stringify(model, (_k, v) =>
      typeof v === "function" ? "[fn]" : v,
    );
    expect(serialized).not.toMatch(/AKIA/);
    expect(serialized.toLowerCase()).not.toContain("secretaccesskey");
  });
});
