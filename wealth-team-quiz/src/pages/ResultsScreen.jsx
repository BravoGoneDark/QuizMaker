import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import * as XLSX from 'xlsx'
import heroResults from '../assets/hero-results.avif'

export default function ResultsScreen() {
  const { sessionId } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [quiz, setQuiz] = useState(null)
  const [questions, setQuestions] = useState([])
  const [results, setResults] = useState([])

  // Purely presentational: lets the two summary bars animate up from 0
  // once real data is in, rather than snapping straight to height.
  const [animatedTopPct, setAnimatedTopPct] = useState(0)
  const [animatedAvgPct, setAnimatedAvgPct] = useState(0)

  useEffect(() => {
    if (!results.length && !questions.length) return

    const maxPossible = questions.reduce((sum, q) => sum + (q.marks ?? 0), 0)
    const topScore = results[0]?.totalScore ?? 0
    const avgScore = results.length
      ? results.reduce((sum, r) => sum + r.totalScore, 0) / results.length
      : 0
    const nextTopPct = maxPossible ? Math.round((topScore / maxPossible) * 100) : 0
    const nextAvgPct = maxPossible ? Math.round((avgScore / maxPossible) * 100) : 0

    // Drop back to 0 first, then animate up next frame so the height
    // transition has a starting point to rise from rather than snapping.
    setAnimatedTopPct(0)
    setAnimatedAvgPct(0)
    const raf = requestAnimationFrame(() => {
      setAnimatedTopPct(nextTopPct)
      setAnimatedAvgPct(nextAvgPct)
    })

    return () => cancelAnimationFrame(raf)
  }, [results, questions])

  useEffect(() => {
    loadResults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function loadResults() {
    setLoading(true)
    setLoadError('')

    const { data: sessionRow, error: sessionErr } = await supabase
      .from('sessions')
      .select('quiz_id')
      .eq('id', sessionId)
      .single()
    if (sessionErr) { setLoadError(sessionErr.message); setLoading(false); return }

    const { data: quizRow, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', sessionRow.quiz_id)
      .single()
    if (quizErr) { setLoadError(quizErr.message); setLoading(false); return }

    const { data: questionRows, error: questionsErr } = await supabase
      .from('questions')
      .select('id, question_no, marks')
      .eq('quiz_id', sessionRow.quiz_id)
      .order('question_no', { ascending: true })
    if (questionsErr) { setLoadError(questionsErr.message); setLoading(false); return }

    const { data: participantRows, error: participantsErr } = await supabase
      .from('participants')
      .select('id, employee_code, first_name, last_name')
      .eq('session_id', sessionId)
    if (participantsErr) { setLoadError(participantsErr.message); setLoading(false); return }

    const { data: responseRows, error: responsesErr } = await supabase
      .from('responses')
      .select('participant_id, question_id, selected_option, score_awarded, time_taken_ms, participants!inner(session_id)')
      .eq('participants.session_id', sessionId)
    if (responsesErr) { setLoadError(responsesErr.message); setLoading(false); return }

    const responseMap = {}
    for (const r of responseRows) {
      if (!responseMap[r.participant_id]) responseMap[r.participant_id] = {}
      responseMap[r.participant_id][r.question_id] = {
        selectedOption: r.selected_option,
        score: r.score_awarded,
      }
    }

    const rows = participantRows.map((p) => {
      const perQuestion = questionRows.map((q) => responseMap[p.id]?.[q.id] ?? null)
      const totalScore = perQuestion.reduce((sum, cell) => sum + (cell?.score ?? 0), 0)
      const answered = responseRows.filter((r) => r.participant_id === p.id)
      const avgTime = answered.length > 0
        ? answered.reduce((s, r) => s + (r.time_taken_ms ?? 0), 0) / answered.length
        : Infinity
      return {
        participantId: p.id,
        employeeCode: p.employee_code,
        firstName: p.first_name,
        lastName: p.last_name,
        perQuestion,
        totalScore,
        avgTime,
      }
    })

    rows.sort((a, b) => b.totalScore - a.totalScore || a.avgTime - b.avgTime)

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

    setQuiz(quizRow)
    setQuestions(questionRows)
    setResults(rows)
    setLoading(false)
  }

  function handleExportXlsx() {
    // Row 1 stays blank, matching the template's spacing
    const totalCols = 4 + questions.length + 2 // RM, First, Last, blank, Qs, Total, Rank
    const headerRow1 = new Array(totalCols).fill(null)
    const headerRow2 = [
      'RM Code', 'First name', 'Last Name', null,
      ...questions.map((_, i) => `Q${i + 1}`),
      'Total Marks', 'Rank',
    ]

    const dataRows = results.map((row) => [
      row.employeeCode,
      row.firstName,
      row.lastName,
      null,
      ...row.perQuestion.map((cell) => (cell === null ? '-' : cell.score)),
      row.totalScore,
      row.rank,
    ])

    const aoa = [headerRow1, headerRow2, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet2')
    XLSX.writeFile(wb, `${quiz.name.replace(/\s+/g, '_')}_results.xlsx`)
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#17140F] text-[#F6F1E6] font-sans">
        <p className="text-sm uppercase tracking-[0.15em] text-[#AB932B]/80">Loading results…</p>
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

  // Presentational-only derived stats for the hero panel; doesn't touch
  // stored results, ranking, or the export logic above.
  const maxPossible = questions.reduce((sum, q) => sum + (q.marks ?? 0), 0)
  const topScore = results[0]?.totalScore ?? 0
  const avgScore = results.length
    ? results.reduce((sum, r) => sum + r.totalScore, 0) / results.length
    : 0
  const topPct = maxPossible ? Math.round((topScore / maxPossible) * 100) : 0
  const avgPct = maxPossible ? Math.round((avgScore / maxPossible) * 100) : 0

  return (
    <div className="h-screen overflow-hidden bg-[#17140F] text-[#F6F1E6] font-sans flex flex-col">
      <main className="flex-1 min-h-0 grid grid-cols-[1.35fr_1fr] gap-5 p-5">
        {/* LEFT: full results table */}
        <section className="min-h-0 flex flex-col rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-[#AB932B]/15">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-1">Final Results</p>
              <h1 className="font-serif text-2xl">{quiz.name}</h1>
            </div>
            <p className="text-xs text-[#F6F1E6]/50">
              {results.length} participant{results.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-[#1E1B16] z-10">
                <tr className="text-left text-xs uppercase tracking-[0.1em] text-[#AB932B]/60">
                  <th className="px-6 py-3 font-medium">Rank</th>
                  <th className="px-3 py-3 font-medium">Employee Code</th>
                  <th className="px-3 py-3 font-medium">Name</th>
                  {questions.map((_, i) => (
                    <th key={i} className="px-3 py-3 font-medium">Q{i + 1}</th>
                  ))}
                  <th className="px-3 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.participantId} className="border-t border-[#F6F1E6]/5 hover:bg-[#17140F]/40">
                    <td className="px-6 py-2.5 font-medium text-[#AB932B]">{row.rank}</td>
                    <td className="px-3 py-2.5 text-[#F6F1E6]/70">{row.employeeCode}</td>
                    <td className="px-3 py-2.5">{row.firstName} {row.lastName}</td>
                    {row.perQuestion.map((cell, i) => (
                      <td key={i} className="px-3 py-2.5 text-[#F6F1E6]/60">
                        {cell === null ? '–' : `${cell.selectedOption} (${cell.score})`}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 font-semibold">{row.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: hero visual + summary stats */}
        <section className="relative rounded-2xl overflow-hidden border border-[#AB932B]/15">
          <img src={heroResults} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17140F] via-[#17140F]/55 to-[#17140F]/15" />

          <button
            onClick={handleExportXlsx}
            className="absolute top-5 right-5 z-20 flex items-center gap-2 rounded-xl bg-[#17140F]/60 backdrop-blur border border-[#AB932B]/30 px-4 py-2.5 text-xs uppercase tracking-[0.15em] text-[#F6F1E6]/90 hover:bg-[#17140F]/80 transition-colors"
          >
            Download .xlsx
          </button>

          <div className="relative h-full flex flex-col justify-between p-8">
            <div>
              <p className="font-serif text-5xl leading-none">{topScore}</p>
              <p className="text-sm text-[#F6F1E6]/60 mt-2">
                top score{maxPossible ? ` of ${maxPossible}` : ''}
              </p>
            </div>

            <div className="flex items-end gap-10">
              <div className="flex flex-col items-center gap-3">
                <div className="relative w-10 h-40 rounded-full bg-[#F6F1E6]/10 overflow-hidden flex items-end">
                  <div
                    className="w-full rounded-full bg-gradient-to-t from-[#AB932B] to-[#e0c469] transition-[height] duration-[1200ms] ease-out"
                    style={{ height: `${animatedTopPct}%` }}
                  />
                </div>
                <div className="text-center">
                  <p className="font-serif text-lg text-[#AB932B]">{topPct}%</p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-[#F6F1E6]/50">Top score</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-3">
                <div className="relative w-10 h-40 rounded-full bg-[#F6F1E6]/10 overflow-hidden flex items-end">
                  <div
                    className="w-full rounded-full bg-gradient-to-t from-[#925254] to-[#c98789] transition-[height] duration-[1200ms] delay-150 ease-out"
                    style={{ height: `${animatedAvgPct}%` }}
                  />
                </div>
                <div className="text-center">
                  <p className="font-serif text-lg text-[#c98789]">{avgPct}%</p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-[#F6F1E6]/50">Average</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}