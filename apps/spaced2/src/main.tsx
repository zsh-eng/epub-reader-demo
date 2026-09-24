import App from "@/App";
import "katex/dist/katex.min.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@highlightjs/cdn-assets/styles/base16/ros-pine-moon.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
