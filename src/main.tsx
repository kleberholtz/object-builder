import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./lib/i18n";
import { initTheme } from "./lib/theme";

initI18n();
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
