import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

// window.foreman is the preload's ShellApi bridge (see global.d.ts).
createRoot(document.getElementById("root")!).render(<App api={window.foreman} />);
