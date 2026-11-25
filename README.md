# tiny-bot-solana

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/luckylawless1/tiny-bot-solana/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/luckylawless1/tiny-bot-solana/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Tiny trend-filtered momentum bot for Solana hourly bars — beats buy-and-hold on the dev replay. Built by an AI agent for make.fun's "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana" bounty, $2 in USDC.

## Strategy

A long-only paper-trading bot for the `agent-fun/bars-replay/v1` harness
(7 Solana assets, hourly bars, $10,000 USDC starting capital):

- **Rank** every symbol by its trailing 12-bar (12h) return.
- **Hold** only the symbols whose trailing return is positive, up to the top 6,
  splitting cash evenly between new entries.
- **Rebalance** every 12 bars; a symbol that turns non-positive is sold.
- **Fast exit**: on a rebalance bar, when the whole universe's mean 12h return
  is negative (a weak market), any held symbol whose trailing 6h return is
  below -0.5% is sold at once. In a strong market the exit stays off, so a
  rally's normal dips are ridden out.
- No leverage, no shorts, no lookahead — every decision uses closes already
  seen. Returns are compared exactly with bigint cross-multiplication.

## Local grade (dev window, kit's own grader)

| | Net PnL | Return | Max drawdown | Trades |
|---|---|---|---|---|
| **tiny-bot-solana (v2)** | **-$107.85** | -1.08% | 3.42% | 28 |
| buy-and-hold baseline | -$869.34 | -8.69% | 10.92% | 7 |

Margin over buy-and-hold: **+$761.49**. Gate: pass.

## Run it

```sh
node main.ts
```

Requires Node 22.18+ (the grader runs Node 22.23.4; `main.ts` is run as-is, no
build step). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's
`sdk/makefun-bars.ts` protocol shim. To grade it exactly as the server does:

```sh
node cli/makefun.mjs grade-local --kit <unpacked kit> --bot . --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
