<script lang="ts">
	// Theme admin page (knowledge/design/theme-customization.md).
	// Left: every theme control, grouped. Right: a live preview built from
	// the real component classes — each hoverable element also appears as a
	// static "hover" twin painted with the hover color, because while you're
	// picking colors your mouse is on the left pane, not on the preview.
	//
	// Controls apply to :root immediately (src/lib/theme.svelte.ts) and
	// auto-save to localStorage; there is no explicit save button.

	import { THEME_VARS, resetTheme, setThemeValue, theme, type ThemeKey } from '#lib/theme.svelte.ts';

	interface Row {
		key: ThemeKey;
		label: string;
	}
	interface Section {
		title: string;
		rows: Row[];
	}

	const SECTIONS: Section[] = [
		{
			title: 'Page',
			rows: [
				{ key: 'bg', label: 'Page background' },
				{ key: 'glow', label: 'Top-of-page glow' },
				{ key: 'glow-alpha', label: 'Glow strength' },
				{ key: 'selection-bg', label: 'Text selection background' },
				{ key: 'selection-text', label: 'Text selection text' },
			],
		},
		{
			title: 'Text',
			rows: [
				{ key: 'text', label: 'Body text' },
				{ key: 'muted-mix', label: 'Muted text strength (toward page)' },
			],
		},
		{
			title: 'Surfaces',
			rows: [{ key: 'card-mix', label: 'Card surface strength (toward text)' }],
		},
		{
			title: 'Links & focus',
			rows: [
				{ key: 'link', label: 'Links & focus outline' },
				{ key: 'link-hover-mix', label: 'Link hover strength' },
				{ key: 'link-hover-mix-with', label: 'Link hover mixes toward' },
			],
		},
		{
			title: 'Primary button',
			rows: [
				{ key: 'btn-primary-bg', label: 'Background' },
				{ key: 'btn-primary-text', label: 'Text' },
				{ key: 'btn-primary-hover-mix', label: 'Hover strength' },
				{ key: 'btn-primary-hover-mix-with', label: 'Hover mixes toward' },
			],
		},
		{
			title: 'Secondary button',
			rows: [
				{ key: 'btn-secondary-fill', label: 'Fill color' },
				{ key: 'btn-secondary-alpha', label: 'Fill strength' },
				{ key: 'btn-secondary-hover-mix', label: 'Hover strength' },
				{ key: 'btn-secondary-hover-mix-with', label: 'Hover mixes toward' },
			],
		},
		{
			title: 'Danger button',
			rows: [
				{ key: 'btn-danger-hover-mix', label: 'Hover strength' },
				{ key: 'btn-danger-hover-mix-with', label: 'Hover mixes toward' },
			],
		},
		{
			title: 'Inputs & table',
			rows: [
				{ key: 'input-border', label: 'Input border' },
				{ key: 'table-border', label: 'Table rules' },
			],
		},
		{
			title: 'Feedback & badges',
			rows: [
				{ key: 'success', label: 'Success' },
				{ key: 'error', label: 'Error' },
				{ key: 'badge-tint', label: 'Badge tint strength' },
				{ key: 'badge-pending-fill', label: 'Pending badge tint color' },
				{ key: 'badge-pending-text', label: 'Pending badge text' },
			],
		},
		{
			title: 'Menu',
			rows: [
				{ key: 'menu-hover-mix', label: 'Item hover strength' },
				{ key: 'menu-hover-mix-with', label: 'Item hover mixes toward' },
			],
		},
	];

	// ---- live contrast check -------------------------------------------------
	// Replicates the app.css color-mix derivations (straight sRGB interpolation)
	// so the preview can show WCAG ratios for the pairs that matter.

	type Rgb = [number, number, number];

	function hexToRgb(hex: string): Rgb {
		const n = parseInt(hex.replace('#', ''), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
		return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
	}
	/** Alpha-composite fg over bg (t = fg opacity 0–1). */
	function over(fg: Rgb, bg: Rgb, t: number): Rgb {
		return [0, 1, 2].map((i) => Math.round(fg[i] * t + bg[i] * (1 - t))) as Rgb;
	}
	function luminance([r, g, b]: Rgb): number {
		const f = (c: number) => {
			c /= 255;
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	}
	function contrast(a: Rgb, b: Rgb): number {
		const la = luminance(a);
		const lb = luminance(b);
		return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
	}

	const checks = $derived.by(() => {
		const c = (k: ThemeKey) => hexToRgb(String(theme[k]));
		const n = (k: ThemeKey) => Number(theme[k]) / 100;
		const bg = c('bg');
		const card = mixRgb(c('bg'), c('text'), n('card-mix'));
		const muted = mixRgb(c('text'), c('bg'), n('muted-mix'));
		const linkHover = mixRgb(c('link'), c('link-hover-mix-with'), n('link-hover-mix'));
		const primaryHoverBg = mixRgb(
			c('btn-primary-bg'),
			c('btn-primary-hover-mix-with'),
			n('btn-primary-hover-mix'),
		);
		const secondaryFill = over(c('btn-secondary-fill'), card, n('btn-secondary-alpha'));
		const pairs: [string, Rgb, Rgb][] = [
			['Body text on page', c('text'), bg],
			['Body text on card', c('text'), card],
			['Muted text on page', muted, bg],
			['Muted text on card', muted, card],
			['Link on page', c('link'), bg],
			['Link (hover) on page', linkHover, bg],
			['Primary button text', c('btn-primary-text'), c('btn-primary-bg')],
			['Primary button text (hover)', c('btn-primary-text'), primaryHoverBg],
			['Secondary button text', c('text'), secondaryFill],
			['Success on page', c('success'), bg],
			['Error on page', c('error'), bg],
			['Pending badge text', c('badge-pending-text'), over(c('badge-pending-fill'), card, n('badge-tint'))],
			['Approved badge text', c('success'), over(c('success'), card, n('badge-tint'))],
			['Rejected badge text', c('error'), over(c('error'), card, n('badge-tint'))],
			['Selection text', c('selection-text'), c('selection-bg')],
		];
		return pairs.map(([label, fg, bgc]) => ({ label, ratio: contrast(fg, bgc) }));
	});
</script>

<svelte:head>
	<title>Theme — juneau.love</title>
</svelte:head>

<h1 class="display" style="font-size: 2.6rem">Theme</h1>
<p class="sub">
	Every color the site uses, named by what it does. Changes apply live and save to this
	browser automatically — the site is themed per browser, so guests see the shipped
	defaults until you wire this up to a shared store.
</p>

<div class="theme-page">
	<section class="controls" aria-label="Theme controls">
		{#each SECTIONS as s (s.title)}
			<h3>{s.title}</h3>
			{#each s.rows as r (r.key)}
				{@const meta = THEME_VARS[r.key]}
				<div class="row">
					<label for="theme-{r.key}">{r.label}</label>
					{#if meta.kind === 'color'}
						<input
							id="theme-{r.key}"
							type="color"
							value={String(theme[r.key])}
							oninput={(e) => setThemeValue(r.key, (e.currentTarget as HTMLInputElement).value)}
						/>
						<code class="hex">{String(theme[r.key])}</code>
					{:else}
						<input
							id="theme-{r.key}"
							type="number"
							min="0"
							max="100"
							step="1"
							value={Number(theme[r.key])}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
								if (Number.isFinite(v)) setThemeValue(r.key, Math.min(100, Math.max(0, v)));
							}}
						/>
						<code class="hex">%</code>
					{/if}
				</div>
			{/each}
		{/each}
		<div class="reset-row">
			<button type="button" class="btn secondary small" onclick={resetTheme}>
				Reset to defaults
			</button>
		</div>
	</section>

	<section class="preview" aria-label="Live theme preview">
		<h3>Preview</h3>
		<p class="pv-note">
			Everything below is the real UI, rendered live. The “(hover)” twins are painted
			with the hover color directly, since your mouse is on the pickers.
		</p>

		<h3>Typography</h3>
		<p class="display pv-display">Juneau, we’re coming</p>
		<p>Body text — Bona Nova. The quick brown fox jumps over the lazy dog.</p>
		<p style="color: var(--text-muted)">
			Muted text — field labels, captions, table headers.
		</p>
		<p><strong>Bold</strong> and <em>italic</em> body text.</p>
		<p class="pv-kicker">Kicker — small caps line</p>
		<p>
			<a href="/theme">A link</a>
			<span class="pv-painted" style="color: var(--link-hover)"> a link (hover)</span>
		</p>
		<p class="brand">juneau<span class="dot">.</span>love</p>

		<h3>Surfaces</h3>
		<div class="pv-swatches">
			<div class="pv-swatch" style="background: var(--bg)"><span>Page</span></div>
			<div class="pv-swatch" style="background: var(--bg-card)"><span>Card</span></div>
			<div class="pv-swatch" style="background: var(--selection-bg); color: var(--selection-text)">
				<span>Selection</span>
			</div>
		</div>

		<h3>Card &amp; buttons</h3>
		<div class="card pv-card">
			<h2>Card title</h2>
			<p class="sub">Secondary copy in the muted color.</p>
			<div class="spread">
				<button type="button" class="btn">Primary</button>
				<button type="button" class="btn pv-painted" style="background: var(--btn-primary-bg-hover)">
					Primary (hover)
				</button>
				<button type="button" class="btn secondary">Secondary</button>
				<button
					type="button"
					class="btn secondary pv-painted"
					style="background: var(--btn-secondary-bg-hover)"
				>
					Secondary (hover)
				</button>
				<button type="button" class="btn danger">Danger</button>
				<button
					type="button"
					class="btn danger pv-painted"
					style="background: var(--btn-danger-bg-hover)"
				>
					Danger (hover)
				</button>
				<button type="button" class="btn" disabled>Disabled</button>
			</div>
		</div>

		<h3>Inputs</h3>
		<label class="field">
			Display name
			<input type="text" placeholder="Type here" />
		</label>
		<label class="field">
			Focused input (static)
			<input class="pv-focused" type="text" readonly value="Focused" />
		</label>

		<h3>Messages</h3>
		<p class="msg ok">Success message.</p>
		<p class="msg err">Error message.</p>

		<h3>Badges</h3>
		<p class="pv-badges">
			<span class="badge pending">pending</span>
			<span class="badge approved">approved</span>
			<span class="badge rejected">rejected</span>
		</p>

		<h3>Table</h3>
		<table class="table">
			<thead>
				<tr>
					<th>Email</th>
					<th>Status</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>ana@example.com</td>
					<td><span class="badge approved">approved</span></td>
					<td class="actions">
						<button type="button" class="btn secondary small">Approve</button>
						<button type="button" class="btn danger small">Reject</button>
					</td>
				</tr>
				<tr>
					<td>bo@example.com</td>
					<td><span class="badge pending">pending</span></td>
					<td class="actions">
						<button type="button" class="btn secondary small">Approve</button>
						<button type="button" class="btn danger small" disabled>Reject</button>
					</td>
				</tr>
			</tbody>
		</table>

		<h3>Gallery figure</h3>
		<div class="gallery-grid pv-gallery">
			<figure>
				<div class="placeholder"></div>
				<figcaption>
					<span class="uploader">ana</span> — Juneau from the ferry
				</figcaption>
			</figure>
		</div>

		<h3>Menu</h3>
		<div class="menu pv-menu" role="presentation">
			<span class="menu-item">Change Name</span>
			<span class="menu-item" style="background: var(--menu-hover-bg); color: var(--link)">
				Change Name (hover)
			</span>
		</div>

		<h3>Contrast</h3>
		<p class="pv-note">WCAG ratios for the pairs the theme produces. 4.5:1 is the AA bar for normal text.</p>
		<ul class="contrast">
			{#each checks as chk}
				<li class={chk.ratio < 4.5 ? 'low' : ''}>
					<span>{chk.label}</span>
					<code>{chk.ratio.toFixed(2)}:1</code>
					{#if chk.ratio < 4.5}<span class="flag">below 4.5:1</span>{/if}
				</li>
			{/each}
		</ul>
		<p class="pv-note">The page glow and the background around this pane are the page itself — live too.</p>
	</section>
</div>

<style>
	.theme-page {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
		align-items: start;
		margin-top: 1.5rem;
	}

	/* Two independently scrolling panes, evenly split. */
	.controls,
	.preview {
		max-height: calc(100vh - 10rem);
		overflow-y: auto;
		padding: 1rem 1.25rem 1.5rem;
		border-radius: 12px;
	}

	/* Mobile: stack the panes, one per half of the screen, so the preview
	   stays visible while editing — each pane scrolls inside its half.
	   (The 1rem is half the gap, so the two halves fit the viewport.)
	 */
	@media (max-width: 720px) {
		.theme-page {
			grid-template-columns: 1fr;
		}
		.controls,
		.preview {
			max-height: calc(50vh - 1rem);
			overflow-y: auto;
		}
	}
	.controls {
		background: var(--bg-card);
		box-shadow: 0 10px 30px -18px rgba(0, 0, 0, 0.6);
	}
	.controls h3 {
		margin: 1.25rem 0 0.25rem;
		font-size: 0.95rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.controls h3:first-child {
		margin-top: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.2rem 0;
	}
	.row label {
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	.row input[type='color'] {
		width: 44px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--input-border);
		border-radius: 6px;
		background: none;
		cursor: pointer;
	}
	.row input[type='number'] {
		width: 64px;
		padding: 0.25rem 0.4rem;
		font-family: inherit;
		font-size: 0.95rem;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--input-border);
		border-radius: 8px;
	}
	.hex {
		font-size: 0.8rem;
		color: var(--text-muted);
		min-width: 5ch;
		text-align: right;
	}
	.reset-row {
		margin-top: 1.5rem;
	}

	.preview h3 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.preview h3:first-child {
		margin-top: 0;
	}
	.pv-note {
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	.pv-display {
		font-size: 2.2rem;
		margin: 0.25rem 0;
	}
	.pv-kicker {
		text-transform: uppercase;
		letter-spacing: 0.35em;
		font-size: 0.8rem;
		color: var(--glow);
	}
	.pv-swatches {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.pv-swatch {
		flex: 1 1 100px;
		min-height: 64px;
		display: flex;
		align-items: flex-end;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		box-shadow: 0 10px 30px -18px rgba(0, 0, 0, 0.6);
		font-size: 0.9rem;
	}
	.pv-card {
		margin-top: 0;
	}
	.pv-focused {
		outline: 2px solid var(--link);
		border-color: var(--link);
	}
	.pv-badges {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.pv-gallery {
		max-width: 240px;
	}
	/* The real .menu is absolutely positioned; the preview shows it inline. */
	.pv-menu {
		position: static;
		display: inline-block;
		margin-top: 0.25rem;
	}
	.contrast {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.9rem;
	}
	.contrast li {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.2rem 0;
		border-bottom: 1px solid var(--table-border);
	}
	.contrast li span:first-child {
		flex: 1;
	}
	.contrast code {
		color: var(--text-muted);
	}
	.contrast .low code {
		color: var(--error);
	}
	.contrast .flag {
		font-size: 0.8rem;
		color: var(--error);
	}
</style>
