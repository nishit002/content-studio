import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/logout — clear session cookie and redirect to login
export async function GET(req: NextRequest) {
  const url = new URL('/login', req.url)
  const res = NextResponse.redirect(url)
  res.cookies.set('cs_auth', '', { maxAge: 0, path: '/' })
  return res
}
