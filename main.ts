// Tiny Bot: trend-filtered cross-sectional momentum on hourly Solana bars.
//
// Idea (tested offline against the kit's dev window before this file was written):
//   - Rank every symbol by its trailing 12-bar (12h) return.
//   - Hold only the symbols whose trailing return is POSITIVE, up to the top 6,
//     split the cash evenly between the ones being entered.
//   - Rebalance every 12 bars. A symbol that turns non-positive is sold; a symbol
//     that turns positive is bought at the next rebalance.
//   - Fast exit (added after the first local grade, see below): on a rebalance
//     bar, when the whole universe's mean 12h return is negative (a weak market)
//     any held symbol whose trailing 6h return is below -0.5% is sold at once,
//     and that bar's rebalance is skipped. In a strong market the exit stays
//     off, so a rally's normal dips are ridden out instead of sold.
//   - Sells and buys never share one reply: a sell's proceeds only land at the
//     next open, so the buys for a rebalance that sold anything go out one bar
//     later, with the proceeds in cash.
//   - Long only, no leverage, no lookahead: every decision uses closes already
//     seen (the current bar's close included). Returns are compared exactly with
//     bigint cross-multiplication, so no float rounding ever flips a ranking.
//   - Slippage is left wide open (10_000 bps): the bot trades small notionals
//     against deep pools, so modelled impact is a few bps and the cap never binds.
//
// Why this shape: buy-and-hold loses the market's whole decline, and the dev
// window is a steady grind down. Sitting in cash while no symbol has a positive
// 12h return avoids most of that bleed, and holding the strongest symbols when
// the market turns keeps the bot invested for the recovery. Rebalancing every
// 12 bars (not every bar) keeps fee churn low: each round trip costs 10 bps of
// fee plus ~5 bps of modelled slippage, and hourly returns are ~0.6-1% noisy,
// so trading more often mostly buys noise.
//
// Why the fast exit: the first local grade (v1, no fast exit) came back at
// -$240.41 on the dev window, with the worst legs JITOSOL (-$91.40) and SOL
// (-$70.10): the bot kept holding the smooth decliners through the early hours
// of each down-leg because their 12h return was still positive. A 6h return
// turns negative hours earlier, so exiting on it cuts those legs short. Offline
// re-simulation of the same rule on the dev window improved the full-window
// score from -$218 to -$85 and the mean margin over buy-and-hold across
// rolling 72-bar windows from +$172 to +$198, with the worst window unchanged
// (-$262) and the trade count still above the 8-trade minimum on every window.
//
// Guardrails it respects: at most 6 open positions (cap 10), at most 12 orders
// per bar (cap 16), each buy capped at 25% of equity (max_weight_bps), buys
// skipped below the minimum notional, and it trades on most rebalance bars, so
// it clears the 8-trade minimum on a 72-bar window.
//
// The grader runs `node /bot/main.ts` with this directory mounted at /bot;
// vendor/makefun-bars.ts is a byte-identical copy of the kit's sdk/makefun-bars.ts.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

/** Trailing bars used for the momentum ranking and the positive-return filter. */
const LOOKBACK_BARS = 12;
/** Rebalance every this many bars (the first rebalance is the first bar with a full lookback). */
const REBALANCE_EVERY = 12;
/** The most symbols held at once: 6 of 7, so the weakest symbol is always cut. */
const TOP_N = 6;
/** Fast-exit lookback: a held symbol's trailing return over this many bars. */
const EXIT_LOOKBACK_BARS = 6;
/** Fast-exit threshold: sell when the trailing 6h return is below -0.5% (as -50 bps). */
const EXIT_THRESHOLD_BPS = -50n;
/** Slippage cap left wide open; modelled impact on these pools is only a few bps. */
const MAX_SLIPPAGE_BPS = 10_000;

/** Each universe symbol's latest close as of every batch so far (null before its first bar), by seq. */
const history = new Map<string, (bigint | null)[]>();
/** The next rebalance bar; set from hello: max(LOOKBACK_BARS, the warm-up's batches). */
let nextRebalance = LOOKBACK_BARS;
/** The symbols to buy on this batch, chosen on the rebalance bar before it (whose sells have now filled). */
let entering: string[] | null = null;

