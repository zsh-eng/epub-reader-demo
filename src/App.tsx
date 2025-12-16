import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hc } from "hono/client";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { AppType } from "../worker/index";
import "./App.css";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Toaster } from "./components/ui/sonner";

const queryClient = new QueryClient();
const client = hc<AppType>(import.meta.env.BASE_URL);

function App() {
  useEffect(() => {
    const getHello = async () => {
      const response = await client.api.hello.$get();
      const data = await response.json();
      console.log(data);
    };

    getHello();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/reader/:bookId" element={<Reader />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
