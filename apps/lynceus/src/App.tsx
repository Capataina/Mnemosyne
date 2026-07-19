import { QueryClientProvider } from "@tanstack/react-query";
import "./App.css";
import { useEffect } from "react";
import { BrowserRouter, useRoutes } from "react-router-dom";

import routes from "~react-pages";
import { BootSplash } from "./components/BootSplash";
import { ConfirmProvider } from "./components/ui/confirm";
import { OnboardingProvider } from "./features/onboarding";
import { queryClient } from "./queries/queryClient";
import { isProfilingEnabled } from "./services/perf";
import { initTelemetry } from "./services/telemetry";

function Routes() {
  return useRoutes(routes);
}

function App() {
  // The automatic capture layer (interactions with DOM paths, errors,
  // image failures, ⌘⇧M state bundles) arms once iff the binary was
  // launched in profiling mode — `just lynceus-dev-telemetry`.
  useEffect(() => {
    void isProfilingEnabled().then((on) => {
      if (on) initTelemetry(queryClient);
    });
  }, []);

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <OnboardingProvider>
            <Routes />
          </OnboardingProvider>
          {/* Sibling of the provider, per the plan's architecture
              diagram: the splash must never sit inside the wrapper
              that goes inert while onboarding is open. */}
          <BootSplash />
        </ConfirmProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
