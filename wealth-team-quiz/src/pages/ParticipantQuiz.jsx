import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function ParticipantQuiz() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [participantId, setParticipantId] = useState(null)
  const [sessionStatus, setSessionStatus] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(null)
  const [participantCount, setParticipantCount] = useState(null)

  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [alreadyAnswered, setAlreadyAnswered] = useState(null) // { selected_option, is_correct, score_awarded } | null
  const [submitting, setSubmitting] = useState(false)

  const questionShownAt = useRef(null) // for time_taken_ms

  // ---- Resolve participant identity from localStorage, or bounce
  // back to the join screen if we don't have one ----
  useEffect(() => {
    const stored = localStorage.getItem(`wtq_participant_${sessionId}`)
    if (!stored) {
      redirectToJoin()
      return
    }
    const { participantId: id } = JSON.parse(stored)
    setParticipantId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function redirectToJoin() {
    const { data } = await supabase
      .from('sessions')
      .select('join_token')
      .eq('id', sessionId)
      .single()
    navigate(data ? `/join/${data.join_token}` : '/')
  }

  // ---- Initial session load + Realtime subscription for status
  // and current_question_index changes pushed by the Quiz Master ----
  useEffect(() => {
    loadSession()

    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          setSessionStatus(payload.new.status)
          setCurrentIndex(payload.new.current_question_index)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function loadSession() {
    const { data } = await supabase
      .from('sessions')
      .select('status, current_question_index')
      .eq('id', sessionId)
      .single()
    if (data) {
      setSessionStatus(data.status)
      setCurrentIndex(data.current_question_index)
    }
  }

  // ---- While waiting (draft), keep a live participant count ----
  useEffect(() => {
    if (sessionStatus !== 'draft') return

    loadParticipantCount()

    const channel = supabase
      .channel(`participants-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'participants',
          filter: `session_id=eq.${sessionId}`,
        },
        () => loadParticipantCount()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionStatus, sessionId])

  async function loadParticipantCount() {
    const { count } = await supabase
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
    setParticipantCount(count)
  }

  // ---- Once live, load the current question + check whether this
  // participant already answered it (resume case) ----
  useEffect(() => {
    if (sessionStatus !== 'live' || currentIndex === null || !participantId) return

    setCurrentQuestion(null)
    setAlreadyAnswered(null)

    loadCurrentQuestionAndStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, currentIndex, participantId])

  async function loadCurrentQuestionAndStatus() {
    const { data: question, error } = await supabase.rpc('get_current_question', {
      p_session_id: sessionId,
    })
    if (error || !question || question.length === 0) return

    setCurrentQuestion(question[0])
    questionShownAt.current = Date.now()

    const { data: myResponse } = await supabase.rpc('get_my_response', {
      p_participant_id: participantId,
      p_session_id: sessionId,
    })

    if (myResponse && myResponse.length > 0) {
      setAlreadyAnswered(myResponse[0])
    }
  }

  async function handleAnswer(letter) {
    if (submitting || alreadyAnswered) return
    setSubmitting(true)

    const timeTakenMs = Date.now() - (questionShownAt.current ?? Date.now())

    const { data, error } = await supabase.rpc('submit_response', {
      p_participant_id: participantId,
      p_session_id: sessionId,
      p_selected_option: letter,
      p_time_taken_ms: timeTakenMs,
    })

    setSubmitting(false)

    if (error) {
      alert(`Could not submit answer: ${error.message}`)
      return
    }

    if (data && data.length > 0) {
      setAlreadyAnswered({ selected_option: letter, ...data[0] })
    }
  }

  // ---- Render states ----
  if (!participantId || sessionStatus === null) {
    return <div className="p-8 text-center">Loading...</div>
  }

  if (sessionStatus === 'draft') {
    return (
      <div className="max-w-md mx-auto p-6 mt-16 text-center space-y-4">
        <h1 className="text-xl font-semibold">You're in!</h1>
        <p className="text-gray-600">Waiting for the Quiz Master to start...</p>
        {participantCount !== null && (
          <p className="text-sm text-gray-500">{participantCount} participants joined</p>
        )}
      </div>
    )
  }

  if (sessionStatus === 'ended') {
    return (
      <div className="max-w-md mx-auto p-6 mt-16 text-center space-y-4">
        <h1 className="text-xl font-semibold">Quiz Over</h1>
        <p className="text-gray-600">Thanks for playing!</p>
      </div>
    )
  }

  // sessionStatus === 'live'
  return (
    <div className="max-w-md mx-auto p-6 mt-8 space-y-6">
      {!currentQuestion && <p className="text-center text-gray-500">Loading question...</p>}

      {currentQuestion && (
        <>
          <p className="font-medium text-lg">{currentQuestion.question_text}</p>

          <div className="space-y-3">
            {['A', 'B', 'C', 'D'].map((letter, i) => {
              const optionKey = `option_${letter.toLowerCase()}`
              const isSelected = alreadyAnswered?.selected_option === letter
              return (
                <button
                  key={letter}
                  onClick={() => handleAnswer(letter)}
                  disabled={submitting || !!alreadyAnswered}
                  className={`w-full text-left px-4 py-3 rounded border
                    ${isSelected ? 'bg-blue-100 border-blue-500' : 'bg-white'}
                    ${alreadyAnswered && !isSelected ? 'opacity-50' : ''}
                    disabled:cursor-not-allowed`}
                >
                  {letter}. {currentQuestion[optionKey]}
                </button>
              )
            })}
          </div>

          {alreadyAnswered && (
            <p className="text-center text-sm text-gray-500">
              Answer submitted. Waiting for the next question...
            </p>
          )}
        </>
      )}
    </div>
  )
}