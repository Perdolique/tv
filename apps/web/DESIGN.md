# TV design specification

> Status: active design source of truth  
> Version: 1.1  
> Last updated: 2026-08-20

## Purpose

`DESIGN.md` is the project-level specification for the TV web application's
visual language, responsive behavior, interaction patterns, and accessibility
requirements.

The filename is a project convention, not a framework feature. Nuxt does not
load it at runtime. Humans and coding agents use it to make consistent design
decisions. Keep this file in the repository root and reference it from
`AGENTS.md` so that it is read before any UI work.

This specification consolidates the generated reference designs for:

- discovery home;
- login;
- sign-up;
- personal dashboard;
- personal release calendar;
- movie or series details;
- add-title or request-title flow;
- mobile, tablet, and desktop layouts;
- light and dark themes.

The generated images communicate visual intent. This document resolves any
accidental inconsistencies between them and is authoritative for implementation.

## How to use this document

### Before implementing UI

1. Identify the relevant page specification.
2. Apply semantic tokens rather than copying colors from a screenshot.
3. Use the component patterns defined here before creating a new variant.
4. Start with the mobile layout and progressively add tablet and desktop rules.
5. Verify both themes, keyboard behavior, focus states, and content overflow.

### Source-of-truth order

When sources disagree, use this order:

1. accessibility and functional requirements;
2. this `DESIGN.md` file;
3. implemented semantic tokens and shared components;
4. generated screen references;
5. one-off implementation details.

### Repository integration

Add the following instruction to the root `AGENTS.md`:

```markdown
## UI implementation

- Read `DESIGN.md` before changing UI, styling, themes, or responsive behavior.
- Treat its semantic tokens and component rules as the design source of truth.
```

Link this document from `README.md` when the first production UI is added.

## Product context

TV helps people discover movies and series, follow titles, rate what they watch,
see friends' activity, and track upcoming movies and episodes in a personal
calendar.

The interface should feel cinematic without resembling a playback application.
It is primarily a catalog and tracking product. Information clarity, release
awareness, and personal context are more important than decorative artwork.

## Design principles

### Content first

Artwork attracts attention, but titles, dates, episode numbers, progress, and
actions must remain immediately understandable.

### Progressive density

Mobile shows the next useful action. Tablet introduces parallel context.
Desktop uses sidebars and secondary rails to expose more information without
making the primary column harder to scan.

### One strong accent

Acid lime communicates selection, progress, rating, and primary action. It is
not general decoration and must not become the default body-text color.

### Social, not noisy

Violet is reserved for friends, community counts, and recency. Social content
supports catalog decisions; it does not compete with title and release data.

### Theme parity

Light and dark themes have identical information architecture and interaction
states. Theme changes affect semantic colors, borders, elevation, and local
image overlays only.

### Accessible by default

Color is never the sole status indicator. Interactive controls are keyboard
reachable, visibly focused, large enough to target, and labeled for assistive
technology.

## Information architecture

The following paths are design recommendations, not an API contract:

| Area | Suggested path | Primary purpose |
| --- | --- | --- |
| Discovery home | `/` | Featured, trending, upcoming, and social discovery |
| Login | `/login` | Authenticate an existing account |
| Sign-up | `/signup` | Create an account |
| Dashboard | `/dashboard` | Personal progress and next actions |
| Calendar | `/calendar` | Upcoming followed releases |
| Title details | `/titles/:slug` | Metadata, following, rating, episodes, reviews |
| Add or request | `/titles/add` | Search first, then submit a missing title |

Authenticated primary navigation contains:

- Home;
- Discover;
- Calendar;
- Community;
- Watchlist;
- profile and settings;
- Add title as a contextual or lower-priority action.

## Responsive model

Breakpoints describe layout capability, not specific devices. Prefer container
queries for self-contained components and media queries for the application
shell.

| Mode | CSS condition | Reference viewport | Navigation |
| --- | --- | ---: | --- |
| Mobile | `(width < 40rem)` | `390 x 844` | Compact top bar and persistent bottom navigation |
| Tablet | `(40rem <= width < 64rem)` | `768 x 1024` | Top bar or `80px` icon rail |
| Desktop | `(width >= 64rem)` | `1440 x 1024` | `224px` labeled sidebar and optional right rail |

### Mobile rules

- Use a single primary content column.
- Preserve at least `16px` horizontal page padding; use `20-24px` when space
  allows.
