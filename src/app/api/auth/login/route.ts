import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// Static credentials
const ADMIN_USER = 'fmcteam'
const ADMIN_PASS = 'fmccontent123'
const COOKIE_TTL = 7 * 24 * 60 * 60  // 7 days

// Pre-computed session token — same value used in middleware.ts
// If you change this, change it in middleware.ts too and users must re-login.
export const VALID_TOKEN = '50e50a8e5f68e86974b62d73cd996b6cd67ab54b074fa146db3788dd1fbcc508'

/** Constant-time string comparison (pads both to 200 chars). */
function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a.padEnd(200).slice(0, 200))
  const bBuf = Buffer.from(b.padEnd(200).slice(0, 200))
  return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length
}

// POST /api/auth/login — validate credentials + captcha, set session cookie
export async function POST(req: NextRequest) {
  const { username = '', password = '', captchaA, captchaB, captchaAnswer } = await req.json()

  // Validate math captcha
  const a   = parseInt(captchaA,      10)
  const b   = parseInt(captchaB,      10)
  const ans = parseInt(captchaAnswer, 10)
  if (isNaN(a) || isNaN(b) || isNaN(ans) || a + b !== ans) {
    return NextResponse.json({ error: 'Wrong answer to the maths question' }, { status: 400 })
  }

  // Validate credentials
  if (!safeEq(username, ADMIN_USER) || !safeEq(password, ADMIN_PASS)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('cs_auth', VALID_TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_TTL,
    path: '/',
  })
  return res
}

// GET /api/auth/logout — clear cookie and redirect to login
export async function GET(req: NextRequest) {
  const url = new URL('/login', req.url)
  const res = NextResponse.redirect(url)
  res.cookies.set('cs_auth', '', { maxAge: 0, path: '/' })
  return res
}
