/** Tiny hash router: path-driven views with a subscribe model. */
import { useEffect, useState } from "react";

export function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}
