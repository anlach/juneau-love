<script lang="ts">
	import { auth } from '#lib/session.svelte.ts';
	import StateScreen from '#lib/components/StateScreen.svelte';

	// The guide is guest content: approval-gated like the gallery.
	const status = $derived(auth.kind === 'ready' ? auth.profile?.status ?? null : null);
	const name = $derived(auth.profile?.display_name ?? undefined);
	const approved = $derived(status === 'approved');
</script>

<svelte:head>
	<title>Things to Do — juneau.love</title>
</svelte:head>

{#if auth.kind === 'anonymous'}
	<div class="card center">
		<h2 class="display" style="font-size: 2rem">Sign in to continue</h2>
		<p class="sub">The Juneau guide and map wait on the inside.</p>
		<div class="spread"><a class="btn" href="/login">Sign in</a></div>
	</div>
{:else if status === 'pending'}
	<StateScreen status="pending" name={name} />
{:else if status === 'rejected'}
	<StateScreen status="rejected" name={name} />
{:else if auth.kind === 'error'}
	<StateScreen status="error" message={auth.message} />
{:else if approved}
	<!--
		The guide is Morgan's "Things to Do in Juneau (Like a Local on a
		Budget)" email, formatted — the wording is verbatim (including her
		original spellings). See knowledge/stories/things-to-do.md.
	-->
	<article class="guide">
		<h1 class="display" style="font-size: 2.6rem">Things to Do in Juneau</h1>
		<p class="subtitle">(Like a Local on a Budget)</p>

		<p>
			Thank you for considering celebrating with us in Juneau; we are so very excited to
			share a little adventure in Alaska with our friends and loved ones.
		</p>

		<p>
			Juneau is (in my unabashedly biased opinion) one of the most grand and beautiful
			places in the world. With a downtown situated at the base of Mount Juneau and Mount
			Roberts and bordered by a massive ice field on one side and a tidal channel on the
			other, Juneau is accessible only by boat or plane. This is inconvenient and
			impractical, yes, but it is also creates the perfect opportunity for some
			unparalleled hiking, wildlife viewing, and general adventuring. There is a slight
			chance of black bear and <em>Kóoshdaa Káa</em> sightings, and an even higher
			likelihood that you’ll walk away with perennial wet feet and an impressive picture
			or three if you choose to visit.
		</p>

		<p>
			Included here are some general ideas and links for “things to do” whilst in Juneau,
			for both the avid outdoorsperson and the more casual traveler.
		</p>

		<p class="note">
			Note: Juneau is filled with tour companies and events catering to cruisers ad
			nauseam. These are great options if you want bigger excursions or group experiences,
			but this list is certainly not exhaustive and includes mostly free or (relatively)
			low-cost options.
		</p>

		<h2>Take a hike!</h2>
		<p>Juneau has over 100 walking and hiking trails. These are some easy to moderate options.</p>
		<ul>
			<li>
				<strong>Nugget Falls Trail</strong>, Mendenhall Glacier (2-mile out and back, easy
				and up-close to the glacier but busy); <strong>East Glacier Trail</strong> (3.5-mile
				loop with panoramic glacier views)
			</li>
			<li>
				<strong>Lena Point Trail</strong> (1.0 mile, easy coastal rainforest hike, but some
				step-ups and step-downs. A rope swing and cliff viewpoint!)
			</li>
			<li>
				<strong>Breadline Bluff Trail</strong> (3.0 out-and-back coastal trail “out the road”)
			</li>
			<li>
				<strong>Amalga Meadows Trail System</strong> (easy to moderate; out of Amalga Harbor,
				with the Horse Tram Trail near Eagle Valley Center following an early 1900s
				gold-mining horse tram route)
			</li>
			<li>
				<strong>Boy Scout Beach Trail</strong> (4.5 miles, fairly flat and takes you through
				meadows and forests out to a sandy beach with views of Lynn Canal and Chilkat
				Mounain Range; good for kids)
			</li>
			<li>
				<strong>Mount Roberts Trail</strong> on Basin Road (moderate, steep elevation gain;
				2.5 miles one way up Mount Roberts to the Tram; a good way to avoid paying tram fees
				but still enjoy the top terminal area; amazing aerial views; can ride the tram down
				if you make a $20 purchase at the gift shop or restaurant)
			</li>
			<li>
				<strong>Treadwell Mine Historic Trail</strong>, Douglas (easy 1-mile; guides through
				historic mining ruins with educational placards; great for kids and right near the
				Savikko Park beach and playground area)
			</li>
			<li>
				<strong>The Rainforest Trail</strong> to Shaman Island, Douglas (easy, but Shaman
				Island land bridge only uncovered during very low tides, so plan accordingly; great
				for tide pooling)
			</li>
		</ul>

		<ul>
			<li>
				<strong>Drive the roads</strong> (if you are renting a vehicle). Egan Drive from
				dowtown to “Out the Road” at Echo Cove is a 45-mile stretch that will take you
				through the town and into the Tongass National Forest. It is a beautiful drive and
				you’ll pass more than a dozen trailheads and viewing pull-offs along the way. Add in
				the Douglas Highway corridor too and you’ll have an easy way to get a sense of the
				City and Borough of Juneau.
			</li>
			<li>
				<strong>Jensen-Olson Arboretum</strong>—beautiful donation-based public garden with
				views of Favorite Channel. One of my favorite spots.
			</li>
			<li>
				<strong>National Shrine of St. Thérèse</strong>—a public stone-built chapel situated
				on a tidal island connected by a causeway. It’s got stunning views and is a
				peaceful spot with walking paths and is very welcoming to all persons.
			</li>
			<li>
				<strong>Skater’s Cabin</strong>—a stone recreation cabin with a great view of the
				Mendenhall Glacier that doesn’t require hiking at all.
			</li>
			<li>
				<strong>Beach Combing and Tide Pooling at public beaches—</strong>Juneau is filled
				with free, public access beaches, and they are wonderful for beach-combing and
				picnicking. Tide chart:
				<a
					href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9452210"
					target="_blank"
					rel="noopener noreferrer"
				>
					tidesandcurrents.noaa.gov
				</a>
				<ul>
					<li>Auke Recreation Area</li>
					<li>Lena Beach Recreation Area</li>
					<li>Eagle Beach State Recreation Area</li>
					<li>Amalga Harbor</li>
					<li>Outer Point (Douglas)</li>
				</ul>
			</li>
			<li>
				<strong>Rent a Kayak (or SUP) or Bike</strong>—Alaska Boat and Kayak Shop and Cycle
				Alaska are both great options for rentals.
			</li>
			<li>
				<strong>Go camping</strong>—if you’re aiming to spend all your time outdoors or are
				interested in some very cost-effective lodging options, Juneau has a number of
				campgrounds
				<ul>
					<li>
						<strong>Mendenhall Lake Campgroujd</strong> (full service, showers and
						restrooms, tent and RV)
					</li>
					<li>
						<strong>Auke Village Campground</strong> (potable water and restrooms)
					</li>
					<li>
						<strong>Eagle Beach State Recreation Area campsites</strong>
					</li>
					<li>
						<strong>Eagle River United Methodist Camp</strong>—has a number of cabins,
						some rustic and others with electricity and kitchens).
					</li>
				</ul>
			</li>
			<li>
				<strong>DIPAC Macaulay Salmon Hatchery</strong>—has a large visitor’s center with
				saltwater aquariums and touch tanks, and outdoor fish ladders for about $7 per
				person. Great option for kids.
			</li>
			<li>
				<strong>Project Playground at Twin Lakes</strong>—there are a number of great
				playgrounds in the Juneau area, but this one is community-built with volunteer labor
				and is probably the largest playground in Juneau.
			</li>
			<li>
				<strong>Museums and Cultural Centers</strong>—Juneau has a lot of history, from the
				original inhabitants of Southeast Alaska (the Tlingit, Haida, and Tsimshian peoples)
				to the colonizing history of Russia and later the US into the Gold Rush Period
				<ul>
					<li>
						<strong>Sealaska Heritage Institute</strong>—focus on Native peoples
					</li>
					<li>
						<strong>Alaska State Museum and Archives</strong>—great collections exploring
						the human and natural histories of Alaska ($14)
					</li>
					<li>
						<strong>Juneau-Douglas City Museum</strong>—on the National Register of
						Historic Places and focuses on specific Juneau/Southeast community history ($7)
					</li>
				</ul>
			</li>
			<li>
				<strong>Friends of the Library Amazing Bookstore</strong>—completely volunteer-run
				used bookstore that funds library programs, with the cheapest used book prices and
				some of the best selections I’ve ever found. It’s a hidden gem!
			</li>
			<li>
				<strong>Eat out!</strong> Juneau, maybe surprisingly, has some pretty good
				restaurants, cafes and breweries. Explore around and reach out for specific
				recommendations.
			</li>
		</ul>

		<section class="map">
			<h2>The map</h2>
			<p class="sub">The Travel Juneau map, to browse here or keep for the road.</p>
			<iframe
				class="map-frame"
				src="/juneau-map.pdf"
				title="Travel Juneau map (2019), a two-page PDF"
			></iframe>
			<div class="spread">
				<a class="btn ghost" href="/juneau-map.pdf" download="juneau-map.pdf">
					Download the map (PDF)
				</a>
			</div>
		</section>
	</article>
{/if}

<style>
	.guide {
		max-width: 46rem;
		margin: 0 auto;
	}

	.guide h1 {
		margin: 1.5rem 0 0.25rem;
	}

	.subtitle {
		margin: 0 0 1.75rem;
		font-style: italic;
		color: var(--muted);
	}

	.guide p {
		margin: 0 0 1rem;
	}

	.note {
		border-left: 3px solid var(--color-gold);
		background: color-mix(in srgb, var(--color-gold) 7%, transparent);
		border-radius: 0 8px 8px 0;
		padding: 0.6rem 1rem;
		color: var(--muted);
	}

	.guide h2 {
		margin: 2.25rem 0 0.5rem;
		font-size: 1.45rem;
		font-weight: 400;
	}

	.guide ul {
		margin: 0 0 1rem;
		padding-left: 1.4rem;
	}

	.guide li {
		margin: 0.35rem 0;
	}

	.guide ul ul {
		margin: 0.35rem 0 0;
	}

	.map {
		margin-top: 3rem;
	}

	.map-frame {
		display: block;
		width: 100%;
		height: 640px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
</style>
