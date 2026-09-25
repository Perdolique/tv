# Web application instructions

## Design references

- Inspect the relevant `designs/{theme}/{breakpoint}/{screen}.png` images and read `DESIGN.md` before UI work. Images are organized by `dark` or `light` theme, then by `mobile`, `tablet`, or `desktop` breakpoint.
- Available screen names are `home`, `sign-in`, `sign-up`, `dashboard`, `calendar`, `title-details`, and `add-title`.
- The PNG images are the visual source of truth. Follow their composition, spacing, controls, and responsive changes. Update `DESIGN.md` when a written visual rule conflicts with them.
- Keep accessibility and delivered product behavior. Omit controls for unsupported features instead of inventing replacements. Use semantic tokens and shared components to implement the image design.
