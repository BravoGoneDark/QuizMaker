import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import * as XLSX from 'xlsx'

export default function ResultsScreen() {
  const { sessionId } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [quiz, setQuiz] = useState(null)
  const [questions, setQuestions] = useState([])
  const [results, setResults] = useState([])

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

  if (loading) return <div className="p-8">Loading results...</div>
  if (loadError) return <div className="p-8 text-red-600">Error: {loadError}</div>

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">{quiz.name} — Results</h1>
        <button
          onClick={handleExportXlsx}
          className="px-4 py-2 bg-green-600 text-white rounded text-sm"
        >
          Download .xlsx
        </button>
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Employee Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              {questions.map((_, i) => (
                <th key={i} className="px-3 py-2 text-left">Q{i + 1}</th>
              ))}
              <th className="px-3 py-2 text-left">Total</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.participantId} className="border-t">
                <td className="px-3 py-2">{row.rank}</td>
                <td className="px-3 py-2">{row.employeeCode}</td>
                <td className="px-3 py-2">{row.firstName} {row.lastName}</td>
                {row.perQuestion.map((cell, i) => (
                  <td key={i} className="px-3 py-2">
                    {cell === null ? '-' : `${cell.selectedOption} (${cell.score})`}
                  </td>
                ))}
                <td className="px-3 py-2 font-semibold">{row.totalScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}