- Keep the bottom navigation fixed and account for safe-area insets.
- Use horizontal scrolling for poster collections instead of shrinking cards.
- Default the calendar to agenda view.
- Auth and focused add/request flows do not show application bottom navigation.

### Tablet rules

- Use a compact `80px` navigation rail for authenticated application pages.
- Use a two-column content layout when the secondary column remains at least
  `240px` wide.
- Use a top navigation bar on public and authentication pages.
- Calendar combines a month grid with an agenda below or beside it.

### Desktop rules

- Use a `224px` application sidebar.
- Keep the main content readable; do not stretch text-heavy cards indefinitely.
- A secondary rail is normally `280-340px` wide.
- Keep high-priority content inside the first `1024px` of viewport height when
  practical.
- Use six poster cards in a standard trending row at the `1440px` reference
  width.

### Layout tokens

| Token | Value | Use |
| --- | ---: | --- |
| `--layout-page-mobile` | `16px` | Minimum mobile page gutter |
| `--layout-page-compact` | `24px` | Spacious mobile and tablet gutter |
| `--layout-page-wide` | `32px` | Desktop content gutter |
| `--layout-sidebar-compact` | `80px` | Tablet navigation rail |
| `--layout-sidebar-wide` | `224px` | Desktop navigation sidebar |
| `--layout-rail` | `320px` | Default desktop secondary rail |
| `--layout-content-max` | `1440px` | Maximum designed application canvas |

## Design tokens

Design tokens name decisions independently of theme or implementation. Code
must consume semantic tokens. Raw palette values are allowed only in the token
layer.

### Brand palette

| Token | Value | Role |
| --- | --- | --- |
| `--brand-lime-300` | `#D7FF55` | Filled primary actions and strong selection |
| `--brand-lime-500` | `#B8E600` | Progress fill and non-text highlight paired with a label |
| `--brand-lime-700` | `#667F00` | Accessible active icons and text on light surfaces |
| `--brand-violet-400` | `#9A72E8` | Dark-theme social metadata |
| `--brand-violet-500` | `#7755C6` | Light-theme social metadata |
| `--status-warning` | `#E8A317` | Review or moderation state |
| `--status-danger` | `#D94C4C` | Destructive and validation error state |

### Semantic color tokens

Each semantic token contains its light and dark values in one definition.
The first value is always light and the second is always dark, matching the
argument order of CSS `light-dark()`.

| Token | Light value | Dark value | Role |
| --- | --- | --- | --- |
| `--color-canvas` | `#F7F7F4` | `#0B0D12` | Application canvas |
| `--color-surface` | `#FFFFFF` | `#151922` | Standard cards and controls |
| `--color-surface-raised` | `#FFFFFF` | `#1A202B` | Floating and elevated surfaces |
| `--color-surface-muted` | `#EFF1EC` | `#222833` | Quiet grouped content |
| `--color-text-primary` | `#15171A` | `#F7F8F4` | Primary copy and headings |
| `--color-text-secondary` | `#62676E` | `#A8ADB6` | Supporting copy and metadata |
| `--color-text-tertiary` | `#858B92` | `#747B86` | Disabled and low-priority copy |
| `--color-border` | `#D8DCD3` | `#303744` | Standard separators and outlines |
| `--color-border-strong` | `#B8BEB4` | `#49515E` | Emphasized boundaries |
| `--color-icon` | `#646A70` | `#B7BDC6` | Default icon color |
| `--color-overlay` | `rgb(8 12 16 / 58%)` | `rgb(4 8 12 / 72%)` | Artwork text overlay |
| `--color-accent` | `#667F00` | `#D7FF55` | Accent text, icon, and outline |
| `--color-accent-fill` | `#D7FF55` | `#D7FF55` | Primary filled controls |
| `--color-on-accent` | `#15171A` | `#0B0D12` | Content on an accent fill |
| `--color-social` | `#7755C6` | `#9A72E8` | Social metadata and activity |
| `--color-focus` | `#667F00` | `#D7FF55` | Keyboard focus indicator |

### Theme behavior

- Support `light`, `dark`, and `system` preferences.
- Let CSS select system light or dark colors through `color-scheme` and
  `light-dark()`; do not duplicate token blocks in a media query.
