import { createRoot } from "react-dom/client";
import App, { GameBoundary } from "./App";

createRoot(document.getElementById("root")!).render(
  <GameBoundary>
    <App />
  </GameBoundary>,
);
