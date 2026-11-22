<!-- Background tree silhouettes (knowledge/design/trees.md).

     Three slices of one linocut sheet (~/Downloads/trees.svg). Each file in
     /trees/ holds one full tree in the sheet's original coordinates with no
     fill — the color is the `fill` below, driven by the theme. The crop
     lives in each <svg>'s viewBox (sheet coordinates):

     - the left front tree shows the tree's RIGHT 60%, the left back
       tree its RIGHT 50%, the right tree its LEFT 48% — so the
       straight cut edge sits on the screen edge, never in the middle
       of the screen;
     - every slice stops at 75% of the tree's height, so the trunk base is
       never in the image: no matter how the trees are resized, the bottom
       of each tree stays off-screen.

     Move / resize / re-slice: edit the viewBoxes and the CSS below.
-->
<div class="trees" aria-hidden="true">
	<svg class="tree tree--left-front" viewBox="295 1771 249 1122.75">
		<use href="/trees/tree-left-front.svg#tree" />
	</svg>
	<svg class="tree tree--left-back" viewBox="4810 281 416 1054.5">
		<use href="/trees/tree-left-back.svg#tree" />
	</svg>
	<svg class="tree tree--right" viewBox="1132 1773 328.8 1121.25">
		<use href="/trees/tree-right.svg#tree" />
	</svg>
</div>

<style>
	.trees {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
	}
	.tree {
		position: absolute;
		bottom: 0;
	}
	.tree--left-back {
		left: 0;
		height: 62vh;
		fill: var(--tree-left-back);
		z-index: -2;
	}
	.tree--left-front {
		left: 0;
		height: 90vh;
		fill: var(--tree-left-front);
	}
	.tree--right {
		right: 0;
		height: 72vh;
		fill: var(--tree-right);
	}
</style>