- Persist an explicit preference in a cookie so SSR can render the correct
  scheme before hydration. `localStorage` alone is insufficient because it can
  produce a theme flash and cannot inform the server render.
- For `system`, expose both supported schemes with `color-scheme: light dark`.
- For an explicit choice, constrain the root used scheme to `light` or `dark`.
- Native controls, scrollbars, form fields, and system colors must inherit the
  same used color scheme.
- Do not theme-shift poster, backdrop, or avatar artwork.
- Recalculate gradients over hero images per theme to preserve text contrast.

The token layer is the theme implementation:

```css
@layer tokens {
  :root {
    color-scheme: light dark;
    accent-color: var(--color-accent);

    --color-canvas: light-dark(#f7f7f4, #0b0d12);
    --color-surface: light-dark(#ffffff, #151922);
    --color-surface-raised: light-dark(#ffffff, #1a202b);
    --color-surface-muted: light-dark(#eff1ec, #222833);
    --color-text-primary: light-dark(#15171a, #f7f8f4);
    --color-text-secondary: light-dark(#62676e, #a8adb6);
    --color-text-tertiary: light-dark(#858b92, #747b86);
    --color-border: light-dark(#d8dcd3, #303744);
    --color-border-strong: light-dark(#b8beb4, #49515e);
    --color-icon: light-dark(#646a70, #b7bdc6);
    --color-overlay: light-dark(
      rgb(8 12 16 / 58%),
      rgb(4 8 12 / 72%)
    );
    --color-accent: light-dark(#667f00, #d7ff55);
    --color-accent-fill: #d7ff55;
    --color-on-accent: light-dark(#15171a, #0b0d12);
    --color-social: light-dark(#7755c6, #9a72e8);
    --color-focus: light-dark(#667f00, #d7ff55);
  }
}
```

No theme selector is required for system mode. A manual preference still needs
one piece of application state because CSS cannot persist a product setting.
Constrain the native root property directly; never redeclare tokens from
JavaScript or under a second selector:

```ts
type ColorSchemePreference = 'system' | 'light' | 'dark'

function applyColorScheme(preference: ColorSchemePreference) {
  if (preference === 'system') {
    document.documentElement.style.removeProperty('color-scheme')
    return
  }

  document.documentElement.style.colorScheme = preference
}
```

For `system`, the root falls back to the layered `color-scheme: light dark`
declaration. For `light` or `dark`, SSR emits the matching root property from
the preference cookie before first paint. The client-side control only updates
that property and cookie.

Add `<meta name="color-scheme" content="light dark">` to the document head so
the browser can paint its initial canvas and controls consistently before the
stylesheet finishes loading.

## CSS architecture

Use native CSS as the styling runtime. Do not add a theme library, CSS-in-JS,
runtime viewport service, or JavaScript-generated token map for behavior that
the platform already provides.

### Cascade layers

Declare the complete layer order once in the global stylesheet before any
layered imports:

```css
@layer reset, vendor, tokens, base, components, utilities;

@import url('./reset.css') layer(reset);
@import url('./tokens.css') layer(tokens);
@import url('./base.css') layer(base);
@import url('./utilities.css') layer(utilities);
```

- `reset` normalizes browser defaults without styling product components.
- `vendor` contains third-party CSS and stays below product rules.
- `tokens` defines custom properties and scheme constraints.
- `base` styles elements, typography, page canvas, and focus defaults.
- `components` contains reusable and page-specific component rules.
- `utilities` contains a small, deliberate set of single-purpose overrides.

All application CSS belongs to a named layer. Unlayered normal declarations
override every layered normal declaration and would silently break this order.
Do not use `!important` to compensate for an unclear cascade.

Vue single-file component styles belong to the component layer:

```vue
<style scoped>
@layer components {
  .title-card-shell {
    container: title-card / inline-size;
  }

  .title-card {
    display: grid;
    gap: var(--space-4);
  }

  @container title-card (inline-size >= 32rem) {
    .title-card {
      grid-template-columns: 10rem 1fr;
    }
  }
}
</style>
```

### Modern CSS rules

- Treat Baseline 2024 as the minimum CSS capability set unless the repository
  browser policy defines a newer floor.
- Do not add legacy selector hacks, duplicated fallback layouts, handwritten
  vendor prefixes, or polyfills for browsers outside that policy.
- Use media queries for application-shell changes and user preferences.
- Use size container queries for reusable cards, lists, and content panels.
- Prefer range syntax such as `(width >= 64rem)` and logical dimensions such
  as `inline-size`.
