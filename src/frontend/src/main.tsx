import React from "react";
import { createRoot } from "react-dom/client";
import { useRoute } from "./lib/router";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import DemoStore from "./pages/DemoStore";
import "./styles/globals.css";
import "./styles/v2.css";

function App(): JSX.Element {
  const path = useRoute();
  if (path === "/pricing" || path.startsWith("/pricing")) return <Pricing />;
  if (path.startsWith("/dashboard")) return <Dashboard />;
  if (path.startsWith("/demo")) return <DemoStore />;
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
