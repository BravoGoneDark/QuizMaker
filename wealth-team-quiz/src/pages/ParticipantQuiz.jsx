import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { supabase } from '../supabaseClient'
import HERO_IMAGE from '../assets/hero-participant-quiz.avif'

function FlourishDivider({ light = false }) {
  return (
    <svg
      width="56"
      height="14"
      viewBox="0 0 56 14"
      fill="none"
      className={light ? 'text-[#E8D9A8]' : 'text-[#AB932B]'}
      aria-hidden="true"
    >
      <line x1="0" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M28 2L31.5 7L28 12L24.5 7L28 2Z" fill="currentColor" />
      <line x1="36" y1="7" x2="56" y2="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function PulseDots() {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="w-2 h-2 rounded-full bg-[#AB932B] animate-pulse" />
      <span className="w-2 h-2 rounded-full bg-[#AB932B] animate-pulse [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-[#AB932B] animate-pulse [animation-delay:300ms]" />
    </div>
  )
}

// Server-anchored countdown, rendered as a ring instead of plain text.
// Timing/derivation logic lives in the parent — this just draws it.
function CircularTimer({ secondsLeft, timeLimitSeconds }) {
  if (secondsLeft === null || !timeLimitSeconds) return null

  const size = 88
  const stroke = 5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const progress = Math.max(0, Math.min(1, secondsLeft / timeLimitSeconds))
  const offset = circumference * (1 - progress)
  const urgent = secondsLeft <= 5

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E3D9BC" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? '#925254' : '#AB932B'}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-serif text-2xl ${urgent ? 'text-[#925254]' : 'text-[#1E1B16]'}`}>
          {secondsLeft}
        </span>
      </div>
    </div>
  )
}