- Use native nesting when it improves locality, but keep selectors shallow.
- Use `:where()` for zero-specificity foundations and `:is()` to group related
  selectors.
- Use `:has()` when the state is already represented semantically in the DOM;
  do not mirror that state into JavaScript only for styling.
- Use `clamp()` for bounded fluid values, not to erase meaningful layout
  breakpoints.
- Use dynamic and small viewport units instead of assuming `100vh` represents
  the visible mobile viewport.
- Use `subgrid` when repeated content must share parent tracks.
- Use `color-mix(in oklch, ...)` for derived hover or pressed colors only when
  the result is named by a semantic token and its contrast is verified.
- Use `@supports` for optional enhancements, not for fallbacks outside the
  supported browser policy.
- Prefer progressive enhancement and semantic HTML over JavaScript emulation.

## Typography

Use one variable sans-serif family throughout the product.

```css
--font-sans: 'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif;
```

If Inter is not bundled, use the system stack until font loading is implemented.
Do not mix Inter and Manrope across screens.

| Style | Mobile | Tablet and desktop | Weight | Use |
| --- | --- | --- | ---: | --- |
| Display | `36/40px` | `48/52px` | `600` | Hero title only |
| Heading 1 | `28/32px` | `36/42px` | `600` | Page title |
| Heading 2 | `22/28px` | `24/30px` | `600` | Major section |
| Heading 3 | `18/24px` | `20/26px` | `600` | Card group |
| Body | `16/24px` | `16/24px` | `400` | Default copy |
| Body strong | `16/24px` | `16/24px` | `600` | Title and action label |
| Small | `14/20px` | `14/20px` | `400` | Metadata |
| Caption | `12/16px` | `12/16px` | `500` | Date, count, compact badge |

Rules:

- Use sentence case for navigation, headings, labels, and buttons.
- Avoid body text smaller than `14px`; `12px` is reserved for compact metadata.
- Use tabular numbers for calendars, times, ratings, and progress statistics.
- Truncate card titles after two lines and compact metadata after one line.
- Do not use uppercase for long labels. Short weekday and month labels may use
  uppercase.

## Spacing, shape, elevation, and motion

### Spacing scale

Use a `4px` base unit.

