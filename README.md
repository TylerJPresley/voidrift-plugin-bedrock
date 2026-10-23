# @voidrift/plugin-bedrock

VoidRift Bedrock — the first-party model provider over AWS Bedrock (ChatBedrockConverse).

Part of VoidRift, a local-first, model-agnostic AI agent harness. Status: work in progress. Not yet usable or released. The VoidRift CLI and core are the current focus.

## Requirements
- Node.js >=24
- `@voidrift/core` `^0.1.0`, which is not published to npm yet. Until it is, link a local checkout of the core repository (`npm link @voidrift/core`).

## Build from source
```bash
git clone https://github.com/TylerJPresley/voidrift-plugin-bedrock.git
cd voidrift-plugin-bedrock
npm install
npm run build
npm test
```

## License
Apache-2.0. See [LICENSE](LICENSE).
