import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import { ProtectedRoute } from './components/ProtectedRoute'
import QuestionUpload from './pages/QuestionUpload'
import SessionControl from './pages/SessionControl'
import Join from './pages/Join'
import ParticipantQuiz from './pages/ParticipantQuiz'
import ResultsScreen from './pages/ResultsScreen'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload"
          element={
            <ProtectedRoute>
              <QuestionUpload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/session/:sessionId"
          element={
            <ProtectedRoute>
              <SessionControl />
            </ProtectedRoute>
          }
        />
        <Route
          path="/session/:sessionId/results"
          element={
            <ProtectedRoute>
              <ResultsScreen />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/join/:token" element={<Join />} />
        <Route path="/play/:sessionId" element={<ParticipantQuiz />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App