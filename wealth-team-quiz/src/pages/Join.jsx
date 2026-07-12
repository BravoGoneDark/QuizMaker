import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import HERO_IMAGE from "../assets/hero-join.avif";

function FlourishDivider() {
  return (
    <svg
      width="72"
      height="16"
      viewBox="0 0 72 16"
      fill="none"
      className="text-[#925254]"
      aria-hidden="true"
    >
      <line x1="0" y1="8" x2="28" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M36 2L40 8L36 14L32 8L36 2Z"
        fill="currentColor"
      />
      <line x1="44" y1="8" x2="72" y2="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

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

    localStorage.setItem(
      `wtq_participant_${session.id}`,
      JSON.stringify({ participantId, employeeCode: employeeCode.trim() })
    )

    navigate(`/play/${session.id}`)
  }

  return (
    <div className="min-h-screen w-full p-4 md:p-6 lg:p-10 flex items-center justify-center font-sans antialiased relative bg-[#925254]">
      
      {/* Container card viewport */}
      <div className="w-full max-w-[92vw] min-h-[90vh] grid grid-cols-1 lg:grid-cols-12 bg-white rounded-[40px] overflow-hidden shadow-2xl relative z-10">
        
        {/* Left Side Panel - Abstract Image restored inside the card with the tilted partition (/) */}
        <div 
          className="hidden lg:block lg:col-span-6 relative bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: `url(${HERO_IMAGE})`,
            clipPath: 'polygon(0 0, 100% 0, 82% 100%, 0 100%)'
          }}
        >
          {/* Subtle overlay directly on the graphic to bring out the white text legibility */}
          <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-black/10" />

          <div className="absolute bottom-16 left-16 max-w-md z-10">
            <p className="text-3xl font-light tracking-wide text-white leading-snug drop-shadow-md">
              Take your seat.
              <br />
              <span className="font-semibold">The quiz is ready.</span>
            </p>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="col-span-1 lg:col-span-6 flex flex-col justify-between p-8 lg:p-20 relative lg:-ml-[10%] z-20">
          
          {/* Core Form Area */}
          <div className="w-full max-w-md mx-auto my-auto py-8">
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-gray-900 text-center lg:text-left">
              Welcome Back
            </h1>
            <p className="mt-2 text-sm text-gray-400 font-medium text-center lg:text-left">
              Welcome to the interactive team platform
            </p>

            <form onSubmit={handleJoin} className="mt-10 space-y-4">
              <div>
                <input
                  type="text"
                  required
                  placeholder="Employee Code"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/5 focus:border-gray-900 transition-all text-sm shadow-sm"
                />
              </div>

              <div>
                <input
                  type="text"
                  required
                  placeholder="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/5 focus:border-gray-900 transition-all text-sm shadow-sm"
                />
              </div>

              <div>
                <input
                  type="text"
                  required
                  placeholder="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/5 focus:border-gray-900 transition-all text-sm shadow-sm"
                />
              </div>

              {errorMsg && (
                <div className="flex items-center gap-2 text-xs font-semibold text-[#E53E3E] bg-red-50 p-3 rounded-lg border border-red-100 mt-2">
                  <FlourishDivider />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={status === 'joining'}
                  className="w-full rounded-xl bg-[#AB932B] hover:bg-[#8F7A20] active:scale-[0.99] px-4 py-3.5 text-white font-semibold tracking-wide text-sm shadow-lg shadow-yellow-600/10 disabled:bg-gray-200 disabled:text-gray-400 disabled:scale-100 transition-all cursor-pointer"
                >
                  {status === 'joining' ? 'Connecting to Room...' : 'Login'}
                </button>
              </div>
            </form>
          </div>

          <div className="h-4 hidden lg:block" />
        </div>

      </div>
    </div>
  )
}