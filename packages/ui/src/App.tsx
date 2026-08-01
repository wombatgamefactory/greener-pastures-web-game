import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';

/**
 * Placeholder shell. The real layout is designed in wayfinder ticket 09; this
 * exists so the build, the deploy and the engine import are all provably wired.
 */
export function App() {
  return (
    <main className="shell">
      <h1>Greener Pastures</h1>
      <p>Scaffolding only. Nothing playable yet.</p>
      <p className="build-stamp">
        engine {ENGINE_VERSION} &middot; rules {RULES_EDITION}
      </p>
    </main>
  );
}
