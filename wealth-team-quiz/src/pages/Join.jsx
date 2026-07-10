import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Join() {
  const { token } = useParams()
  const navigate = useNavigate()

  const [employeeCode, setEmployeeCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [status, setStatus] = useState('idle') // idle | joining | error
  const [errorMsg, setErrorMsg] = useState('')

  async function handleJoin(e) {
    e.preventDefault()
    setStatus('joining')
    setErrorMsg('')

    // 1. Find the session by its join token
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('join_token', token)
      .single()

    if (sessionErr || !session) {
      setStatus('error')
      setErrorMsg('This quiz link is invalid.')
      return
    }

    if (session.status === 'ended') {
      setStatus('error')
      setErrorMsg('This quiz has already ended.')
      return
    }

    // 2. Look up an existing participant with this employee_code in
    // this session first (resume case), rather than always inserting.
    const { data: existing, error: lookupErr } = await supabase
      .from('participants')
      .select('id')
      .eq('session_id', session.id)
      .eq('employee_code', employeeCode.trim())
      .maybeSingle()

    if (lookupErr) {
      setStatus('error')
      setErrorMsg(lookupErr.message)
      return
    }

    let participantId = existing?.id

    if (!participantId) {
      // 3. No existing row -- create a new participant
      const { data: created, error: insertErr } = await supabase
        .from('participants')
        .insert({
          session_id: session.id,
          employee_code: employeeCode.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          joined_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (insertErr) {
        setStatus('error')
        setErrorMsg(insertErr.message)
        return
      }
      participantId = created.id
    }

    // Store just enough to identify this participant on the next
    // screen and across refreshes. This is a real deployed app (not
    // a Claude artifact), so localStorage is fine here.
    localStorage.setItem(
      `wtq_participant_${session.id}`,
      JSON.stringify({ participantId, employeeCode: employeeCode.trim() })
    )

    navigate(`/play/${session.id}`)
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-12 space-y-6">
      <h1 className="text-xl font-semibold">Join Quiz</h1>

      <form onSubmit={handleJoin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Employee Code</label>
          <input
            type="text"
            required
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">First Name</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Last Name</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

        <button
          type="submit"
          disabled={status === 'joining'}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
        >
          {status === 'joining' ? 'Joining...' : 'Join Quiz'}
        </button>
      </form>
    </div>
  )
}