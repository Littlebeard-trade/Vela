import { msg } from '../../i18n/message';
import { BULLISH, BEARISH, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { colorInput, floatInput, lengthInput, transp } from './shared';
import { highs, lows, barsSinceHighest, barsSinceLowest, trueRange, rma, sum, map, zip } from './math';

/** Directional/trend-strength studies. */

const aroon: ClassicIndicatorSpec = {
    type: 'aroon',
    title: msg('indicator.aroon.title', 'Aroon'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.aroon.length', 'Length'), 5000, msg('indicator.aroon.length.tooltip', 'Lookback length used to locate the highest high and lowest low.')),
        colorInput(BULLISH, msg('indicator.aroon.upColor', 'Aroon Up'), 'upColor', msg('indicator.aroon.upColor.tooltip', 'Color of the Aroon Up line.')),
        colorInput(BEARISH, msg('indicator.aroon.downColor', 'Aroon Down'), 'downColor', msg('indicator.aroon.downColor.tooltip', 'Color of the Aroon Down line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const up = map(barsSinceHighest(highs(bars), len), (x) => (100 * (len - x)) / len);
        const down = map(barsSinceLowest(lows(bars), len), (x) => (100 * (len - x)) / len);
        return {
            plots: [
                { key: 'up', title: msg('indicator.aroon.plot.up', 'Aroon Up'), values: up, color: str(inputs, 'upColor', BULLISH) },
                { key: 'down', title: msg('indicator.aroon.plot.down', 'Aroon Down'), values: down, color: str(inputs, 'downColor', BEARISH) },
            ],
        };
    },
};

const adx: ClassicIndicatorSpec = {
    type: 'average-directional-index',
    title: msg('indicator.averageDirectionalIndex.title', 'Average Directional Index'),
    shortTitle: msg('indicator.averageDirectionalIndex.shortTitle', 'ADX'),
    overlay: false,
    inputs: [
        lengthInput(14, 'diLength', msg('indicator.averageDirectionalIndex.diLength', 'DI Length'), 5000, msg('indicator.averageDirectionalIndex.diLength.tooltip', 'Wilder RMA smoothing length applied to directional movement and true range when computing +DI and −DI.')),
        lengthInput(14, 'adxLength', msg('indicator.averageDirectionalIndex.adxLength', 'ADX Smoothing'), 5000, msg('indicator.averageDirectionalIndex.adxLength.tooltip', 'Wilder RMA smoothing length applied to DX to obtain the ADX line.')),
        floatInput('keyLevel', msg('indicator.averageDirectionalIndex.keyLevel', 'Key Level'), 25, 0, 100, 1, msg('indicator.averageDirectionalIndex.keyLevel.tooltip', 'Trend strength reference level; ADX above it is commonly read as a trending market.')),
        colorInput(BULLISH, msg('indicator.averageDirectionalIndex.plusDiColor', '+DI Color'), 'plusDiColor', msg('indicator.averageDirectionalIndex.plusDiColor.tooltip', 'Color of the plus directional indicator, and of the ADX line above the key level while +DI leads.')),
        colorInput(BEARISH, msg('indicator.averageDirectionalIndex.minusDiColor', '−DI Color'), 'minusDiColor', msg('indicator.averageDirectionalIndex.minusDiColor.tooltip', 'Color of the minus directional indicator, and of the ADX line above the key level while −DI leads.')),
        colorInput(NEUTRAL, msg('indicator.averageDirectionalIndex.adxColor', 'ADX Color'), 'adxColor', msg('indicator.averageDirectionalIndex.adxColor.tooltip', 'Color of the ADX line while it sits below the key level — no trend strong enough to trade.')),
    ],
    compute: (bars, inputs) => {
        const diLen = num(inputs, 'diLength', 14);
        const n = bars.length;
        const plusDm = new Array<number>(n).fill(Number.NaN);
        const minusDm = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            const up = bars[i]!.high - bars[i - 1]!.high;
            const dn = bars[i - 1]!.low - bars[i]!.low;
            plusDm[i] = up > dn && up > 0 ? up : 0;
            minusDm[i] = dn > up && dn > 0 ? dn : 0;
        }
        const atrLine = rma(trueRange(bars), diLen);
        const plusDi = zip(rma(plusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const minusDi = zip(rma(minusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const dx = zip(plusDi, minusDi, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
        const adxLine = rma(dx, num(inputs, 'adxLength', 14));
        const plusInk = str(inputs, 'plusDiColor', BULLISH);
        const minusInk = str(inputs, 'minusDiColor', BEARISH);
        const neutralInk = str(inputs, 'adxColor', NEUTRAL);
        const keyLevel = num(inputs, 'keyLevel', 25);
        // The ADX borrows the dominant DI's color once it clears the key level.
        const adxColors = adxLine.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            if (x <= keyLevel) return neutralInk;
            return (plusDi[i] ?? 0) > (minusDi[i] ?? 0) ? plusInk : minusInk;
        });
        return {
            plots: [
                { key: 'plusDi', title: msg('indicator.averageDirectionalIndex.plot.plusDi', '+DI'), values: plusDi, color: transp(plusInk, 30) },
                { key: 'minusDi', title: '-DI', displayTitle: msg('indicator.averageDirectionalIndex.plot.minusDi', '−DI'), values: minusDi, color: transp(minusInk, 30) },
                { key: 'adx', title: msg('indicator.averageDirectionalIndex.plot.adx', 'ADX'), values: adxLine, color: neutralInk, width: 2, colors: adxColors },
            ],
            levels: [{ key: 'keyLevel', price: keyLevel, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.averageDirectionalIndex.level.keyLevel', 'Key Level') }],
        };
    },
};

const vortex: ClassicIndicatorSpec = {
    type: 'vortex-indicator',
    title: msg('indicator.vortexIndicator.title', 'Vortex Indicator'),
    shortTitle: msg('indicator.vortexIndicator.shortTitle', 'VI'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.vortexIndicator.length', 'Length'), 5000, msg('indicator.vortexIndicator.length.tooltip', 'Number of bars used to sum the vortex movements (VM+ and VM−) and the true range.')),
        colorInput(BULLISH, msg('indicator.vortexIndicator.plusColor', 'VI+'), 'plusColor', msg('indicator.vortexIndicator.plusColor.tooltip', 'Color of the positive vortex line (VI+).')),
        colorInput(BEARISH, msg('indicator.vortexIndicator.minusColor', 'VI−'), 'minusColor', msg('indicator.vortexIndicator.minusColor.tooltip', 'Color of the negative vortex line (VI−).')),
        colorInput(NEUTRAL, msg('indicator.vortexIndicator.baselineColor', 'Baseline'), 'baselineColor', msg('indicator.vortexIndicator.baselineColor.tooltip', 'Color of the dotted baseline drawn at 1.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const n = bars.length;
        const vmPlus = new Array<number>(n).fill(Number.NaN);
        const vmMinus = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            vmPlus[i] = Math.abs(bars[i]!.high - bars[i - 1]!.low);
            vmMinus[i] = Math.abs(bars[i]!.low - bars[i - 1]!.high);
        }
        const trSum = sum(trueRange(bars), len);
        return {
            plots: [
                { key: 'viPlus', title: msg('indicator.vortexIndicator.plot.viPlus', 'VI+'), values: zip(sum(vmPlus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: str(inputs, 'plusColor', BULLISH) },
                { key: 'viMinus', title: 'VI-', displayTitle: msg('indicator.vortexIndicator.plot.viMinus', 'VI−'), values: zip(sum(vmMinus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: str(inputs, 'minusColor', BEARISH) },
            ],
            levels: [{ key: 'baseline', price: 1, color: str(inputs, 'baselineColor', NEUTRAL), lineStyle: 'dotted', title: msg('indicator.vortexIndicator.level.baseline', 'Baseline') }],
        };
    },
};

export const trendSpecs: ClassicIndicatorSpec[] = [aroon, adx, vortex];
