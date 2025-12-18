import "@/App.css";
import { Library } from "@/components/Library";
import { Reader } from "@/components/Reader";
import { Sessions } from "@/components/Sessions";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/reader/:bookId" element={<Reader />} />
          <Route path="/sessions" element={<Sessions />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
