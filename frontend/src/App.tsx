import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { Home } from "@/pages/Home";
import { GameModes } from "@/pages/GameModes";
import { PlayerSetup } from "@/pages/PlayerSetup";
import { Handoff } from "@/pages/Handoff";
import { GameQuestion } from "@/pages/GameQuestion";
import { PlayerSearch } from "@/pages/PlayerSearch";
import { Reveal } from "@/pages/Reveal";
import { Scoreboard } from "@/pages/Scoreboard";
import { Login } from "@/pages/Login";
import { SignUp } from "@/pages/SignUp";
import { Profile } from "@/pages/Profile";
import { GameHistory } from "@/pages/GameHistory";
import { NotFound } from "@/pages/NotFound";

export default function App() {
  return (
    <AuthProvider>
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
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/history" element={<GameHistory />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
