# TV design guide

This guide defines the shared visual language for current and future TV pages and components. It covers layout, typography, color, controls, and interaction states. The reference images are the visual source of truth, except for the confirmed design exceptions below.

## Required design references

Before UI work, read this guide and open the relevant images below in both themes and all three responsive variants. For a new page without its own mockup, choose the closest page layout and component patterns from the references. Use them to build a consistent composition.

When an image conflicts with this guide or existing UI, follow the image for visual decisions unless a confirmed design exception applies. Preserve accessibility and confirmed product behavior. Omit controls for features that are not implemented; a control in a mockup does not add a feature to the task.

| Page | Patterns | Mobile | Tablet | Desktop |
| --- | --- | --- | --- | --- |
| Home | Discovery hero, poster rails, and release rows | [Dark](designs/dark/mobile/home.png) · [Light](designs/light/mobile/home.png) | [Dark](designs/dark/tablet/home.png) · [Light](designs/light/tablet/home.png) | [Dark](designs/dark/desktop/home.png) · [Light](designs/light/desktop/home.png) |
| Sign in | Focused authentication form | [Dark](designs/dark/mobile/sign-in.png) · [Light](designs/light/mobile/sign-in.png) | [Dark](designs/dark/tablet/sign-in.png) · [Light](designs/light/tablet/sign-in.png) | [Dark](designs/dark/desktop/sign-in.png) · [Light](designs/light/desktop/sign-in.png) |
| Sign up | Account creation in the authentication shell | [Dark](designs/dark/mobile/sign-up.png) · [Light](designs/light/mobile/sign-up.png) | [Dark](designs/dark/tablet/sign-up.png) · [Light](designs/light/tablet/sign-up.png) | [Dark](designs/dark/desktop/sign-up.png) · [Light](designs/light/desktop/sign-up.png) |
| Dashboard | Personal summary, content rows, and a secondary rail | [Dark](designs/dark/mobile/dashboard.png) · [Light](designs/light/mobile/dashboard.png) | [Dark](designs/dark/tablet/dashboard.png) · [Light](designs/light/tablet/dashboard.png) | [Dark](designs/dark/desktop/dashboard.png) · [Light](designs/light/desktop/dashboard.png) |
| Calendar | Date selection, month grid, and release agenda | [Dark](designs/dark/mobile/calendar.png) · [Light](designs/light/mobile/calendar.png) | [Dark](designs/dark/tablet/calendar.png) · [Light](designs/light/tablet/calendar.png) | [Dark](designs/dark/desktop/calendar.png) · [Light](designs/light/desktop/calendar.png) |
| Title details | Artwork header, metadata, actions, and episode cards | [Dark](designs/dark/mobile/title-details.png) · [Light](designs/light/mobile/title-details.png) | [Dark](designs/dark/tablet/title-details.png) · [Light](designs/light/tablet/title-details.png) | [Dark](designs/dark/desktop/title-details.png) · [Light](designs/light/desktop/title-details.png) |
| Title timeline | Personal activity grouped by date, with expandable episode groups | Use title-details layout | Use title-details layout | [Dark and light](designs/title-timeline.png) |
| Add title | Search, match selection, form or review, and confirmation | [Dark](designs/dark/mobile/add-title.png) · [Light](designs/light/mobile/add-title.png) | [Dark](designs/dark/tablet/add-title.png) · [Light](designs/light/tablet/add-title.png) | [Dark](designs/dark/desktop/add-title.png) · [Light](designs/light/desktop/add-title.png) |

The files follow `designs/{dark|light}/{mobile|tablet|desktop}/{screen}.png`. Use the actual images to judge composition, spacing, hierarchy, and controls. Their file dimensions do not define CSS viewport sizes.

The title timeline is a component reference in `designs/title-timeline.png`, with dark on the left and light on the right. It contains only the approved desktop activity block. Use the title-details page references for the surrounding page and responsive placement; separate mobile and tablet timeline mockups have not been approved.

## Confirmed design exceptions

These user-confirmed decisions override only the stated parts of the reference images. Follow the images for all other design decisions.

- **Title details — default tab:** Open `Overview` by default, as confirmed by the user on 2026-10-04. The title-details images show `Episodes` selected in both themes and all three responsive variants. Keep `Episodes` available as a separate tab.

