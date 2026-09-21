# Reader exports reopened in Figma

Three exports from the occurrence-scoped reader, imported into Figma desktop and read back
through the Plugin API. `reader-reopen.json` records the observations.

**Synthetic overrides.** A `Card` component with a variable-bound icon, a label, and a nested
`Badge` instance; an instance of it carrying every override kind recorded through the Figma
API. Figma applies the root claims (name, size, padding, sizing mode) and the descendant claims
(name, opacity, text, font size, paint on a nested instance, text inside a nested instance),
and binds the overridden icon fill to `On Surface Variant` while the component keeps
`On Surface`. An instance whose component was deleted before export reopens as an instance
with no main component. Figma's own API refuses to resize that icon inside the instance, so a
`size` claim on it is not applied; that is Figma's rule, not an export gap.

Two findings came from this file and are fixed: the Figma API's `name` setter and `resize()`
did not record instance overrides, and an override inside a nested instance was addressed by
the enclosing component's copy of the child rather than the nested component's child, which
Figma's own clipboard encoding of the same edit names.

**gold-preview (edited).** The Input instance matches `packages/fig/tests/instance/gold-preview.test.ts`:
three Badge instances with distinct avatar swaps, the badge icon visibility, hidden leading and
trailing avatars, the trailing chevron, and placeholder typography. Figma recomputes the hug
width with its own text metrics (376.34 against 375.75 saved).

**material3 (edited).** Opens with all pages after every page was loaded and exported,
including the internal canvas that holds instances of deleted components. A List item swapped
to another variant by its List reopens as that variant; App bar leading icons resolve to the
icon each owner assigned; icon vectors keep their `On Surface Variant` alias. The Button set
keeps its 50 variants and axis properties.

Import was done by hand through Figma's Import dialog; inspection ran through `figma-use eval`.
No pixel comparison was made.
