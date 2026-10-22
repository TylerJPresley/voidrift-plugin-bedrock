/**
 * VoidRift Bedrock — the first-party model provider for AWS Bedrock
 * (model-providers-blueprint.md §3; core-blueprint.md §11.7, §12.4).
 *
 * It teaches the core one new protocol — `bedrock` — and nothing else. In
 * `register` it calls the single `register.modelProvider` seam with a factory
 * that maps a resolved `ModelConfigEntry` to a `ChatBedrockConverse` client from
 * `@langchain/aws`. The factory is pure construction: it reads the entry, reads
 * credentials from the host AWS credential chain (never from config), and
 * returns a bound LangChain `BaseChatModel`. Everything after construction —
 * streaming, usage, reasoning, cost, timeout, retry — is the core's
 * uniform contract applied identically to a bundled provider (§4), so a Bedrock
 * endpoint is a true peer of `openai`/`anthropic`/`google`.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatBedrockConverse } from "@langchain/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { ModelConfigEntry, ScopedCoreApi } from "@voidrift/core";

/** The Converse `additionalModelRequestFields` type (Smithy `DocumentType`),
 * derived from the client's own constructor so no extra dependency is named. */
type ConverseInput = NonNullable<ConstructorParameters<typeof ChatBedrockConverse>[0]>;
type AdditionalModelRequestFields = NonNullable<ConverseInput["additionalModelRequestFields"]>;

/**
 * The Bedrock passthrough keys an endpoint may carry. They ride the core's
 * per-endpoint passthrough (`core-blueprint.md` §11.3) — the config schema
 * preserves them as unknown keys — so the provider adds no schema (§8). None is
 * a secret: `region`, `credentialsSource`, and `profile` are non-secret
 * references; actual keys live only in the AWS credential chain (§7).
 */
interface BedrockEntryKeys {
  /** AWS region; falls back to AWS_REGION / AWS_DEFAULT_REGION (§3.1). */
  region?: string;
  /** How credentials resolve: the default chain, or a named shared-config profile (§7). */
  credentialsSource?: "default" | "profile";
  /** The shared-config profile name when `credentialsSource` is `"profile"` (§7). */
  profile?: string;
  /** Converse sampling / native model knobs forwarded as request fields (§3.1). */
  temperature?: number;
  topP?: number;
  /** The core's uniform retry budget, passed straight through (§3.3, §4). */
  networkModelMaxRetries?: number;
}

/**
 * Resolve credentials for the entry without ever materializing a secret into
 * VoidRift state, config, logs, or events (§7). For `"profile"` we pin the AWS
 * SDK default provider chain to a named shared-config profile; for the default
 * source we return `undefined` so `ChatBedrockConverse` uses the AWS SDK's own
 * default provider chain (environment, shared files, container, instance roles).
 * The returned value is a provider *function* the SDK invokes lazily — the key
 * is read by the chain at call time, never copied here.
 */
function resolveCredentials(
  keys: BedrockEntryKeys,
): ReturnType<typeof defaultProvider> | undefined {
  if (keys.credentialsSource === "profile" && keys.profile) {
    return defaultProvider({ profile: keys.profile });
  }
  // `undefined` → ChatBedrockConverse uses the AWS default credential chain (§7).
  return undefined;
}

/**
 * Build a `ChatBedrockConverse` from the resolved entry (§3.2). Pure
 * construction — no network call — so an unreachable or mis-credentialed
 * endpoint fails at the first turn through the core's model path, not here.
 */
export function buildBedrock(entry: ModelConfigEntry): BaseChatModel {
  const keys = entry as ModelConfigEntry & BedrockEntryKeys;
  const region = keys.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error(
      "bedrock endpoint requires `region` or AWS_REGION / AWS_DEFAULT_REGION in the environment",
    );
  }
  const credentials = resolveCredentials(keys);
  return new ChatBedrockConverse({
    model: entry.model,
    region,
    // `undefined` leaves ChatBedrockConverse on the AWS default credential chain (§7).
    ...(credentials ? { credentials } : {}),
    ...(entry.maxOutputTokens !== undefined ? { maxTokens: entry.maxOutputTokens } : {}),
    ...(keys.temperature !== undefined ? { temperature: keys.temperature } : {}),
    ...(keys.topP !== undefined ? { topP: keys.topP } : {}),
    // Native Converse knobs (a reasoning budget, guided fields) ride modelKwargs
    // into `additionalModelRequestFields`, exactly as openai spreads them (§3.1).
    // `modelKwargs` is a `Record<string, unknown>`; the Converse field is Smithy's
    // `DocumentType`, which that record satisfies structurally at runtime, so the
    // cast is the type-only bridge (§3.1).
    ...(entry.modelKwargs !== undefined
      ? { additionalModelRequestFields: entry.modelKwargs as AdditionalModelRequestFields }
      : {}),
    // The core's uniform retry budget; the adapter owns the retry
    // middleware around the client (§3.3, §4).
    ...(keys.networkModelMaxRetries !== undefined ? { maxRetries: keys.networkModelMaxRetries } : {}),
  });
}

/**
 * The plugin entry point. The scoped CoreAPI tags the registration with this
 * plugin's id and tears it down on disable (§12.4). The seam is positional —
 * `register.modelProvider(protocol, factory)` — with the factory a synchronous
 * `(entry) => BaseChatModel` (the core's `ProviderFactory` contract, §11.7).
 */
export function register(core: ScopedCoreApi): void {
  core.register.modelProvider("bedrock", (entry: ModelConfigEntry) => buildBedrock(entry));
}

export default { register };
