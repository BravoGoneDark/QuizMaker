import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../supabaseClient'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const { session } = useAuth()
  const navigate = useNavigate()

  const [quizzes, setQuizzes] = useState([])
  const [loadingQuizzes, setLoadingQuizzes] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [creatingSessionFor, setCreatingSessionFor] = useState(null) // quiz.id currently being started

  useEffect(() => {
    loadQuizzes()
  }, [])

  async function loadQuizzes() {
    setLoadingQuizzes(true)
    setFetchError('')

    const { data, error } = await supabase
      .from('quizzes')
      .select('id, name, time_limit_seconds, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setFetchError(error.message)
    } else {
      setQuizzes(data)
    }
    setLoadingQuizzes(false)
  }

  async function handleCreateSession(quiz) {
    setCreatingSessionFor(quiz.id)

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        quiz_id: quiz.id,
        join_token: crypto.randomUUID(),
        status: 'draft',
        current_question_index: 0,
      })
      .select()
      .single()

    setCreatingSessionFor(null)

    if (error) {
      alert(`Could not create session: ${error.message}`)
      return
    }

    navigate(`/session/${data.id}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-xl font-semibold">Wealth Team Quiz — Quiz Master</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{session?.user?.email}</span>
          <button onClick={handleLogout} className="px-3 py-2 bg-red-600 text-white rounded text-sm">
            Log out
          </button>
        </div>
      </div>

      <div className="grid gap-4 max-w-md mb-10">
        <button
          onClick={() => navigate('/upload')}
          className="px-4 py-3 bg-blue-600 text-white rounded text-left"
        >
          Upload Questions
        </button>
      </div>

      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Your Quizzes</h2>

        {loadingQuizzes && <p className="text-sm text-gray-500">Loading quizzes...</p>}
        {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}
        {!loadingQuizzes && quizzes.length === 0 && (
          <p className="text-sm text-gray-500">No quizzes yet. Upload one to get started.</p>
        )}

        <div className="space-y-3">
          {quizzes.map((quiz) => (
            <div
              key={quiz.id}
              className="flex justify-between items-center border rounded p-4"
            >
              <div>
                <p className="font-medium">{quiz.name}</p>
                <p className="text-sm text-gray-500">
                  {quiz.time_limit_seconds}s per question
                </p>
              </div>
              <button
                onClick={() => handleCreateSession(quiz)}
                disabled={creatingSessionFor === quiz.id}
                className="px-3 py-2 bg-green-600 text-white rounded text-sm disabled:bg-gray-300"
              >
                {creatingSessionFor === quiz.id ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}