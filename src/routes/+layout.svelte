<script lang="ts">
	import '@fontsource/lavishly-yours/latin.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '#lib/supabase';
	import { auth, hasPermission, initAuth, signOut } from '#lib/session.svelte.ts';

	let { children } = $props();

	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);

	let menuOpen = $state(false);
	let menuLeft = $state<number | undefined>(undefined);
	let menuBtnEl = $state.raw<HTMLButtonElement | undefined>(undefined);
	let menuEl = $state.raw<HTMLDivElement | undefined>(undefined);

	// The account menu closes on outside click and Escape while open.
	$effect(() => {
		if (!menuOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (e.target instanceof Element && e.target.closest('.account-menu')) return;
			menuOpen = false;
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') menuOpen = false;
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	});

	// The dropdown is CSS-defaulted to right-aligned with the button. When
	// the header wraps (narrow screens) the button can sit at the viewport's
	// left edge and the menu would overflow off-screen, so while open we
	// measure and clamp its left position to keep it in the viewport with a
	// margin.
	const MENU_MARGIN_PX = 8;

	$effect(() => {
		if (!menuOpen) {
			menuLeft = undefined;
			return;
		}
		const place = () => {
			const btn = menuBtnEl;
			const menu = menuEl;
			if (!btn || !menu) return;
			const btnRect = btn.getBoundingClientRect();
			const width = menu.offsetWidth;
			if (!width) return;
			// Desired: menu's right edge aligned with the button's.
			const desiredLeft = btnRect.right - width;
			const maxLeft = Math.max(window.innerWidth - MENU_MARGIN_PX - width, MENU_MARGIN_PX);
			menuLeft = Math.min(Math.max(desiredLeft, MENU_MARGIN_PX), maxLeft) - btnRect.left;
		};
		place();
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	});

	onMount(() => initAuth());

	// Admin-notification fallback (knowledge/api/notify-registration.md):
	// the register page fires notify-registration right after signup; this
	// covers the case where that call never went through (tab closed) — the
	// guest's first visit after confirming their email lands here on the
	// awaiting-approval screen. The function is idempotent (the
	// users.admin_notified_at stamp), so re-firing is a cheap no-op, and a
	// failed send isn't stamped, so the next "check status" refresh
	// (a fresh profile object) retries it.
	$effect(() => {
		const profile = auth.profile;
		if (auth.kind !== 'ready' || !profile || profile.status !== 'pending' || profile.admin_notified_at) {
			return;
		}
		void supabase
			.functions.invoke('notify-registration', { body: { email: profile.email } })
			.then(({ error }) => {
				if (error) console.warn('notify-registration fallback failed:', error);
			});
	});

	async function onSignOut() {
		menuOpen = false;
		await signOut();
		await goto('/');
	}
</script>

<svelte:head>
	<link
		rel="icon"
		href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E💍%3C/text%3E%3C/svg%3E"
	/>
</svelte:head>

<header class="site-header frame">
	<a class="brand display" href="/">juneau<span class="dot">.</span>love</a>
	<nav class="site-nav">
		{#if auth.kind === 'anonymous'}
			<a href="/login">Sign in</a>
			<a href="/register">Register</a>
		{:else if auth.kind === 'ready'}
			{#if status === 'approved'}
				<a href="/gallery">Photos</a>
				<a href="/things-to-do">Things to Do</a>
			{/if}
			{#if hasPermission('registrations:read')}
				<a href="/registrations">Registrations</a>
			{/if}
			<span class="who">{name}</span>
			<span class="account-menu">
				<button
					type="button"
					class="menu-btn"
					aria-label="Menu"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					bind:this={menuBtnEl}
					onclick={() => (menuOpen = !menuOpen)}
				>
					<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
						<path
							d="M1 1h14M1 6h14M1 11h14"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				{#if menuOpen}
					<div
						class="menu"
						role="menu"
						aria-label="Account"
						bind:this={menuEl}
						style={menuLeft === undefined ? undefined : `left: ${menuLeft}px; right: auto`}
					>
						<a
							role="menuitem"
							class="menu-item"
							href="/change-name"
							onclick={() => (menuOpen = false)}
						>
							Change Name
						</a>
						<button type="button" role="menuitem" class="menu-item" onclick={onSignOut}>
							Sign Out
						</button>
					</div>
				{/if}
			</span>
		{/if}
	</nav>
</header>

<main class="frame">
	{@render children()}
</main>
