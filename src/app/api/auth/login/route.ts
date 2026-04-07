import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const SECRET     = '1964329cc06753b304c1fff6d1156bfd1374b23b79a3235743a2d06ad661dfb1'
const ADMIN_USER = 'fmcteam'
const ADMIN_PASS = 'fmccontent123'
const COOKIE_TTL = 7 * 24 * 60 * 60  // 7 days in seconds

/** Constant-time string comparison (pads both to 200 chars). */
function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a.padEnd(200).slice(0, 200))
  const bBuf = Buffer.from(b.padEnd(200).slice(0, 200))
  return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length
}

/** Create a signed auth token: "payload.hmac" */
function createToken(): string {
  const payload = `admin.${Date.now()}`
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
  return `${payload}.${sig}`
}

/** Verify a signed auth token. */
export function verifyToken(token: string): boolean {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig     = token.slice(dot + 1)
  try {
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
    const a = Buffer.from(sig.padEnd(64, '0').slice(0, 64), 'hex')
    const b = Buffer.from(expected, 'hex')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// POST /api/auth/login — validate credentials + captcha, set cookie
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
  res.cookies.set('cs_auth', createToken(), {
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
