# Product

## Register

product

## Users

David and Jen — a couple planning a trip to Japan together. N=2. They use Trippy at home, on phones and laptops, in shared planning sessions and solo "I just thought of a place" moments. Both are travelers, neither is a designer or developer of Trippy's frontend in a daily sense — they're its users first.

The job to be done: replace the usual mess of shared docs, Notion pages, browser tabs, and screenshotted Instagram posts with one calm, opinionated tool that holds the trip's worth of ideas, lets two people surface what they actually want, and turns approved ideas into a real day-by-day itinerary they can navigate on the ground.

## Product Purpose

Trippy is a collaborative trip planner for one specific Japan trip. It exists to make planning feel like part of the trip rather than admin: a place to collect ideas without anxiety, agree without negotiation overhead, and end up with a usable, mappable itinerary. Success looks like: David and Jen reach for Trippy in preference to a Google Doc, and on the ground in Japan they look at the day map instead of switching between five tabs.

Because it's a personal tool for two people, Trippy can be opinionated — choices that would alienate strangers (specific type, specific palette, specific workflow) are correct here.

## Brand Personality

Considered, calm, tactile.

Trippy should feel like a well-made physical object — a soft-cover travel journal, a Muji notebook, a Japanese stationery shop's house brand. Voice is quiet, declarative, never promotional. UI copy reads like labels in a museum, not like a product onboarding tour.

Reference lane: Are.na — restrained chrome, content-first, monospace-meets-serif typography, no decorative flourish that isn't earned.

## Anti-references

- **Generic "Japan" kitsch.** No cherry blossoms, no torii gates, no brush-script display fonts, no red-and-white Hinomaru palette. Japanese influence shows up through proportion, restraint, and type pairing — never through iconography.
- **Linear / Notion / Vercel productivity-tool minimalism.** Grey-on-white, Inter everywhere, monochrome icon set, soft shadows on white panels. The currently-saturated SaaS-minimal lane. Trippy is warmer and weirder than this.
- **Travel-OTA chrome.** Booking.com / Expedia / Kayak — stock photography, yellow CTAs, urgency banners, density without rhythm. Trippy is the opposite of this register.
- **Generic SaaS dashboards.** Tinted-grey panels, blue accent, hero-metric cards. The category-reflex output for "app with cards in it."

## Design Principles

1. **Tools feel like objects, not chrome.** The interface should feel like something held — paper, ink, weight, edge. Even on a phone screen, the goal is tactile, not "an app." This is what justifies the existing Warm theme's noise texture, paper tone, and ink color over generic neutrals.

2. **Restraint, not minimalism.** Are.na is restrained; Linear is minimal. Trippy lives on the Are.na side: confident, content-first, willing to use serif typography and unusual color, but never decorative for its own sake. If a flourish doesn't earn its place, remove it — but don't reflexively strip everything to grey.

3. **Japanese through proportion, not iconography.** Influence shows up in spacing, type relationships, and what's left out — not in motifs. If a design choice would survive in a tasteful Tokyo print shop, it passes; if it could be on a tea-towel souvenir, it fails.

4. **Two voices, one document.** Trippy is built for exactly two people who must both agree before an idea moves forward. The interface should make collaboration legible — whose voice is whose, what's still up for debate, what's settled — without making approvals feel like bureaucracy.

5. **The trip is the content; the app is the margin.** Photos of places, names of restaurants, hand-built day plans — these are the content. UI chrome (buttons, panels, controls) should recede so the content reads. When forced to choose between a louder interface and louder content, the content wins.

6. **Mobile is where Trippy earns its keep.** Planning happens at home on a desktop with a notebook beside the keyboard. Use happens on phones in Japan — checking the next stop in a noisy izakaya, looking at the day map walking out of a station, remembering a bar in bed at 11pm. Mobile is the primary surface for consumption; desktop is the surface for planning. Every decision is judged first on the phone. Don't propose desktop-only affordances (hover, Cmd+K, dense multi-column toolbars) without a mobile equivalent that's at least as good.

## Accessibility & Inclusion

Standard care, no specific WCAG target. As a personal N=2 tool, neither user has specific accessibility needs. Baseline expectations: legible contrast in all three themes, keyboard navigation works, focus states are visible, no motion that would be jarring on a phone. `prefers-reduced-motion` should be honored where motion is used. Beyond that, opinionated personal taste outweighs broad-audience compromise.
