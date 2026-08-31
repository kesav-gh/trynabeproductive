import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "@/pages/Home";
import { GameModes } from "@/pages/GameModes";
import { PlayerSetup } from "@/pages/PlayerSetup";
import { Handoff } from "@/pages/Handoff";
import { GameQuestion } from "@/pages/GameQuestion";
import { PlayerSearch } from "@/pages/PlayerSearch";
import { Reveal } from "@/pages/Reveal";
import { Scoreboard } from "@/pages/Scoreboard";
import { NotFound } from "@/pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/modes" element={<GameModes />} />
        <Route path="/setup" element={<PlayerSetup />} />
        <Route path="/handoff" element={<Handoff />} />
        <Route path="/game" element={<GameQuestion />} />
        <Route path="/search" element={<PlayerSearch />} />
        <Route path="/reveal" element={<Reveal />} />
        <Route path="/scoreboard" element={<Scoreboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
