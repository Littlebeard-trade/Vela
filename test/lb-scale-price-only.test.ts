import { afterEach, describe, expect, it } from 'vitest';
import { computePaneScale } from '../src/renderers/native/core/autoscale';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { OHLCV } from '../src/core/model/ohlcv';

/** LB hook: globalThis.__lbScalePriceOnly makes the price pane scale to the candles alone. */
const T = 1_700_000_000_000;
const bars: OHLCV[] = [0, 1, 2].map((i) => ({ time: T + i * 60_000, open: 100, high: 110, low: 90, close: 100, volume: 1 }));
const overlay: IndicatorModel = {
    id: 'pp', title: 'Pivots', overlay: true, paneHint: 'price', paneId: 'price',
    series: [{ id: 'pp:r3', title: 'R3', paneId: 'price', kind: 'line', points: bars.map((b) => ({ time: b.time, value: 500 })), style: { color: '#f00', width: 1, lineStyle: 'solid' } }],
    fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
};
const m0 = { top: 0, bottom: 0 };

describe('LB: scale price chart only', () => {
    afterEach(() => { delete (globalThis as any).__lbScalePriceOnly; });
    it('off (stock Vela): an overlay plot far from price stretches the price pane', () => {
        expect(computePaneScale([overlay], bars, true, 0, 2, null, false, () => 0, m0)).toEqual({ min: 90, max: 500 });
    });
    it('on: the price pane fits the candles only', () => {
        (globalThis as any).__lbScalePriceOnly = true;
        expect(computePaneScale([overlay], bars, true, 0, 2, null, false, () => 0, m0)).toEqual({ min: 90, max: 110 });
    });
    it('on: study panes (includeCandles=false) still scale to their plots', () => {
        (globalThis as any).__lbScalePriceOnly = true;
        expect(computePaneScale([overlay], [], false, 0, 2, null, false, () => 0, m0)).toMatchObject({ min: 450, max: 550 });
    });
});
