import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const SECRET = '1964329cc06753b304c1fff6d1156bfd1374b23b79a3235743a2d06ad661dfb1'

function isValidToken(token: string): boolean {
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow: login page, auth API, Next.js internals, static files
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const token = req.cookies.get('cs_auth')?.value
  if (!token || !isValidToken(token)) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
