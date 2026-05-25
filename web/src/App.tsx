/**
 * Mouse Gesture Studio — Phase 1 placeholder UI for the
 * zmk-module-mouse-gesture-rpc custom subsystem.
 *
 * The real client wiring (DYA Studio RPC connection, gesture editor,
 * settings panel) lands in Phase 2+. For now this page mainly exists so
 * the URL embedded in the firmware (ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS)
 * resolves to something the user can read.
 */

import "./App.css";

const REPO_URL =
  "https://github.com/shakushakupanda/zmk-module-mouse-gesture-rpc";

function App() {
  return (
    <div className="app">
      <header className="header">
        <span className="icon">🖱️</span>
        <div>
          <h1>Mouse Gesture Studio</h1>
          <p>Runtime configuration UI for kot149/zmk-mouse-gesture</p>
        </div>
      </header>

      <section className="card">
        <h2>Phase 1: skeleton</h2>
        <p>
          The custom Studio RPC subsystem{" "}
          <code>cormoran__mouse_gesture</code> is now registered. DYA Studio
          can see it under <strong>Subsystems</strong>, and clicking the link
          opens this page.
        </p>
        <p>
          The actual gesture editor and settings panel are being built in the
          phases below.
        </p>
      </section>

      <section className="card">
        <h2>Roadmap</h2>
        <ul>
          <li>
            <strong>Phase 1</strong> — Subsystem registration + RPC dispatcher{" "}
            <em>(done)</em>
          </li>
          <li>
            <strong>Phase 2</strong> — Read-only list of DTS-defined gestures
          </li>
          <li>
            <strong>Phase 3</strong> — Add / update / delete gestures + NVS
            persistence
          </li>
          <li>
            <strong>Phase 4</strong> — Settings editor (stroke size, idle
            timeout, cooldown, …)
          </li>
          <li>
            <strong>Phase 5</strong> — Polish + docs
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Links</h2>
        <ul>
          <li>
            Source &amp; roadmap:{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL.replace("https://", "")}
            </a>
          </li>
          <li>
            DYA Studio:{" "}
            <a
              href="https://studio.dya.cormoran.works/"
              target="_blank"
              rel="noreferrer"
            >
              studio.dya.cormoran.works
            </a>
          </li>
          <li>
            Underlying gesture engine:{" "}
            <a
              href="https://github.com/kot149/zmk-mouse-gesture"
              target="_blank"
              rel="noreferrer"
            >
              github.com/kot149/zmk-mouse-gesture
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}

export default App;