| Token | Value |
| --- | ---: |
| `--space-0` | `0` |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-16` | `64px` |

### Radius scale

| Token | Value | Use |
| --- | ---: | --- |
| `--radius-sm` | `10px` | Chips, compact controls |
| `--radius-md` | `14px` | Inputs and release rows |
| `--radius-lg` | `18px` | Standard cards |
| `--radius-xl` | `24px` | Hero and auth containers |
| `--radius-round` | `999px` | Pills and avatars |

### Elevation

Dark theme relies primarily on surface contrast and borders. Light theme adds
restrained neutral shadows.

```css
--shadow-card: 0 8px 24px light-dark(
  rgb(20 24 28 / 8%),
  rgb(0 0 0 / 22%)
);
--shadow-float: 0 16px 40px light-dark(
  rgb(20 24 28 / 12%),
  rgb(0 0 0 / 28%)
);
```

Do not combine a strong border and a strong shadow on the same component.

### Motion

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | `120ms` | Hover and press feedback |
| `--duration-normal` | `200ms` | Tabs, menus, compact transitions |
| `--duration-slow` | `320ms` | Modal and page-level transitions |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default easing |

- Animate opacity and transform where possible.
- Do not animate large backdrops or poster grids on initial load.
- Disable non-essential movement for `prefers-reduced-motion: reduce`.

## Imagery

| Asset | Ratio | Typical use |
| --- | ---: | --- |
| Poster | `2:3` | Catalog card, title summary, search result |
| Backdrop | `16:9` | Hero and title detail header |
| Episode still | `16:9` | Progress and episode rows |
| Avatar | `1:1` | Profile and social activity |

Rules:

- Use `object-fit: cover` and stable aspect-ratio boxes to prevent layout shift.
- Preserve focal subjects when cropping. Apply server-provided focal points when
  available.
- Poster and still cards need a neutral placeholder and skeleton state.
- Backdrop overlays are functional contrast layers, not decorative filters.
- Avoid placing important text over high-detail image areas.
- Provide meaningful alternative text for content images. Decorative backdrops
  use empty alternative text.
- External logos in the generated references are placeholders, not approved
  production assets.

## Core components

### Application shell

The shell owns the theme control and persisted preference. CSS owns theme
resolution. The shell also owns global navigation, search, notifications,
profile access, safe-area handling, and content gutters.

- Mobile authenticated pages use a compact top bar and four-item bottom bar.
- Tablet application pages use the compact navigation rail.
- Desktop application pages use the labeled sidebar.
- Auth pages use only the TV wordmark and Back action.
- Focused add/request flow may hide mobile global navigation.

### Buttons

Variants:

- `primary`: acid-lime fill, near-black text;
- `secondary`: surface fill with strong border;
- `ghost`: transparent background for low-priority actions;
- `destructive`: danger color, never lime;
- `icon`: square or circular control with an accessible label.

Sizes:

| Size | Height | Horizontal padding | Icon |
| --- | ---: | ---: | ---: |
| Small | `36px` | `12px` | `18px` |
| Medium | `44px` | `16px` | `20px` |
| Large | `52px` | `20px` | `24px` |

Use one primary action per local decision area. Disabled buttons reduce emphasis
but must remain readable.

### Inputs

- Default height is `52px`; compact desktop filters may use `40px`.
- Labels remain visible outside the field when a value exists.
- Placeholder text is never the only accessible label.
- Error state includes message, icon, and danger border; not color alone.
- Search uses a leading search icon and a clear action when populated.
- Text areas expose character limits only when limits matter.

### Segmented controls, tabs, and chips

- Segmented controls choose one mode inside a stable context.
- Tabs change content within a page without changing the page identity.
- Filter chips may be multi-select.
- Active state uses fill or underline plus weight change, never color alone.
- Pills must not be used for ordinary navigation labels.

### Cards

Standard card families:

- poster card: artwork, title, score, optional state;
- progress card: landscape still, title, episode, progress, play action;
- release row: time or date, artwork, episode metadata, reminder action;
- activity card: avatar stack, person, action, title, relative time;
- metric card: icon, value, short label;
- review card: avatar, name, rating, timestamp, excerpt, reactions;
- match card: external title result, catalog status, Use this action;
- upload card: drop zone, preview, file requirements, processing state.

Cards are clickable only when the full card has one unambiguous destination.
Nested actions must stop propagation and remain independently focusable.

### Ratings

- Display aggregate ratings to one decimal place.
- The star icon is always paired with a number or accessible label.
- User rating is visually separate from aggregate rating.
- Rating distributions expose text equivalents, not visual bars alone.
- Unrated state uses an em dash and a clear Rate action.

### Avatar stacks

- Show up to three avatars, then a `+N` overflow badge.
- Preserve a visible border between overlapping avatars.
- The text next to the stack explains the represented group.

### Progress

- Show progress with a bar or radial indicator plus a numeric or semantic label.
- Lime indicates completed or active progress, not buffered media playback.
- A watched episode uses a check state; partial progress uses a percentage.

## Page specifications

### Discovery home

Content priority:

1. featured title and primary action;
2. trending titles;
3. releases coming this week;
4. friends' activity;
5. top-rated titles.

Mobile:

- full-width hero;
- horizontal poster scroller showing approximately `2.5` cards;
- stacked upcoming-release rows;
- persistent bottom navigation.

Tablet:

- top navigation;
- wide hero;
- main catalog column and narrower social column.

Desktop:

- labeled sidebar;
- hero in the primary column;
- six-card trending row;
- fixed-width social and top-rated rail.

### Login

- Ask for email and password.
- Include password visibility, remember-me, password recovery, primary sign-in,
  provider sign-in, and sign-up link.
- Keep Back and TV wordmark available.
- Do not show authenticated application navigation.
- On tablet and desktop, pair the form with cinematic artwork without placing
  fields over the artwork.

### Sign-up

- Ask for display name, email, password, confirmation, and terms consent.
- Show password strength with bars and text.
- Use a two-column field grid only when each field remains at least `260px` wide.
- Keep the primary action visible without shrinking fields or labels.
- Do not preselect legal consent.

### Personal dashboard

Content priority:

1. weekly summary;
2. continue watching;
3. next upcoming release;
4. friends' activity;
5. ratings summary and watchlist progress;
6. remainder of the week.

Mobile uses stacked sections. Tablet uses a primary column and social rail.
Desktop uses a sidebar, wide main column, and `320px` secondary rail.

### Personal calendar

- Mobile defaults to Agenda and exposes Month as an alternate mode.
- Tablet and desktop default to a readable month grid plus selected-day agenda.
- The selected day uses lime fill or border and remains distinguishable without
  color.
- Event cells contain a thumbnail or short title when space permits.
- Episode, movie, and premiere types use icon or shape differences in addition
  to color.
- Reminder actions expose scheduled, unscheduled, loading, and error states.
- Use the viewer's timezone for release times and state it when the source time
  is ambiguous.

### Movie or series details

Header contains:

- backdrop and poster;
- title, year, type-specific metadata, maturity rating, and genres;
- aggregate score;
- Rate and Follow or Following actions;
- personal rating and friends-watched context.

Series details expose Overview, Episodes, and Reviews tabs. Episode rows contain
episode number, still, title, date, runtime, and watched or progress state.

Movie details reuse the same header but replace episode content with release,
credits, availability, and related-title information.

### Add or request title

This flow must remain valid whether titles are added directly or moderated.

Required sequence:

1. Search the existing catalog and supported external sources.
2. Review a matched title and metadata.
3. Submit a request or direct add according to the user's permission.

Rules:

- Search is required before manual creation.
- Movie, Series, and Request are explicit modes.
- Show catalog status such as Not in catalog or Already exists.
- External matches use a dedicated Use this action.
- The final action label reflects behavior: Add title, Submit request, or Send
  for review.
- Show source-matching and moderation status on tablet and desktop.
- Save draft is secondary.
- Notify me when published is optional and enabled only with an account.

## Content rules

### Examples

| Data | Display format |
| --- | --- |
| Aggregate score | `8.7` |
| Season and episode | `S2 · E7` |
| Runtime | `54m` or `1h 2m` |
| Absolute date | Localized with `Intl.DateTimeFormat` |
| Scheduled time | Localized viewer time, for example `21:00` |
| Relative social time | `2h ago`, localized |
| Large counts | `12.4K`, localized |

Use real ellipsis characters only when text is intentionally truncated. Do not
encode uncertain information as fake precision.

### Empty states

Empty states explain what happened and offer the next useful action.

- No upcoming releases: link to Discover or Watchlist.
- Empty watchlist: recommend adding a title.
- No friends: link to community discovery without blocking catalog features.
- No search match: offer the request flow.
- No reviews: invite a rating or review after the title is watched.

## Accessibility

Target WCAG 2.2 AA.

- Normal text contrast is at least `4.5:1`.
- Large text contrast is at least `3:1`.
- Interactive component boundaries and meaningful graphics target at least
  `3:1` against adjacent colors.
- Prefer `44 x 44px` application targets. Never fall below the WCAG minimum
  target of `24 x 24` CSS pixels without a valid spacing exception.
- Every interactive element has a visible `2px` focus indicator with `2px`
  offset.
- Keyboard order follows visual reading order.
- Use native buttons, links, inputs, headings, lists, and tables before ARIA.
- Bottom navigation marks the current page with `aria-current="page"`.
- Tabs follow the ARIA tab pattern and support arrow-key navigation.
- Dialogs trap focus, close on Escape, and restore focus to the trigger.
- Charts and rating distributions include text equivalents.
- Do not rely on lime, violet, or amber alone to communicate state.
- Respect `prefers-reduced-motion` and `prefers-contrast` where supported.
- Preserve usable system colors in forced-colors mode. Use
  `forced-color-adjust: none` only for content whose meaning would otherwise be
  lost.

## Implementation guidance for Nuxt and Vue

Suggested structure:

```text
apps/web/app/
├── assets/styles/
│   ├── app.css
│   ├── reset.css
│   ├── tokens.css
│   ├── base.css
│   └── utilities.css
├── components/
│   ├── app/
│   ├── catalog/
│   ├── calendar/
│   ├── social/
│   └── ui/
├── composables/
│   └── useColorScheme.ts
├── layouts/
│   ├── app.vue
│   └── auth.vue
└── pages/
```

Rules:

- Define primitive and semantic tokens in CSS custom properties.
- Do not place raw theme colors inside Vue component styles.
- Load one global CSS entry point that establishes cascade-layer order.
- Place every Vue component style block in the `components` layer.
- Prefer CSS grid, flexbox, and container queries over JavaScript viewport
  branching.
- Render semantically useful SSR markup before client enhancement.
- Read the color-scheme cookie during SSR and render the root scheme constraint
  before first paint. Do not wait for Vue hydration to correct the theme.
- Use logical CSS properties for padding, margin, and positioning.
- Isolate component layout with container queries where it reduces shell
  coupling.
- Keep viewport breakpoints in the application shell; components respond to
  their available inline size.
- Keep selectors shallow and let layer order solve cascade priority.
- Create components from repeated behavior, not merely repeated rectangles.
- Keep page orchestration separate from reusable UI primitives.

## State requirements

Every data-driven component must define:

- loading;
- loaded;
- empty;
- recoverable error;
- unavailable or permission-limited;
- stale data when relevant.

Use skeletons that preserve final geometry. Avoid spinners that replace large
content areas. Optimistic Follow, Watch, Rate, and Reminder actions must roll
back visibly after failure.

## Verification

### Required viewports

Verify at minimum:

- `390 x 844` in light and dark themes;
- `768 x 1024` in light and dark themes;
- `1440 x 1024` in light and dark themes;
- one narrow viewport near `320px`;
- one width immediately before and after each breakpoint.

### Required interaction checks

- keyboard-only navigation;
- visible focus in both themes;
- theme persistence and system fallback;
- long title and translated-copy overflow;
- missing and slow-loading artwork;
- zero, one, and many calendar events;
- rating, follow, watched, and reminder state changes;
- reduced motion;
- 200% browser zoom without horizontal page scrolling.

### Automated checks

- Add focused Vitest tests for state and token logic.
- Add Playwright coverage for page-critical flows and theme switching.
- Capture visual snapshots at the three reference viewports for both themes.
- Do not use generated references as pixel-perfect golden images. They contain
  illustrative artwork and may contain non-deterministic visual details.

Follow repository verification instructions for changed Vue or TypeScript files.
For changes to this file, run:

```shell
vp run lint:markdown
```

## Reference design matrix

The generated reference set contains one dark and one light image for each cell.

| Page | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Discovery home | Hero, poster rail, release rows | Hero plus social column | Sidebar, six posters, social rail |
| Login | Stacked form | Image header plus form card | Split artwork and form |
| Sign-up | Stacked form | Two-column form card | Split artwork and form |
| Dashboard | Stacked personal feed | Compact rail and two columns | Sidebar, main column, social rail |
| Calendar | Agenda-first | Month plus daily agenda | Month grid plus agenda rail |
| Title details | Hero and episode list | Episode grid and reviews | Episode grid plus social rail |
| Add or request | Focused stacked flow | Rail, form, preview | Sidebar, form, workflow panel |

## Change process

When changing a visual rule:

1. Explain the user or product problem.
2. Update the semantic token or shared component when the change is systemic.
3. Check both themes and all responsive modes.
4. Update this document when the rule or intent changes.
5. Update affected tests and visual snapshots.

Do not add a new component variant to solve a single screenshot discrepancy.
Do not change dark and light theme structures independently.

## External references

This specification follows these public references:

- [Design Tokens Community Group glossary][dtcg-glossary] for tokens as named,
  distributable design decisions and for theme and size contexts.
- [DTCG token type specification][dtcg-types] for typed color, dimension,
  typography, duration, and related values.
- [MDN `light-dark()`][mdn-light-dark] for scheme-aware token values.
- [MDN `color-scheme`][mdn-color-scheme] for native scheme selection and
  browser-provided UI.
- [MDN cascade layers][mdn-layers] for explicit author-style priority.
- [MDN container queries][mdn-containers] for component-owned responsive
  behavior.
- [MDN Baseline][mdn-baseline] for the browser-capability policy.
- [WCAG 2.2 minimum contrast][wcag-contrast] for text contrast requirements.
- [WCAG 2.2 target size][wcag-target] for minimum pointer-target sizing.
- [MDN media queries][mdn-media] for capability- and viewport-based styles.

[dtcg-glossary]: https://www.designtokens.org/glossary/
[dtcg-types]: https://www.designtokens.org/tr/2025.10/format/#types
[mdn-light-dark]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark
[mdn-color-scheme]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme
[mdn-layers]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer
[mdn-containers]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries
[mdn-baseline]: https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility
[wcag-contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[wcag-target]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[mdn-media]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using
