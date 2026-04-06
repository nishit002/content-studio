'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername]           = useState('')
  const [password, setPassword]           = useState('')
  const [captchaA, setCaptchaA]           = useState(0)
  const [captchaB, setCaptchaB]           = useState(0)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [showPass, setShowPass]           = useState(false)

  function refreshCaptcha() {
    setCaptchaA(randomInt(1, 15))
    setCaptchaB(randomInt(1, 15))
    setCaptchaAnswer('')
  }

  useEffect(() => { refreshCaptcha() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, captchaA, captchaB, captchaAnswer }),
      })
      const data = await res.json()
      if (res.ok) {
        router.push('/')
        router.refresh()
      } else {
        setError(data.error ?? 'Login failed')
        refreshCaptcha()
      }
    } catch {
      setError('Network error — please try again')
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold text-white tracking-tight">Content Studio</div>
          <div className="text-sm text-gray-400 mt-1">Sign in to continue</div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4"
        >
          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Enter username"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="Enter password"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Math captcha */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Verification: What is {captchaA} + {captchaB}?
            </label>
            <input
              type="number"
              value={captchaAnswer}
              onChange={e => setCaptchaAnswer(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Your answer"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-400 text-xs bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg py-2.5 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