// Small count-up used on the results screen — purely cosmetic, no bearing
// on the underlying value which is set once results load.
function AnimatedNumber({ value, suffix = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (value === null || value === undefined) return
    const obj = { val: 0 }
    const tween = gsap.to(obj, {
      val: value,
      duration: 1,
      ease: 'power2.out',
      onUpdate: () => {
        if (ref.current) ref.current.textContent = `${Math.round(obj.val)}${suffix}`
      },
    })
    return () => tween.kill()
  }, [value, suffix])

  return <span ref={ref}>0{suffix}</span>
}

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

  const [currentQuestionStartedAt, setCurrentQuestionStartedAt] = useState(null)
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [finalResults, setFinalResults] = useState([])
  const [finalResultsLoading, setFinalResultsLoading] = useState(false)

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
          setCurrentQuestionStartedAt(payload.new.current_question_started_at)
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
      .select('status, current_question_index, current_question_started_at, quiz_id')
      .eq('id', sessionId)
      .single()
    if (data) {
      setSessionStatus(data.status)
      setCurrentIndex(data.current_question_index)
      setCurrentQuestionStartedAt(data.current_question_started_at)

      const { data: quizRow } = await supabase
        .from('quizzes')
        .select('time_limit_seconds')
        .eq('id', data.quiz_id)
        .single()
      if (quizRow) setTimeLimitSeconds(quizRow.time_limit_seconds)
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

    loadLeaderboard()
  }

  // ---- Leaderboard: percentage-only, no answers or per-question
  // detail exposed. Piggybacks on the same trigger as the question
  // load above, so it refreshes every time the question changes. ----
  async function loadLeaderboard() {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_session_id: sessionId,
    })
    if (error || !data) return
    setLeaderboard(data)
  }

  // ---- Countdown timer: derives remaining time from the server
  // timestamp rather than a local starting point, so it's correct
  // even after a refresh or the phone locking mid-question. Clamped
  // on both ends so it can never show negative or over-the-limit
  // values even with a moment of clock skew. ----
  useEffect(() => {
    if (sessionStatus !== 'live' || !currentQuestionStartedAt || !timeLimitSeconds) {
      setSecondsLeft(null)
      return
    }

    function tick() {
      const elapsed = (Date.now() - new Date(currentQuestionStartedAt).getTime()) / 1000
      const remaining = Math.max(0, Math.min(timeLimitSeconds, Math.ceil(timeLimitSeconds - elapsed)))
      setSecondsLeft(remaining)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [sessionStatus, currentQuestionStartedAt, timeLimitSeconds])

  // ---- Once the session ends, load everyone's final rank/score.
  // Server-side function itself refuses to return anything unless
  // status is truly 'ended', so this can't leak early. ----
  useEffect(() => {
    if (sessionStatus !== 'ended') return

    setFinalResultsLoading(true)
    supabase
      .rpc('get_final_results', { p_session_id: sessionId })
      .then(({ data, error }) => {
        setFinalResultsLoading(false)
        if (!error && data) setFinalResults(data)
      })
  }, [sessionStatus, sessionId])

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
    return (
      <div className="min-h-screen bg-[#F6F1E6] flex items-center justify-center">
        <PulseDots />
      </div>
    )
  }

  if (sessionStatus === 'draft') {
    return (
      <div className="min-h-screen relative flex items-center justify-center px-6 overflow-hidden">
        <img src={HERO_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1E1B16]/85 via-[#1E1B16]/70 to-[#1E1B16]/90" />

        <div className="relative w-full max-w-sm text-center">

          {/* Changed text-xs to text-sm */}
          <span className="text-sm tracking-[0.25em] uppercase text-[#E8D9A8] font-medium">
            Wealth Team Quiz
          </span>
          
          {/* Changed text-3xl to text-5xl */}
          <h1 className="mt-4 font-serif text-5xl text-white">You're in!</h1>
          
          <div className="mt-3 flex justify-center">
            <FlourishDivider light />
          </div>
          
          {/* Changed text-sm to text-base */}
          <p className="mt-4 text-base text-white/70">
            Sit tight — the Quiz Master will start the quiz shortly.
          </p>

          <div className="mt-10">
            <PulseDots />
          </div>

          {participantCount !== null && (
            <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-4 py-2 text-base text-white">
              {/* Changed text-base to text-lg */}
              <span className="font-serif text-lg">{participantCount}</span>
              <span className="text-white/70">participants joined</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (sessionStatus === 'ended') {
    const myRank = finalResults.findIndex((r) => r.participant_id === participantId)
    const myResult = myRank >= 0 ? finalResults[myRank] : null

    return (
      <div className="min-h-screen bg-[#F6F1E6] px-6 py-12">
        <div className="max-w-md mx-auto text-center">

          <h1 className="font-serif text-3xl text-[#1E1B16]">Quiz Over</h1>
          <div className="mt-3 flex justify-center">
            <FlourishDivider />
          </div>
          <p className="mt-4 text-sm text-[#5A5346]">Thanks for playing!</p>

          {finalResultsLoading && (
            <p className="mt-8 text-sm text-[#8A7522]">Tallying results…</p>
          )}

          {myResult && (
            <div className="mt-8 bg-[#1E1B16] rounded-2xl px-8 py-8 text-white">
              <p className="text-xs tracking-[0.2em] uppercase text-[#E8D9A8]">Your Result</p>
              <p className="mt-3 font-serif text-5xl">
                <AnimatedNumber value={myRank + 1} />
              </p>
              <p className="text-sm text-white/60 mt-1">Rank</p>

              <div className="mt-6 flex justify-center gap-10 text-sm">
                <div>
                  <p className="font-serif text-xl">
                    <AnimatedNumber value={myResult.total_score} />
                  </p>
                  <p className="text-white/60 text-xs mt-0.5">marks</p>
                </div>
                <div>
                  <p className="font-serif text-xl">
                    <AnimatedNumber value={myResult.percentage} suffix="%" />
                  </p>
                  <p className="text-white/60 text-xs mt-0.5">score</p>
                </div>
              </div>
            </div>
          )}

          {finalResults.length > 0 && (
            <div className="mt-8 text-left">
              <p className="text-xs tracking-[0.15em] uppercase text-[#8A7522] font-medium mb-3">
                All Results
              </p>
              <ol className="space-y-1.5 text-sm">
                {finalResults.map((row, i) => (
                  <li
                    key={row.participant_id}
                    className={`flex justify-between items-center py-2 px-3 rounded-lg ${
                      row.participant_id === participantId
                        ? 'bg-[#AB932B]/10 border border-[#AB932B]/40 font-medium'
                        : 'odd:bg-white/60'
                    }`}
                  >
                    <span className="text-[#1E1B16]">
                      {i + 1}. {row.first_name} {row.last_name}{' '}
                      <span className="text-[#8A7522]">({row.employee_code})</span>
                    </span>
                    <span className="font-mono text-[#5A5346]">
                      {row.total_score} &middot; {row.percentage}%
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    )
  }

  // sessionStatus === 'live'
  return (
    <div className="min-h-screen bg-[#F6F1E6] px-6 py-10">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <span className="text-xs tracking-[0.2em] uppercase text-[#8A7522] font-medium">Live</span>
        </div>

        {!currentQuestion && (
          <p className="text-center text-sm text-[#5A5346] mt-16">Loading question…</p>
        )}

        {currentQuestion && (
          <>
            <CircularTimer secondsLeft={secondsLeft} timeLimitSeconds={timeLimitSeconds} />

            <div className="mt-6 bg-white rounded-2xl shadow-sm border border-[#EADFC0] p-6">
              <p className="font-serif text-xl text-[#1E1B16] leading-snug">
                {currentQuestion.question_text}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {['A', 'B', 'C', 'D'].map((letter) => {
                const optionKey = `option_${letter.toLowerCase()}`
                const isSelected = alreadyAnswered?.selected_option === letter
                const disabled = submitting || !!alreadyAnswered
                return (
                  <button
                    key={letter}
                    onClick={() => handleAnswer(letter)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-xl border transition
                      ${isSelected ? 'bg-[#AB932B]/10 border-[#AB932B]' : 'bg-white border-[#EADFC0]'}
                      ${alreadyAnswered && !isSelected ? 'opacity-40' : ''}
                      disabled:cursor-not-allowed`}
                  >
                    <span
                      className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium
                        ${isSelected ? 'bg-[#AB932B] text-white' : 'bg-[#F6F1E6] text-[#8A7522]'}`}
                    >
                      {letter}
                    </span>
                    <span className="text-[#1E1B16]">{currentQuestion[optionKey]}</span>
                  </button>
                )
              })}
            </div>

            {alreadyAnswered && (
              <p className="mt-5 text-center text-sm text-[#5A5346]">
                Answer submitted. Waiting for the next question…
              </p>
            )}

            {leaderboard.length > 0 && (
              <div className="mt-8 pt-5 border-t border-[#EADFC0]">
                <p className="text-xs tracking-[0.15em] uppercase text-[#8A7522] font-medium mb-3">
                  Leaderboard &middot; Top 10
                </p>
                <ol className="space-y-1.5 text-sm">
                  {leaderboard.slice(0, 10).map((row, i) => (
                    <li
                      key={row.participant_id}
                      className="flex justify-between items-center py-1.5 px-3 rounded-lg odd:bg-white/60"
                    >
                      <span className="text-[#1E1B16]">
                        {i + 1}. {row.first_name} {row.last_name}
                      </span>
                      <span className="font-mono text-[#5A5346]">{row.percentage}%</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}