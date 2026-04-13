import { NextRequest, NextResponse } from 'next/server'

// Must match VALID_TOKEN in src/app/api/auth/login/route.ts
const VALID_TOKEN = '50e50a8e5f68e86974b62d73cd996b6cd67ab54b074fa146db3788dd1fbcc508'

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

  // Allow internal server-to-server requests (e.g. news-worker cron)
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    return NextResponse.next()
  }

  const token = req.cookies.get('cs_auth')?.value
  if (token !== VALID_TOKEN) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
