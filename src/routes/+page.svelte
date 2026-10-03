<svelte:head>
	<title>You're invited to our wedding!</title>
	<meta name="description" content="You're invited to our wedding! Please RSVP below." />
</svelte:head>

<div class="page">
	<section class="hero" aria-labelledby="invite-heading">
		<h1 id="invite-heading" class="display">You're invited<br />to our wedding!</h1>

		<div class="divider" aria-hidden="true">
			<span class="line"></span>
			<span class="spark">✦</span>
			<span class="line"></span>
		</div>

		<p class="lede">Please RSVP below.</p>
		<a class="btn" href="#rsvp">RSVP</a>
	</section>

	<section class="rsvp" id="rsvp" aria-labelledby="rsvp-heading">
		<h2 id="rsvp-heading" class="display">RSVP</h2>
		<p class="rsvp-text">
			We can't wait to celebrate with you!
			<br />
			<!-- TODO: hook up the real RSVP form once the backend is ready -->
			The RSVP form is coming soon.
		</p>
		<button class="btn" disabled>Coming soon</button>
	</section>
</div>

<style>
	.page {
		--cream: #fbf7f1;
		--ink: #4a4038;
		--muted: #8d8177;
		--rose: #b76e79;
		--rose-deep: #a15a66;

		min-height: 100svh;
		display: flex;
		flex-direction: column;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		color: var(--ink);
		background:
			radial-gradient(60rem 40rem at 50% -10%, rgba(183, 110, 121, 0.08), transparent),
			var(--cream);
	}

	.hero {
		flex: 1;
		min-height: 85svh;
		display: grid;
		place-content: center;
		text-align: center;
		padding: 4rem 1.5rem;
	}

	.display {
		margin: 0;
		font-family: 'Lavishly Yours', cursive;
		font-weight: 400;
		font-size: clamp(3.2rem, 11vw, 6.5rem);
		line-height: 1.2;
		color: var(--ink);
	}

	.divider {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin: 2rem auto;
	}

	.divider .line {
		width: min(120px, 20vw);
		height: 1px;
		background: var(--rose);
		opacity: 0.5;
	}

	.divider .spark {
		color: var(--rose);
		font-size: 1rem;
		line-height: 1;
	}

	.lede {
		margin: 0;
		font-size: clamp(1.05rem, 2.5vw, 1.25rem);
		letter-spacing: 0.02em;
		color: var(--muted);
	}

	.btn {
		display: inline-block;
		margin-top: 2.5rem;
		padding: 0.9rem 2.8rem 1.15rem;
		border: none;
		border-radius: 999px;
		background: var(--rose);
		color: #fff;
		font-family: 'Lavishly Yours', cursive;
		font-size: 1.9rem;
		line-height: 1;
		text-decoration: none;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.btn:hover:not(:disabled) {
		background: var(--rose-deep);
	}

	.btn:focus-visible {
		outline: 2px solid var(--rose-deep);
		outline-offset: 3px;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.rsvp {
		width: 100%;
		max-width: 640px;
		margin-top: auto;
		padding: 3rem 1.5rem 6rem;
		text-align: center;
	}

	.rsvp .display {
		font-size: clamp(2.5rem, 8vw, 4rem);
	}

	.rsvp-text {
		margin: 1.5rem 0 0;
		font-size: 1.05rem;
		line-height: 1.7;
		color: var(--muted);
	}
</style>
