import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import heroSessionControl from '../assets/hero-session-control.avif'

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
  const [leaderboard, setLeaderboard] = useState([])

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
      loadLeaderboard()
      return
    }

    const { data, error } = await supabase
      .from('sessions')
      .update({
        current_question_index: nextIndex,
        current_question_started_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .select()
      .single()

    if (!error) setSession(data)
    loadLeaderboard()
  }, [session, quiz, totalQuestions])

  // ---- Countdown timer: derived from the server timestamp
  // (session.current_question_started_at) rather than a local reset,
  // so the Quiz Master's clock stays in sync with what participants
  // see and advanceQuestion() fires at the same true moment for
  // everyone. Clamped on both ends against clock skew. ----
  useEffect(() => {
    if (!session || session.status !== 'live' || !quiz || !session.current_question_started_at) {
      clearInterval(intervalRef.current)
      return
    }

    function tick() {
      const elapsed = (Date.now() - new Date(session.current_question_started_at).getTime()) / 1000
      const remaining = Math.max(0, Math.min(quiz.time_limit_seconds, Math.ceil(quiz.time_limit_seconds - elapsed)))
      setSecondsLeft(remaining)

      if (remaining <= 0) {
        clearInterval(intervalRef.current)
        advanceQuestion()
      }
    }

    tick()
    intervalRef.current = setInterval(tick, 1000)

    return () => clearInterval(intervalRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index, session?.current_question_started_at, quiz])

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
      .update({
        status: 'live',
        started_at: new Date().toISOString(),
        current_question_started_at: new Date().toISOString(),
      })
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

  async function loadLeaderboard() {
    const { data, error } = await supabase
      .from('responses')
      .select('participant_id, score_awarded, time_taken_ms, participants!inner(session_id, employee_code, first_name, last_name)')
      .eq('participants.session_id', session.id)

    if (error) {
      console.error('Leaderboard load failed:', error.message)
      return
    }

    const byParticipant = {}
    for (const r of data) {
      const pid = r.participant_id
      if (!byParticipant[pid]) {
        byParticipant[pid] = {
          participantId: pid,
          employeeCode: r.participants.employee_code,
          firstName: r.participants.first_name,
          lastName: r.participants.last_name,
          totalScore: 0,
          totalTime: 0,
          answeredCount: 0,
        }
      }
      byParticipant[pid].totalScore += r.score_awarded
      byParticipant[pid].totalTime += r.time_taken_ms
      byParticipant[pid].answeredCount += 1
    }

    const rows = Object.values(byParticipant).map((p) => ({
      ...p,
      avgTime: p.answeredCount > 0 ? p.totalTime / p.answeredCount : Infinity,
    }))

    rows.sort((a, b) => b.totalScore - a.totalScore || a.avgTime - b.avgTime)

    // Standard competition ranking (1, 2, 2, 4...)
    let rank = 0
    let prevScore = null
    let prevAvgTime = null
    rows.forEach((row, i) => {
      if (row.totalScore !== prevScore || row.avgTime !== prevAvgTime) {
        rank = i + 1
      }
      row.rank = rank
      prevScore = row.totalScore
      prevAvgTime = row.avgTime
    })

    setLeaderboard(rows)
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#17140F] text-[#F6F1E6] font-sans">
        <p className="text-sm uppercase tracking-[0.15em] text-[#AB932B]/80">Loading session…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#17140F] text-[#F6F1E6] font-sans">
        <p className="text-sm text-[#c98789]">Error: {loadError}</p>
      </div>
    )
  }

  if (!session || !quiz) return null

  const joinLink = `${window.location.origin}/join/${session.join_token}`

  // Presentational-only lookup; doesn't affect session logic.
  const statusMeta = {
    draft: { label: 'Draft · Waiting Room', dot: 'bg-[#AB932B]' },
    live: { label: 'Live', dot: 'bg-[#925254] animate-pulse' },
    ended: { label: 'Ended', dot: 'bg-[#F6F1E6]/40' },
  }[session.status]

  return (
    <div className="h-screen overflow-hidden bg-[#17140F] text-[#F6F1E6] font-sans flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#AB932B]/15">
        <div className="flex items-baseline gap-4">
          <h1 className="font-serif text-2xl">{quiz.name}</h1>
          <span className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#AB932B]/80">
            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
        </div>
        {session.status === 'live' && (
          <p className="text-xs uppercase tracking-[0.15em] text-[#F6F1E6]/50">
            Question {session.current_question_index + 1} of {totalQuestions}
          </p>
        )}
      </header>

      {/* Horizontal control area -- no page scroll */}
      <main className="flex-1 min-h-0 grid grid-cols-[1.05fr_1fr] gap-5 p-5">
        {/* LEFT: hero visual panel */}
        <section className="relative rounded-2xl overflow-hidden border border-[#AB932B]/15">
          <img
            src={heroSessionControl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17140F] via-[#17140F]/60 to-[#17140F]/10" />

          {session.status === 'draft' && (
            <div className="relative h-full flex flex-col justify-between p-8">
              <div className="flex items-center gap-2 self-start rounded-full bg-[#17140F]/60 backdrop-blur px-4 py-1.5 border border-[#AB932B]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#AB932B] animate-pulse" />
                <span className="text-xs uppercase tracking-[0.15em] text-[#F6F1E6]/80">Waiting for participants</span>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <p className="font-serif text-5xl leading-none">{participantCount}</p>
                  <p className="text-sm text-[#F6F1E6]/60 mt-2">
                    participant{participantCount === 1 ? '' : 's'} joined
                  </p>
                </div>
                <div className="flex -space-x-3">
                  {Array.from({ length: Math.min(Math.max(participantCount, 1), 5) }).map((_, i) => (
                    <div
                      key={i}
                      className="w-10 h-10 rounded-full border-2 border-[#17140F] bg-gradient-to-br from-[#AB932B] to-[#925254]"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {session.status === 'live' && (
            <div className="relative h-full flex flex-col items-center justify-center gap-5">
              <div
                className="w-48 h-48 rounded-full flex items-center justify-center transition-colors"
                style={{
                  background: `conic-gradient(${secondsLeft !== null && secondsLeft <= 5 ? '#925254' : '#AB932B'} ${
                    quiz.time_limit_seconds ? ((secondsLeft ?? quiz.time_limit_seconds) / quiz.time_limit_seconds) * 360 : 0
                  }deg, rgba(246,241,230,0.08) 0deg)`,
                }}
              >
                <div className="w-[164px] h-[164px] rounded-full bg-[#17140F] flex items-center justify-center">
                  <span className="font-serif text-6xl">{secondsLeft ?? '–'}</span>
                </div>
              </div>
              <p className="text-xs uppercase tracking-[0.15em] text-[#F6F1E6]/50">seconds remaining</p>
            </div>
          )}

          {session.status === 'ended' && (
            <div className="relative h-full flex flex-col items-center justify-center gap-2 text-center px-8">
              <p className="font-serif text-4xl">Session complete</p>
              <p className="text-sm text-[#F6F1E6]/60">Final standings are ready to review.</p>
            </div>
          )}
        </section>

        {/* RIGHT: control cards */}
        <section className="min-h-0 flex flex-col gap-4">
          {session.status === 'draft' && (
            <>
              <div className="rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] p-5">
                <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-3">Per-question timer</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    value={editedTimer}
                    onChange={(e) => setEditedTimer(e.target.value)}
                    className="flex-1 bg-[#17140F] border border-[#AB932B]/20 rounded-lg px-3 py-2 text-[#F6F1E6] focus:outline-none focus:border-[#AB932B]/60"
                  />
                  <button
                    onClick={handleSaveTimer}
                    disabled={savingTimer}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-[#AB932B] text-[#17140F] disabled:opacity-40 hover:bg-[#c2a832] transition-colors"
                  >
                    {savingTimer ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] p-5 flex-1 min-h-0 flex gap-5 items-center">
                <div className="bg-[#F6F1E6] p-2 rounded-lg shrink-0">
                  <QRCodeSVG value={joinLink} size={104} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-2">Join link</p>
                  <p className="text-xs text-[#F6F1E6]/60 break-all leading-relaxed">{joinLink}</p>
                </div>
              </div>

              <button
                onClick={handleStart}
                className="rounded-2xl bg-[#AB932B] text-[#17140F] font-medium py-4 text-sm uppercase tracking-[0.15em] hover:bg-[#c2a832] transition-colors"
              >
                Start session
              </button>
            </>
          )}

          {session.status === 'live' && (
            <>
              <div className="rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] p-5 flex-1 min-h-0 overflow-y-auto">
                {currentQuestion ? (
                  <>
                    <p className="font-serif text-lg leading-snug mb-4">{currentQuestion.question_text}</p>
                    <ul className="space-y-2 text-sm">
                      {['A', 'B', 'C', 'D'].map((letter, i) => {
                        const optionKey = `option_${letter.toLowerCase()}`
                        const optionNumber = String(i + 1)
                        const isCorrect = currentQuestion.correct_option === optionNumber
                        return (
                          <li
                            key={letter}
                            className={`flex gap-2 rounded-lg px-3 py-2 border ${
                              isCorrect
                                ? 'border-[#AB932B]/50 bg-[#AB932B]/10 text-[#AB932B]'
                                : 'border-[#F6F1E6]/10 text-[#F6F1E6]/70'
                            }`}
                          >
                            <span className="font-medium">{letter}.</span>
                            <span>{currentQuestion[optionKey]}</span>
                            {isCorrect && <span className="ml-auto text-xs">correct</span>}
                          </li>
                        )
                      })}
                    </ul>
                    <p className="text-xs text-[#F6F1E6]/40 mt-4">
                      Marks: {currentQuestion.marks}
                      {currentQuestion.quiz_category && ` · ${currentQuestion.quiz_category}`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[#F6F1E6]/40">Loading question…</p>
                )}
              </div>

              <div className="rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] p-5 max-h-[38%] overflow-y-auto">
                <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-3">Leaderboard · Top 10</p>
                {leaderboard.length > 0 ? (
                  <ol className="space-y-1.5 text-sm">
                    {leaderboard.slice(0, 10).map((row) => (
                      <li key={row.participantId} className="flex justify-between text-[#F6F1E6]/80">
                        <span>
                          {row.rank}. {row.firstName} {row.lastName} ({row.employeeCode})
                        </span>
                        <span className="font-medium text-[#AB932B]">{row.totalScore} pts</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-[#F6F1E6]/40">No responses yet.</p>
                )}
              </div>

              <button
                onClick={handleEnd}
                className="rounded-2xl bg-[#925254] text-[#F6F1E6] font-medium py-4 text-sm uppercase tracking-[0.15em] hover:bg-[#a35f61] transition-colors"
              >
                End session
              </button>
            </>
          )}

          {session.status === 'ended' && (
            <div className="rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] p-6 flex-1 flex flex-col justify-center items-center gap-4 text-center">
              <p className="text-sm text-[#F6F1E6]/60">This session has ended.</p>
              <Link
                to={`/session/${session.id}/results`}
                className="px-6 py-3 rounded-xl bg-[#AB932B] text-[#17140F] font-medium text-sm uppercase tracking-[0.15em] hover:bg-[#c2a832] transition-colors"
              >
                View results
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}