// Site theme (knowledge/design/tokens.md, knowledge/design/theme-customization.md).
//
// The theme is a flat set of usage-named controls — base colors plus the
// mix percentages / mix-with colors that the derived color-mix() tokens in
// src/app.css consume. The theme page (/theme) writes the base controls
// onto :root as the same custom properties; the derived tokens (card
// surface, muted text, hover colors, tints, glow) are pure CSS, so the
// live site and the preview render identical colors.
//
// Persistence is client-only: localStorage under STORAGE_KEY. The theme
// is per-browser — there is no shared server state, and the shipped
// defaults (declared in app.css) are what visitors without a saved theme
// see.

interface ThemeVar {
	/** CSS custom property this control drives on :root. */
	var: string;
	/** 'color' → hex color picker, 'number' → 0–100 percentage input. */
	kind: 'color' | 'number';
	/** Shipped default (also the :root default in app.css). */
	def: string | number;
}

/** Every theme control, keyed by a short name the page groups into sections. */
export const THEME_VARS = {
	// Page
	bg: { var: '--bg', kind: 'color', def: '#2a406e' },
	glow: { var: '--glow', kind: 'color', def: '#5d9b8e' },
	'glow-alpha': { var: '--glow-alpha', kind: 'number', def: 9 },
	'selection-bg': { var: '--selection-bg', kind: 'color', def: '#5d9b8e' },
	'selection-text': { var: '--selection-text', kind: 'color', def: '#17263f' },
	// Text
	text: { var: '--text', kind: 'color', def: '#ccbdef' },
	'muted-mix': { var: '--muted-mix', kind: 'number', def: 25 },
	// Surfaces
	'card-mix': { var: '--card-mix', kind: 'number', def: 12 },
	// Links & focus
	link: { var: '--link', kind: 'color', def: '#5d9b8e' },
	'link-hover-mix': { var: '--link-hover-mix', kind: 'number', def: 25 },
	'link-hover-mix-with': { var: '--link-hover-mix-with', kind: 'color', def: '#123514' },
	// Primary button
	'btn-primary-bg': { var: '--btn-primary-bg', kind: 'color', def: '#ccbdef' },
	'btn-primary-text': { var: '--btn-primary-text', kind: 'color', def: '#2a406e' },
	'btn-primary-hover-mix': { var: '--btn-primary-hover-mix', kind: 'number', def: 20 },
	'btn-primary-hover-mix-with': {
		var: '--btn-primary-hover-mix-with',
		kind: 'color',
		def: '#2a406e',
	},
	// Secondary button
	'btn-secondary-fill': { var: '--btn-secondary-fill', kind: 'color', def: '#ccbdef' },
	'btn-secondary-alpha': { var: '--btn-secondary-alpha', kind: 'number', def: 10 },
	'btn-secondary-hover-mix': { var: '--btn-secondary-hover-mix', kind: 'number', def: 25 },
	'btn-secondary-hover-mix-with': {
		var: '--btn-secondary-hover-mix-with',
		kind: 'color',
		def: '#2a406e',
	},
	// Danger button (text color is --error)
	'btn-danger-hover-mix': { var: '--btn-danger-hover-mix', kind: 'number', def: 20 },
	'btn-danger-hover-mix-with': {
		var: '--btn-danger-hover-mix-with',
		kind: 'color',
		def: '#e8966a',
	},
	// Inputs & table
	'input-border': { var: '--input-border', kind: 'color', def: '#54697a' },
	'table-border': { var: '--table-border', kind: 'color', def: '#4f5c8b' },
	// Feedback & badges
	success: { var: '--success', kind: 'color', def: '#a3c5ac' },
	error: { var: '--error', kind: 'color', def: '#e8966a' },
	'badge-tint': { var: '--badge-tint', kind: 'number', def: 25 },
	'badge-pending-fill': { var: '--badge-pending-fill', kind: 'color', def: '#54697a' },
	'badge-pending-text': { var: '--badge-pending-text', kind: 'color', def: '#ccbdef' },
	// Menu
	'menu-hover-mix': { var: '--menu-hover-mix', kind: 'number', def: 12 },
	'menu-hover-mix-with': { var: '--menu-hover-mix-with', kind: 'color', def: '#5d9b8e' },
} satisfies Record<string, ThemeVar>;

export type ThemeKey = keyof typeof THEME_VARS;

/** Live theme values. The module-level $state is shared by the root layout
    (which applies it on mount) and the /theme page (which edits it). */
export const theme = $state<{ [K in ThemeKey]: string | number }>(
	Object.fromEntries(
		Object.entries(THEME_VARS).map(([k, v]) => [k, v.def]),
	) as { [K in ThemeKey]: string | number },
);

const STORAGE_KEY = 'juneau.theme.v1';
let initialised = false;

/** Read any saved theme from localStorage into `theme` and apply it.
    Called once from the root layout's onMount. Safe to skip (SSR): the
    shipped defaults in app.css are already in effect. */
export function initTheme() {
	if (initialised) return;
	initialised = true;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const saved = JSON.parse(raw) as Record<string, unknown>;
			for (const k of Object.keys(THEME_VARS) as ThemeKey[]) {
				const v = saved[k];
				const ok =
					THEME_VARS[k].kind === 'color'
						? typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
						: typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
				if (ok) theme[k] = v as string | number;
			}
		}
	} catch (err) {
		console.warn('theme: could not read saved theme, using defaults', err);
	}
	applyTheme();
}

/** Update one control: apply to :root and persist. */
export function setThemeValue(key: ThemeKey, value: string | number) {
	theme[key] = value;
	applyTheme();
	persist();
}

/** Restore the shipped defaults and drop the saved theme. */
export function resetTheme() {
	for (const k of Object.keys(THEME_VARS) as ThemeKey[]) theme[k] = THEME_VARS[k].def;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// storage unavailable — defaults are still applied
	}
	applyTheme();
}

function applyTheme() {
	const root = document.documentElement;
	for (const k of Object.keys(THEME_VARS) as ThemeKey[]) {
		root.style.setProperty(THEME_VARS[k].var, String(theme[k]));
	}
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
	} catch {
		// storage unavailable — theme applies for this session only
	}
}
