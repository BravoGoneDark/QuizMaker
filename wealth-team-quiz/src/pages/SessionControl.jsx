import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function SessionControl() {
  const { sessionId } = useParams()

  const [session, setSession] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [secondsLeft, setSecondsLeft] = useState(null)
  const [editedTimer, setEditedTimer] = useState('')
  const [savingTimer, setSavingTimer] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [participantCount, setParticipantCount] = useState(0)

  const intervalRef = useRef(null)

  // ---- Initial load: session, its quiz, and question count ----
  useEffect(() => {
    loadSession()
  }, [sessionId])

  async function loadSession() {
    setLoading(true)
    setLoadError('')

    const { data: sessionRow, error: sessionErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionErr) {
      setLoadError(sessionErr.message)
      setLoading(false)
      return
    }

    const { data: quizRow, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', sessionRow.quiz_id)
      .single()

    if (quizErr) {
      setLoadError(quizErr.message)
      setLoading(false)
      return
    }

    const { count, error: countErr } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', sessionRow.quiz_id)

    if (countErr) {
      setLoadError(countErr.message)
      setLoading(false)
      return
    }

    setSession(sessionRow)
    setQuiz(quizRow)
    setTotalQuestions(count)
    setEditedTimer(String(quizRow.time_limit_seconds))
    setLoading(false)
  }

  // ---- Advance logic, isolated so the trigger (timer vs. a future
  // manual button) can change without touching this function ----
  const advanceQuestion = useCallback(async () => {
    if (!session || !quiz) return

    const nextIndex = session.current_question_index + 1

    if (nextIndex >= totalQuestions) {
      // Last question just finished -- end the session automatically
      const { data, error } = await supabase
        .from('sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', session.id)
        .select()
        .single()

      if (!error) setSession(data)
      return
    }

    const { data, error } = await supabase
      .from('sessions')
      .update({ current_question_index: nextIndex })
      .eq('id', session.id)
      .select()
      .single()

    if (!error) setSession(data)
  }, [session, quiz, totalQuestions])

  // ---- Countdown timer: resets whenever the current question changes,
  // only runs while the session is live ----
  useEffect(() => {
    if (!session || session.status !== 'live' || !quiz) {
      clearInterval(intervalRef.current)
      return
    }

    setSecondsLeft(quiz.time_limit_seconds)

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          advanceQuestion()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(intervalRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index, quiz])

  // ---- Fetch the current question whenever we're live and the index
  // changes. Uses .range() by position rather than assuming question_no
  // is a contiguous 1..N sequence, since gaps are possible. ----
  useEffect(() => {
    if (!session || session.status !== 'live' || !quiz) {
      setCurrentQuestion(null)
      return
    }
    loadCurrentQuestion(session.current_question_index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index, quiz])

  async function loadCurrentQuestion(index) {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', quiz.id)
      .order('question_no', { ascending: true })
      .range(index, index)

    if (!error && data && data[0]) {
      setCurrentQuestion(data[0])
    }
  }

  // ---- Live participant count while waiting in draft ----
  useEffect(() => {
    if (!session || session.status !== 'draft') return

    loadParticipantCount()

    const channel = supabase
      .channel(`qm-participants-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'participants',
          filter: `session_id=eq.${session.id}`,
        },
        () => loadParticipantCount()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.status, session?.id])

  async function loadParticipantCount() {
    const { count } = await supabase
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id)
    setParticipantCount(count)
  }

  // ---- Actions ----
  async function handleStart() {
    const { data, error } = await supabase
      .from('sessions')
      .update({ status: 'live', started_at: new Date().toISOString() })
      .eq('id', session.id)
      .select()
      .single()

    if (error) {
      alert(`Could not start session: ${error.message}`)
      return
    }
    setSession(data)
  }

  async function handleEnd() {
    const { data, error } = await supabase
      .from('sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', session.id)
      .select()
      .single()

    if (error) {
      alert(`Could not end session: ${error.message}`)
      return
    }
    setSession(data)
  }

  async function handleSaveTimer() {
    const value = Number(editedTimer)
    if (!Number.isInteger(value) || value <= 0) {
      alert('Timer must be a positive whole number of seconds.')
      return
    }

    setSavingTimer(true)
    const { data, error } = await supabase
      .from('quizzes')
      .update({ time_limit_seconds: value })
      .eq('id', quiz.id)
      .select()
      .single()
    setSavingTimer(false)

    if (error) {
      alert(`Could not update timer: ${error.message}`)
      return
    }
    setQuiz(data)
  }

  if (loading) return <div className="p-8">Loading session...</div>
  if (loadError) return <div className="p-8 text-red-600">Error: {loadError}</div>
  if (!session || !quiz) return null

  const joinLink = `${window.location.origin}/join/${session.join_token}`

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">{quiz.name}</h1>
      <p className="text-sm text-gray-500">
        Status: <span className="font-medium capitalize">{session.status}</span>
      </p>

      {session.status === 'draft' && (
        <div className="space-y-4 border rounded p-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Per-question timer (seconds)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={editedTimer}
                onChange={(e) => setEditedTimer(e.target.value)}
                className="border rounded px-3 py-2 w-32"
              />
              <button
                onClick={handleSaveTimer}
                disabled={savingTimer}
                className="px-3 py-2 bg-gray-700 text-white rounded text-sm disabled:bg-gray-300"
              >
                {savingTimer ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Join Link</p>
            <p className="text-sm text-gray-600 break-all">{joinLink}</p>
          </div>

          <p className="text-sm text-gray-700">
            <span className="font-semibold">{participantCount}</span> participant
            {participantCount === 1 ? '' : 's'} joined
          </p>

          <button
            onClick={handleStart}
            className="px-4 py-2 bg-green-600 text-white rounded"
          >
            Start Session
          </button>
        </div>
      )}

      {session.status === 'live' && (
        <div className="space-y-4 border rounded p-4">
          <p className="text-lg">
            Question {session.current_question_index + 1} of {totalQuestions}
          </p>
          <p className="text-3xl font-mono">{secondsLeft}s</p>

          {currentQuestion && (
            <div className="border-t pt-4 space-y-2">
              <p className="font-medium">{currentQuestion.question_text}</p>
              <ul className="space-y-1 text-sm">
                {['A', 'B', 'C', 'D'].map((letter, i) => {
                  const optionKey = `option_${letter.toLowerCase()}`
                  const optionNumber = String(i + 1)
                  const isCorrect = currentQuestion.correct_option === optionNumber
                  return (
                    <li
                      key={letter}
                      className={isCorrect ? 'font-semibold text-green-700' : ''}
                    >
                      {letter}. {currentQuestion[optionKey]}
                      {isCorrect && ' ✓ correct'}
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-gray-500">
                Marks: {currentQuestion.marks}
                {currentQuestion.quiz_category && ` · ${currentQuestion.quiz_category}`}
              </p>
            </div>
          )}

          <button
            onClick={handleEnd}
            className="px-4 py-2 bg-red-600 text-white rounded"
          >
            End Session
          </button>
        </div>
      )}

      {session.status === 'ended' && (
        <div className="border rounded p-4">
          <p className="text-gray-600">This session has ended.</p>
        </div>
      )}
    </div>
  )
}