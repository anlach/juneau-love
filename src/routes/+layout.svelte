<script lang="ts">
	import '@fontsource/lavishly-yours/latin.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link
		rel="icon"
		href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E💍%3C/text%3E%3C/svg%3E"
	/>
</svelte:head>

{@render children()}
