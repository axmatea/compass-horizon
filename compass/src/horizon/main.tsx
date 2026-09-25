import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/base.css";
import "./ui/horizon.css";
import { Compass } from "./ui/Compass";

if (new URLSearchParams(window.location.search).get("embed") === "1") document.documentElement.classList.add("is-embed");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Compass />
  </StrictMode>,
);
