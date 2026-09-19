/**
 * The routing layer's group layout, which is the one part of the route
 * vocabulary the Core and the Graph both have to agree on.
 *
 * The field packs its weights into a fixed number of per-group slots, so the
 * slot a curve is written to is not a label — it is an index into a uniform, and
 * two producers that disagree about it are two producers whose curves dim each
 * other. That makes the layout a contract rather than a constant, and it lives
 * here rather than in `graphRoutes` so the hero can write its own circulation
 * without importing the Graph node ids, the manifest or the domain vocabulary —
 * a dependency that existed only to share three integers.
 *
 * The ranges are deliberately disjoint and are asserted as such, because the
 * failure they guard is silent: an overlapping group does not throw, it makes a
 * domain's branch flicker whenever the Core happens to be busy.
 */

/** Group 0 is always the Core's own circulation. */
export const CORE_ROUTE_GROUP = 0;

/** Domains occupy groups 1..5 so one branch can lift while others recede. */
export const DOMAIN_ROUTE_GROUP_BASE = 1;

/** The number of semantic domains the layout reserves groups for. */
export const DOMAIN_ROUTE_GROUP_COUNT = 5;

/** Trunks take the last two slots, so they fit the two packed vec4 uniforms. */
export const TRUNK_ROUTE_GROUP_BASE = 6;

/** How many trunk groups the layout reserves. */
export const TRUNK_ROUTE_GROUP_COUNT = 2;

/**
 * Total group slots the field can address.
 *
 * Every group above has to be strictly below this, and the field asserts against
 * it when it packs. A layout that grew past it would not fail to draw — the pack
 * clamps — it would draw two producers' curves into one slot and dim both.
 */
export const MAX_ROUTE_GROUPS = 8;

/** Every group index this layout assigns, in order. */
export const ROUTE_GROUPS: readonly number[] = [
  CORE_ROUTE_GROUP,
  ...Array.from(
    { length: DOMAIN_ROUTE_GROUP_COUNT },
    (_, index) => DOMAIN_ROUTE_GROUP_BASE + index,
  ),
  ...Array.from(
    { length: TRUNK_ROUTE_GROUP_COUNT },
    (_, index) => TRUNK_ROUTE_GROUP_BASE + index,
  ),
];
