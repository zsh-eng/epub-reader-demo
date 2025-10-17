import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Toaster } from "./components/ui/sonner";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/reader/:bookId" element={<Reader />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
