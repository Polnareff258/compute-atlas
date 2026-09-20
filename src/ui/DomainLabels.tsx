'use client';

import { useEffect, useRef } from 'react';

import { DOMAIN_LABEL_ORDER, type DomainLabelEntry } from '../scene/domains/domainLabels';

/**
 * The label layer: five regions, as DOM nodes.
 *
 * ## Why this is a React component that React never re-renders
 *
 * The five labels exist as elements from the first render and are never added, removed or
 * reordered. What changes sixty times a second is a transform and a class, and both are
 * written straight onto the nodes through refs from outside React. That is the boundary the
 * brief draws — "every frame's animation should be a material uniform, a GPU buffer, a ref or
 * a simulation-state update; React is only responsible for low-frequency semantic state" —
 * and it matters here more than usual, because a label layer driven by state would re-render
 * the overlay tree on every camera frame.
 *
 * ## The class names are a contract, not a style
 *
 * `graph-node-label`, `graph-node-label__name` and the state modifiers are the names the
 * project's capture harnesses resolve their click targets from. They are kept deliberately
 * rather than renamed to something more accurate for this composition, because a harness that
 * cannot find an element refuses to guess and skips the capture — which is how the brief's
 * original defect was discovered in the first place.
 */

export type DomainLabelHandle = {
  update(entries: readonly DomainLabelEntry[]): void;
};

export type DomainLabelsProps = {
  /** Assigned on mount and cleared on unmount; the frame loop calls `update` through it. */
  readonly handleRef: { current: DomainLabelHandle | null };
};

export function DomainLabels({ handleRef }: DomainLabelsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    // Look the nodes up once. A per-frame `querySelector` per label would be five selector
    // matches sixty times a second for a set of elements that never changes.
    const nodes = new Map<string, HTMLDivElement>();
    for (const element of container.querySelectorAll<HTMLDivElement>('.graph-node-label')) {
      const id = element.dataset.domainId;
      if (id !== undefined) nodes.set(id, element);
    }
    nodeRefs.current = nodes;

    handleRef.current = {
      update(entries) {
        for (const entry of entries) {
          const node = nodes.get(entry.id);
          if (node === undefined) continue;

          if (!entry.visible) {
            // A hidden label is removed from the accessibility tree as well as the frame,
            // because a region behind the camera is not something a visitor can act on.
            node.style.opacity = '0';
            node.style.pointerEvents = 'none';
            node.setAttribute('aria-hidden', 'true');
            continue;
          }

          node.style.transform = `translate3d(${entry.x.toFixed(1)}px, ${entry.y.toFixed(1)}px, 0)`;
          node.style.opacity = entry.presence.toFixed(3);
          node.style.pointerEvents = 'auto';
          node.removeAttribute('aria-hidden');

          // `toggle` with a forced state rather than `add`/`remove`, so the two classes can
          // never both survive a frame in which the state changed.
          node.classList.toggle('is-hovered', entry.hovered);
          node.classList.toggle('is-focused', entry.focused);
        }
      },
    };

    return () => {
      handleRef.current = null;
      nodeRefs.current = new Map();
    };
  }, [handleRef]);

  return (
    <div className="domain-labels" ref={containerRef} aria-label="Compute regions">
      {DOMAIN_LABEL_ORDER.map((domain) => (
        <div
          className="graph-node-label"
          key={domain.id}
          data-domain-id={domain.id}
          // A `div` rather than a `button`: nothing here is clickable in the keyboard sense
          // yet — the focus path runs through the command bus — and a focusable control that
          // does nothing is worse for a screen reader than a label that says what it is.
          role="note"
          aria-label={`${domain.label} region`}
        >
          <span className="graph-node-label__name">{domain.label}</span>
        </div>
      ))}
    </div>
  );
}
