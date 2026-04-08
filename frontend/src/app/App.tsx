import React, { useEffect } from "react";
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { apiFetch } from "./lib/api";

function App() {
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const res = await apiFetch<{ state: any; updatedAt: string | null }>("/api/state");
        if (cancelled) return;
        const state = res?.state;
        if (!state) return;

        if (state.simulationParams !== undefined) {
          sessionStorage.setItem("simulationParams", JSON.stringify(state.simulationParams));
        }
        if (state.simulationResult !== undefined) {
          sessionStorage.setItem("simulationResult", JSON.stringify(state.simulationResult));
        }
        if (state.uiDraft !== undefined) {
          sessionStorage.setItem("uiDraft", JSON.stringify(state.uiDraft));
        }
        if (state.comparisonCache !== undefined) {
          sessionStorage.setItem("comparisonCache", JSON.stringify(state.comparisonCache));
        }
      } catch {
        // ignore hydration failures
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  return <RouterProvider router={router} />;
}

export default App;