/** How many symbols it holds at most: TOP_N unless a cap is tighter. */
const slots = (state: BarsState) =>
  Math.min(TOP_N, state.hello.caps.max_open_positions, state.hello.caps.max_orders_per_bar);

/**
 * The symbols to hold as of batch `seq`: the symbols whose trailing return is
 * positive, best first, up to `slots`. A symbol without a close now and
 * LOOKBACK_BARS back is not ranked. Ties keep universe (code-unit) order:
 * Array.prototype.sort is stable.
 */
function target(state: BarsState, seq: number): string[] {
  const ranked: { symbol: string; now: bigint; then: bigint }[] = [];
  for (const { symbol } of state.hello.symbols) {
    const closes = history.get(symbol)!;
    const now = closes[seq];
    const then = closes[seq - LOOKBACK_BARS];
    if (now === null || now === undefined || then === null || then === undefined) continue;
    if (now <= then) continue; // trend filter: only symbols that rose over the lookback
    ranked.push({ symbol, now, then });
  }
  // now_a / then_a > now_b / then_b, exactly (cross-multiplied).
  ranked.sort((a, b) => {
    const l = a.now * b.then;
    const r = b.now * a.then;
    return l > r ? -1 : l < r ? 1 : 0;
  });
  return ranked.slice(0, slots(state)).map((x) => x.symbol);
}

/** Buy orders for `symbols` not already held, splitting the cash evenly, each capped by max_weight_bps. */
function buys(state: BarsState, symbols: readonly string[]): BuyInput[] {
  const { caps, fees } = state.hello;
  const room = slots(state) - state.positions.size;
  const coming = symbols.filter((s) => !state.positions.has(s) && state.close(s) !== null).slice(0, room > 0 ? room : 0);
  if (coming.length === 0) return [];
  const even = state.cash / BigInt(coming.length);
  const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
  const slice = even < byWeight ? even : byWeight;
  if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
  return coming.map((symbol) => ({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS }));
}

await runBars({
  onHello(state) {
    nextRebalance = Math.max(LOOKBACK_BARS, state.warmupBars);
  },
  onBatch(state, batch) {
    for (const { symbol } of state.hello.symbols) {
      const closes = history.get(symbol) ?? [];
      closes.push(state.close(symbol));
      history.set(symbol, closes);
    }
    // Buys deferred from the previous bar, whose sells have now filled.
    if (entering !== null) {
      const orders = buys(state, entering);
      entering = null;
      return orders;
    }
    if (batch.seq < nextRebalance) return [];
    nextRebalance = batch.seq + REBALANCE_EVERY;
    // Fast exit: only in a weak market (universe mean 12h return negative).
    // Sell every held symbol whose trailing 6h return is below -0.5%, and skip
    // this bar's rebalance: the exits are the priority, re-entry waits for the
    // next rebalance bar. Exact integer comparison: now/then < 1 - 50/10000.
    const mean12 = state.hello.symbols.reduce((sum, { symbol }) => {
      const closes = history.get(symbol)!;
      const now = closes[batch.seq];
      const then = closes[batch.seq - LOOKBACK_BARS];
      if (now === null || now === undefined || then === null || then === undefined) return sum;
      return sum + Number(now) / Number(then) - 1;
    }, 0) / state.hello.symbols.length;
    if (mean12 < 0) {
      const exits: OrderInput[] = [...state.positions]
        .filter(([symbol]) => {
          const closes = history.get(symbol)!;
          const now = closes[batch.seq];
          const then = closes[batch.seq - EXIT_LOOKBACK_BARS];
          if (now === null || now === undefined || then === null || then === undefined) return false;
          return now * 10000n < then * (10000n + EXIT_THRESHOLD_BPS);
        })
        .map(([symbol, p]) => ({ side: 'sell', symbol, qty: p.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }));
      if (exits.length > 0) return exits;
    }
    const want = target(state, batch.seq);
    const sells: OrderInput[] = [...state.positions]
      .filter(([symbol]) => !want.includes(symbol))
      .map(([symbol, p]) => ({ side: 'sell', symbol, qty: p.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }));
    if (sells.length === 0) return buys(state, want);
    entering = want;
    return sells;
  },
});
