import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../supabaseClient'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import HERO_IMAGE from '../assets/hero-dashboard.avif'

// Purely cosmetic count-up pattern
function AnimatedNumber({ value, suffix = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(value)) return
    const obj = { val: 0 }
    const tween = gsap.to(obj, {
      val: value,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: () => {
        if (ref.current) ref.current.textContent = `${Math.round(obj.val)}${suffix}`
      },
    })
    return () => tween.kill()
  }, [value, suffix])

  return <span ref={ref}>0{suffix}</span>
}

function StatCard({ label, value, suffix = '', text }) {
  return (
    <div className="bg-[#241F16] border border-[#925254]/30 rounded-2xl px-5 py-4 flex flex-col justify-center">
      <p className="text-xs tracking-[0.15em] uppercase text-[#AB932B] font-medium">{label}</p>
      {text !== undefined ? (
        <p className="mt-1 font-serif text-lg text-white truncate">{text}</p>
      ) : (
        <p className="mt-1 font-serif text-2xl text-white">
          <AnimatedNumber value={value} suffix={suffix} />
        </p>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { session } = useAuth()
  const navigate = useNavigate()

  const [quizzes, setQuizzes] = useState([])
  const [loadingQuizzes, setLoadingQuizzes] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [creatingSessionFor, setCreatingSessionFor] = useState(null)

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
    <div className="flex flex-col md:flex-row min-h-screen h-screen bg-[#17140F] overflow-hidden">
      
      {/* LEFT 50%: Container providing padding for the floating Welcome Card */}
      <div className="w-full md:w-1/2 h-2/5 md:h-full p-6 sm:p-8 flex flex-col">
        {/* The Card with Rounded Edges */}
        <div className="relative flex-1 w-full h-full overflow-hidden rounded-3xl border border-[#3A3226] p-8 sm:p-10 flex flex-col justify-between">
          <img src={HERO_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17140F] via-[#17140F]/30 to-[#17140F]/80" />

          <div className="relative z-10">
            <span className="text-xs tracking-[0.25em] uppercase text-[#AB932B] font-semibold">
              Quiz Master
            </span>
            <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-white tracking-wide">Welcome Back</h1>
            <p className="mt-2 text-sm text-white/70 font-light">{session?.user?.email}</p>
          </div>

          <div className="relative z-10 mt-auto">
            <button
              onClick={handleLogout}
              className="text-sm font-bold text-[#925254] hover:text-[#AB932B] transition uppercase tracking-widest"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT 50%: Content & Management Workspace (Scrollable) */}
      <div className="w-full md:w-1/2 h-3/5 md:h-full overflow-y-auto px-6 py-6 sm:py-8 sm:pr-8 space-y-8 custom-scrollbar">
        
        {/* Management Console deck */}
        <div className="bg-[#241F16] border border-[#3A3226] rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <p className="text-xs tracking-[0.15em] uppercase text-[#925254] font-semibold">Content Hub</p>
            <h3 className="font-serif text-xl text-white mt-1">Management Console</h3>
            <p className="text-sm text-white/50 mt-2 leading-relaxed">
              Deploy fresh materials, questions, or update interactive templates instantly.
            </p>
          </div>
          <button
            onClick={() => navigate('/upload')}
            className="mt-6 w-full rounded-lg bg-[#AB932B] px-5 py-3 text-sm font-medium text-white hover:bg-[#8F7A20] transition text-center shadow-lg"
          >
            Upload Questions
          </button>
        </div>

        {/* Mini Performance Cards */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Total Quizzes" value={quizzes.length} />
          <StatCard label="Latest Quiz" text={quizzes[0]?.name ?? '—'} />
        </div>

        {/* Compact Inventory List */}
        <div>
          <h2 className="font-serif text-lg text-white mb-4 tracking-wide">Your Quizzes</h2>

          {loadingQuizzes && <p className="text-xs text-white/50">Loading quizzes…</p>}
          {fetchError && <p className="text-xs text-[#925254]">{fetchError}</p>}
          {!loadingQuizzes && quizzes.length === 0 && (
            <p className="text-xs text-white/50">No quizzes yet. Upload one to get started.</p>
          )}

          <div className="space-y-3">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="flex items-center justify-between gap-4 bg-[#241F16] border border-[#3A3226] rounded-xl px-4 py-3.5 hover:border-[#925254]/30 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full border border-[#AB932B]/40 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-[#AB932B]">
                      {quiz.time_limit_seconds}s
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{quiz.name}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">
                      {new Date(quiz.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleCreateSession(quiz)}
                  disabled={creatingSessionFor === quiz.id}
                  className="flex-shrink-0 rounded-md bg-[#AB932B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#8F7A20] disabled:bg-[#443C29] disabled:text-white/40 transition"
                >
                  {creatingSessionFor === quiz.id ? 'Starting…' : 'Launch'}
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}