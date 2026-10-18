# @zcode-agent/engine

The headless ZCode engine (`zcode.cjs`) that [zcode-agent](https://github.com/0xgeorgemathew/zcode-agent) drives. You don't install this yourself: `zcode-agent` depends on the exact version it was tested with.

It is built, unmodified, from the Apache-2.0 source of [zai-org/ZCode](https://github.com/zai-org/ZCode) at the tag in `engine.json` (`v3.15.1`, engine `0.16.9`), with the content plugins and bundled skills the ZCode app ships. Desktop-only plugins (built-in browser, computer use, device simulators) are left out. `dist/BUILD-INFO.json` records the commit and the sha256 of `zcode.cjs`; `LICENSE`, `NOTICE.md` and `dist/THIRD-PARTY-NOTICES.md` are upstream's.

Rebuild it from a checkout of zcode-agent with `npm run build:engine` (needs git and network; downloads the pinned Node and pnpm).

This package is not affiliated with, endorsed by, or sponsored by Zhipu AI / Z.ai. ZCode is a product of Z.ai.
