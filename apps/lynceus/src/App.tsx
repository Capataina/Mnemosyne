import { QueryClientProvider } from "@tanstack/react-query";
import "./App.css";
import "react";
import { BrowserRouter, useRoutes } from "react-router-dom";

import routes from "~react-pages";
import { ConfirmProvider } from "./components/ui/confirm";
import { queryClient } from "./queries/queryClient";

function Routes() {
  return useRoutes(routes);
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <Routes />
        </ConfirmProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
