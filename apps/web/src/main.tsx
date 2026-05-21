import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { bootstrapTelegramApp } from "./app/bootstrap";
import { router } from "./app/router";
import "./shared/styles/globals.css";

bootstrapTelegramApp();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