- **Title details — personal timeline:** The original desktop references show friends watched and friends' reviews in the right rail. Replace that activity area with the signed-in user's `Your timeline` for the current title, following [the approved grouped timeline](designs/title-timeline.png), selected by the user on 2026-10-06. Show events newest first, grouped by date; combine episodes watched on the same day into an expandable entry. Include recorded ratings and rating changes, episode and season completions, finishing all available episodes, and starting a rewatch. Preserve previous and new numeric ratings, such as `8 → 9`. Keep the rest of the title-details design as shown in its page references. Friend events remain undecided. This approval establishes the design reference; it does not mean the timeline has been implemented.

- **Title details — movie viewings:** The title-details references show a single watched action and no movie history block. For #89, show the viewing count beside `Mark as watched` or `Watched again`, and place a visible `Your viewings` section below `Overview`. Use inline forms for past viewings and date edits, and inline confirmation for deletion. Keep ratings independent. Confirmed by the user on 2026-10-06.
- **Dashboard — movie history:** Each movie viewing has its own row, recording time and direct link. Use `Movie viewings` for the metric. The reference images show a movie-based summary; repeat viewings are separate entries in #89. Confirmed by the user on 2026-10-06.

- **Title details — timeline disclosure and placement:** For #89, show the first six activity rows, then `Show full history`, cursor-based `Load more`, and inline episode groups with their own pagination. On desktop, place the timeline below ratings. On mobile and tablet, place it after the main content; for movies, after `Your viewings`. The timeline image shows only the desktop activity block. Confirmed in the approved #89 plan on 2026-10-08.
- **Title details — series viewings and released episode actions:** The original images have individual watched controls only. For #89, add selected-season and whole-series actions that explicitly include only released episodes with a known air date in the browser time zone. After the first viewing, show `Start rewatch` in the title actions. An active viewing closes through a dialog with pause, complete, and cancel choices; previous marks stay in history. Confirmed in the approved #89 plan on 2026-10-08.

## Visual language

- TV is a movie and series catalog and tracking product. Large artwork sets the mood; titles, dates, episode numbers, and actions stay easy to read.
- Use acid lime for primary actions, selected states, ratings, and progress. Keep most surfaces and text neutral. Violet is reserved for social information.
- Light and dark themes share layout, information order, controls, and behavior. Change semantic colors, borders, shadows, and artwork overlays with the theme.
- Dark surfaces use subtle borders and surface contrast. Light surfaces use restrained shadows. Avoid a strong border and a strong shadow on the same card.
- Use one primary action for each local decision. Secondary actions have less visual weight; destructive actions use danger colors.
- Use sentence case, short labels, and clear headings. Show status through text or shape as well as color.

### Typography and spacing

Use Inter with the existing system fallback. Keep the shared type hierarchy:

| Style | Mobile size / line height | Tablet and desktop | Weight |
| --- | --- | --- | --- |
| Display | 36 / 40px | 48 / 52px | 600 |
| Page heading | 28 / 32px | 36 / 42px | 600 |
| Section heading | 22 / 28px | 24 / 30px | 600 |
| Card heading | 18 / 24px | 20 / 26px | 600 |
| Body | 16 / 24px | 16 / 24px | 400 |
| Supporting text | 14 / 20px | 14 / 20px | 400 |
| Compact metadata | 12 / 16px | 12 / 16px | 500 |

Use the existing spacing, radius, and layout values in [tokens.css](app/assets/styles/tokens.css). Spacing follows a 4px base. Keep related items close and separate content groups with larger gaps. Use tabular numbers for dates, ratings, and progress. Preserve readable labels rather than shrinking text to fit.

## Responsive composition

| Mode | CSS width | Reference viewport | General layout |
| --- | --- | --- | --- |
| Mobile | Below 40rem | 390 × 844 | One main column, compact header, bottom navigation on application pages |
| Tablet | 40rem to below 64rem | 768 × 1024 | Compact navigation rail where shown, main content with optional secondary column |
| Desktop | 64rem and above | 1440 × 1024 | Labeled sidebar, main content, optional secondary rail |

