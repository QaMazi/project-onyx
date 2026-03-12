import { BrowserRouter, Routes, Route, Link } from "react-router-dom"
import "./App.css"

function Login() {
  return (
    <div className="onyx-page">
      <div className="onyx-overlay" />
      <div className="onyx-card">
        <h1 className="onyx-title">PROJECT ONYX</h1>
        <p className="onyx-subtitle">GentlemensGaming.org</p>

        <button className="onyx-button">Login with Discord</button>

        <div className="onyx-links">
          <Link to="/mode">Go to Mode Select</Link>
        </div>
      </div>
    </div>
  )
}

function ModeSelect() {
  return (
    <div className="simple-page">
      <h1>Select Game Mode</h1>
      <div className="mode-links">
        <Link to="/mode/progression">Progression</Link>
        <Link to="/mode/deckgame">Deck Game</Link>
      </div>
    </div>
  )
}

function Progression() {
  return <h1>Progression Mode</h1>
}

function DeckGame() {
  return <h1>Deck Game Mode</h1>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/mode" element={<ModeSelect />} />
        <Route path="/mode/progression" element={<Progression />} />
        <Route path="/mode/deckgame" element={<DeckGame />} />
      </Routes>
    </BrowserRouter>
  )
}