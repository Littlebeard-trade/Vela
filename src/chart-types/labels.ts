// The names of the price styles, shared by every picker that lists them.
import { msg } from '../core/i18n/message';
import type { MessageLike } from '../core/i18n/types';
import { chartType } from './registry';

/** The built-in styles' names. A registered chart type names itself (`label`). */
export const PRICE_STYLE_LABELS: Readonly<Record<string, MessageLike>> = {
    candles: msg('chart.priceStyle.candles', 'Candles'),
    bars: msg('chart.priceStyle.bars', 'Bars'),
    line: msg('chart.priceStyle.line', 'Line'),
    area: msg('chart.priceStyle.area', 'Area'),
    baseline: msg('chart.priceStyle.baseline', 'Baseline'),
};

/** A price style's name: the registered type's label, the built-in name, else the raw id. */
export function priceStyleMessage(id: string): MessageLike {
    return chartType(id)?.label ?? PRICE_STYLE_LABELS[id] ?? id;
}