- Follow each page image when its navigation or composition differs from the general layout.
- Mobile content has at least 16px side padding and respects safe areas. Poster collections can scroll horizontally instead of squeezing cards.
- Wider layouts add useful context. Keep text-heavy content at a readable width; a secondary rail is normally about 320px.
- Keep the main reading order when columns stack. Authentication and focused add-title pages use their own reference layouts.
- New search and review pages can reuse the add-title pattern: mode selection, one search field, clear match cards, and a separate review and confirmation area.
- Use media queries for the page shell and container queries for components that adapt to their available space.

## Components and states

Reuse [shared UI components](app/components/ui) and the nearest existing page patterns while matching the reference images.

- **Buttons and selection:** use stable labels, visible focus, and a clear selected state. Pair icon-only controls with an accessible name. Distinguish tabs, mode selectors, and navigation by their purpose.
- **Fields:** use visible labels and consistent heights. Editable fields use the strong border token without card shadows. Authentication labels move within the same control without shifting its geometry. Keep search actions in the position shown by the page image.
- **Read-only values:** show labeled text in the form or review layout. Avoid input borders and fixed field heights for values that cannot be edited.
- **Cards and rows:** use poster cards for discovery and match selection, and compact artwork rows for releases and activity. Keep nested actions independently usable. Make the full card a link only when it has one clear destination.
- **Status:** use text with a semantic color or icon. Green means success or added data, blue means updated data, amber means review or warning, and red means failure or danger.
- **Artwork:** use stable boxes: 2:3 for posters, 16:9 for backdrops and episode stills, and 1:1 for avatars. Preserve focal subjects, provide useful alternative text, and keep text readable over images.
- **Loading and errors:** keep layout stable with skeletons. Provide useful empty, error, unavailable, and retry states. Preserve visible content during later loading and recoverable failures. Roll back optimistic actions visibly if they fail.

Mockup artwork and logos are illustrative, not production assets to extract from the PNGs. Until approved authentication artwork is available, retain the existing plain mobile canvas, centered tablet form, and desktop form with a muted side panel. Keep unsupported authentication controls out of the form.

## Shared styles and themes

- Use semantic custom properties from [tokens.css](app/assets/styles/tokens.css). Keep raw theme colors in the token layer, so new components share the same visual system.
- Follow the layer order in [app.css](app/assets/styles/app.css): `reset, vendor, tokens, base, components, utilities`. Put Vue styles in the `components` layer. Declare the full order before rules in lazy-loaded styles, which may load before the global entry.
- Use native CSS for layout and themes. Use logical properties and shallow selectors.
- Support light, dark, and system preferences with `color-scheme` and `light-dark()`. Keep the preference in a cookie and apply it during SSR to avoid a theme flash. Artwork keeps its original colors.
- Keep transitions short and mainly use opacity or transforms. Respect reduced motion and preserve usable forced colors.

### Browser support

[.browserslistrc](.browserslistrc) is the source of truth for supported browser families and versions. Resolve its queries with the current Browserslist data instead of using a fixed Baseline year. The file selects up to two latest releases from the main browser families, released within the last year and with CSS Anchor Positioning support.

Use modern native features supported by these targets. Check the individual properties used by each feature. Position new or changed popovers with CSS Anchor Positioning. JavaScript handles their state, interaction and focus, not their geometry. Do not add compatibility or JavaScript positioning fallbacks for older versions or other browser families.

## Accessibility and verification

Meet WCAG 2.2 AA. Use semantic HTML, accessible labels, keyboard access, and visible focus. Keep normal text contrast at least 4.5:1 and large text and meaningful control boundaries at least 3:1. Prefer 44px touch targets. Do not use color alone to show state.

Compare changed screens with the selected images in both themes at the three reference viewports. Also check narrow widths, breakpoint edges, long text, missing artwork, keyboard focus, and 200% zoom. Authentication pages must remain usable at 1366 × 768 without vertical scrolling. Use semantic and geometry tests for important behavior; the generated mockups are not pixel screenshot baselines. Follow `AGENTS.md` for the applicable checks.

Keep this guide focused on shared design decisions and confirmed design exceptions. Revise the relevant rule or exception when the user confirms a new decision.
