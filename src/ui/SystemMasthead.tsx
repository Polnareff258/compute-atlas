'use client';

/**
 * The masthead: a signature, not a dashboard.
 *
 * **What it used to be, and why that was wrong.** `POLNAREFF SYSTEM` /
 * `LOCAL COMPUTING ENVIRONMENT` / `PHASE 01` / `DESKTOP / GPU` — four all-caps
 * strings at 0.66 to 0.84rem with letter-spacing on every one. The brief names
 * that construction directly: stop using all-caps with wide tracking as micro
 * HUD labels. It is the register of a machine's own diagnostic readout, and it
 * made the frame read as a screenshot of a tool rather than as a place.
 *
 * So: sentence case, no tracking, one size step between the name and the line
 * under it, and the environment metadata is gone rather than restyled. What
 * survives is the smallest true statement about where the viewer is.
 */
export function SystemMasthead() {
  return (
    <header className="system-masthead">
      <h1 className="system-masthead__title">
        <span>Polnareff</span>
        <span>System</span>
      </h1>
      <p className="system-masthead__subline">A local computing environment</p>
    </header>
  );
}
