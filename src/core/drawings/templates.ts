// DRAWING TEMPLATES — per-type named snapshots of a drawing's cosmetics (style, text
// styling, type props such as fib levels) that can be re-applied to any drawing of the same
// type, plus an optional per-type DEFAULT every new drawing of that type starts from. A
// template never carries geometry (anchors) or typed text content.
//
// Stored per type under `vela.drawingTemplates.<type>` through a small synchronous storage
// seam. The core stays headless: until a storage is installed ({@link setDrawingTemplateStorage},
// or {@link ensureDrawingTemplateStorage} from the renderer with the browser's localStorage)
// templates live in memory only. Every storage access is wrapped so a missing/blocked/full
// store degrades to "no templates" instead of throwing; reads are cached so the placement
// ghost (rebuilt per mouse move) never touches storage.

import type { Drawing, DrawingTypeKey } from './Drawing';
import type { DrawingStyle, DrawingText } from './style';
import { clonePlain } from './document';

/** The cosmetic payload a template restores — everything but anchors / ids / text content. */
export interface DrawingTemplateData {
    style: DrawingStyle;
    /** Text styling minus `value` (the typed content stays with the drawing). */
    text?: Omit<DrawingText, 'value'>;
    props?: Record<string, unknown>;
}

/** A named, user-saved template. */
export interface DrawingTemplate extends DrawingTemplateData {
    name: string;
}

/** Everything stored for one drawing type. */
interface TypeTemplates {
    templates: DrawingTemplate[];
    /** Applied to every NEW drawing of the type (absent ⇒ factory defaults). */
    defaults?: DrawingTemplateData;
}

/** The synchronous key/value seam templates persist through (a subset of `Storage`). */
export interface DrawingTemplateStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Storage key prefix; one entry per drawing type. */
export const DRAWING_TEMPLATES_KEY_PREFIX = 'vela.drawingTemplates.';

/** `undefined` = never configured (memory only, and {@link ensureDrawingTemplateStorage} may
 *  still install one); `null` = persistence explicitly disabled. */
let installed: DrawingTemplateStorage | null | undefined;
const cache = new Map<string, TypeTemplates>();

/** Route template persistence to a host store (`null` disables persistence, `undefined`
 *  un-configures it). Clears the read cache. */
export function setDrawingTemplateStorage(storage: DrawingTemplateStorage | null | undefined): void {
    installed = storage;
    cache.clear();
}

/** Install `storage` only when the host hasn't configured one — the renderer's default. */
export function ensureDrawingTemplateStorage(storage: DrawingTemplateStorage | null): void {
    if (installed === undefined) setDrawingTemplateStorage(storage);
}

function storage(): DrawingTemplateStorage | null {
    return installed ?? null;
}

function load(type: string): TypeTemplates {
    const hit = cache.get(type);
    if (hit) return hit;
    let out: TypeTemplates = { templates: [] };
    try {
        const raw = storage()?.getItem(DRAWING_TEMPLATES_KEY_PREFIX + type);
        if (raw) out = sanitize(JSON.parse(raw));
    } catch {
        /* unreadable / corrupt → no templates */
    }
    cache.set(type, out);
    return out;
}

function save(type: string, data: TypeTemplates): void {
    cache.set(type, data);
    try {
        const s = storage();
        if (!s) return;
        if (data.templates.length === 0 && !data.defaults) s.removeItem(DRAWING_TEMPLATES_KEY_PREFIX + type);
        else s.setItem(DRAWING_TEMPLATES_KEY_PREFIX + type, JSON.stringify(data));
    } catch {
        /* best-effort (quota / privacy mode) — the in-memory cache still serves this session */
    }
}

function isData(v: unknown): v is DrawingTemplateData {
    if (!v || typeof v !== 'object') return false;
    const o = v as Partial<DrawingTemplateData>;
    return !!o.style && typeof o.style === 'object' && (o.props === undefined || (typeof o.props === 'object' && o.props !== null));
}

/** Coerce an untrusted stored record into a valid shape (drops malformed entries). */
function sanitize(v: unknown): TypeTemplates {
    const o = (v && typeof v === 'object' ? v : {}) as { templates?: unknown; defaults?: unknown };
    const templates = Array.isArray(o.templates)
        ? o.templates.filter((t): t is DrawingTemplate => isData(t) && typeof (t as { name?: unknown }).name === 'string' && (t as DrawingTemplate).name.length > 0)
        : [];
    return { templates, ...(isData(o.defaults) ? { defaults: o.defaults } : {}) };
}

/** Snapshot a drawing's cosmetics as template data (no anchors, no typed text). */
export function templateDataOf(drawing: Drawing): DrawingTemplateData {
    const doc = drawing.serialize();
    const out: DrawingTemplateData = { style: clonePlain(doc.style) };
    if (doc.text) {
        const { value: _value, ...rest } = doc.text;
        out.text = clonePlain(rest);
    }
    if (doc.props) out.props = clonePlain(doc.props);
    return out;
}

/** Apply template data onto a drawing in place (style, text styling, props). Geometry,
 *  lock/visibility, z-order and typed text content are kept. */
export function applyTemplateData(drawing: Drawing, data: DrawingTemplateData): void {
    drawing.style = { ...drawing.style, ...clonePlain(data.style) };
    if (data.text) drawing.text = { ...clonePlain(data.text), value: drawing.text?.value ?? '' };
    if (data.props) drawing.applyProps(clonePlain(data.props));
}

/** The saved templates for a type, in save order. */
export function listDrawingTemplates(type: DrawingTypeKey | string): readonly DrawingTemplate[] {
    return load(type).templates;
}

/** One saved template by name. */
export function getDrawingTemplate(type: DrawingTypeKey | string, name: string): DrawingTemplate | undefined {
    return load(type).templates.find((t) => t.name === name);
}

/** Save the drawing's cosmetics as a named template of its type (same name ⇒ overwritten). */
export function saveDrawingTemplate(drawing: Drawing, name: string): DrawingTemplate | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const cur = load(drawing.type);
    const tpl: DrawingTemplate = { name: trimmed, ...templateDataOf(drawing) };
    const templates = cur.templates.filter((t) => t.name !== trimmed);
    templates.push(tpl);
    save(drawing.type, { ...cur, templates });
    return tpl;
}

/** Remove a named template; true when one was removed. */
export function deleteDrawingTemplate(type: DrawingTypeKey | string, name: string): boolean {
    const cur = load(type);
    const templates = cur.templates.filter((t) => t.name !== name);
    if (templates.length === cur.templates.length) return false;
    save(type, { ...cur, templates });
    return true;
}

/** Apply a saved template to a drawing of its type; false when the name is unknown. */
export function applyDrawingTemplate(drawing: Drawing, name: string): boolean {
    const tpl = getDrawingTemplate(drawing.type, name);
    if (!tpl) return false;
    applyTemplateData(drawing, tpl);
    return true;
}

/** Make the drawing's cosmetics the default every new drawing of its type starts with. */
export function saveDefaultDrawingTemplate(drawing: Drawing): void {
    const cur = load(drawing.type);
    save(drawing.type, { ...cur, defaults: templateDataOf(drawing) });
}

/** The type's saved default (what new drawings start from), if any. */
export function defaultDrawingTemplate(type: DrawingTypeKey | string): DrawingTemplateData | undefined {
    return load(type).defaults;
}

/** Forget the type's saved default — new drawings go back to the factory defaults. */
export function clearDefaultDrawingTemplate(type: DrawingTypeKey | string): void {
    const cur = load(type);
    if (!cur.defaults) return;
    save(type, { templates: cur.templates });
}
