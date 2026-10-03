/**
 * The countdown-to-bar-close chip's text for a bar opened at `barOpen` on a `barMs`
 * cadence, as seen at wall-clock `now`.
 *
 * Once that bar has closed and the next one hasn't printed yet (a quiet minute, a feed
 * that delivers bars late), the chip keeps counting to the NEXT boundary on the same
 * grid, like TradingView, for up to `CARRY_MS` (15 min) or one bar, whichever is
 * longer. Past that the chart is stale or the market is shut (weekend, halt), and the
 * chip is `null` rather than counting against bars that aren't coming. Daily and longer
 * bars never carry: their boundaries follow the session calendar, not a fixed grid.
 *
 * The remaining time is rounded UP so the chip agrees with a clock that shows whole
 * seconds: at `hh:mm:54.500` the clock reads `:54`, which implies 6 s to the minute,
 * and the chip reads `00:06` — flooring would read `00:05` for that whole second.
 */
const CARRY_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

export function countdownText(barOpen: number, barMs: number, now: number): string | null {
    if (!(barMs > 0)) return null;
    const close = barOpen + barMs;
    if (now < close) return formatCountdown(close - now);
    if (barMs >= DAY_MS || now - close >= Math.max(CARRY_MS, barMs)) return null;
    return formatCountdown(barMs - ((now - close) % barMs));
}

/** `MM:SS` (or `H:MM:SS` past an hour) for the ms remaining until the bar closes, rounded up. */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (v: number): string => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
