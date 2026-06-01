import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AdminErrorBoundary } from "./components/AdminErrorBoundary";
import { initializeAdminObservability } from "./observability";
import "./styles.css";

initializeAdminObservability();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Admin root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <AdminErrorBoundary>
      <App />
    </AdminErrorBoundary>
  </StrictMode>,
);
