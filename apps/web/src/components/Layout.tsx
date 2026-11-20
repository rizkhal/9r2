import { Link, NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useTheme, type ThemeMode } from '../lib/theme'
import { Button, Icon, cx } from './ui'

const links = [
  { to: '/', label: 'Files', end: true },
  { to: '/shared', label: 'Shared' },
  { to: '/trash', label: 'Trash' },
  { to: '/storage', label: 'Storage' },
  { to: '/api-keys', label: 'API keys' },
]

const themeOrder: ThemeMode[] = ['system', 'light', 'dark']
const themeIcon = { system: 'monitor', light: 'sun', dark: 'moon' } as const

function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const next = themeOrder[(themeOrder.indexOf(mode) + 1) % themeOrder.length] ?? 'system'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setMode(next)}
      title={`Theme: ${mode}. Switch to ${next}.`}
      aria-label={`Theme: ${mode}. Switch to ${next}.`}
    >
      <Icon name={themeIcon[mode]} className="size-4" />
    </Button>
  )
}

export function Layout() {
  const { user, logout } = useSession()

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-[12px] focus:font-medium focus:text-canvas"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-5">
          <Link to="/" className="flex shrink-0 items-baseline gap-2" aria-label="9r2 home">
            <span className="font-mono text-[15px] font-semibold tracking-[-0.02em]">9r2</span>
            <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.2em] text-faint sm:inline">
              storage
            </span>
          </Link>

          <nav aria-label="Sections" className="flex flex-1 items-center overflow-x-auto">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cx(
                    'relative flex h-14 shrink-0 items-center px-2.5 text-[12.5px] font-medium transition-colors sm:px-3',
                    isActive ? 'text-ink' : 'text-muted hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {link.label}
                    <span
                      className={cx(
                        'absolute inset-x-2.5 bottom-0 h-[1.5px] rounded-full transition-opacity sm:inset-x-3',
                        isActive ? 'bg-accent opacity-100' : 'opacity-0',
                      )}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 hidden max-w-[190px] truncate font-mono text-[11px] text-faint lg:block">
              {user?.email}
            </span>
            <ThemeToggle />
            <Button type="button" variant="ghost" size="sm" onClick={() => void logout()} title="Sign out">
              <Icon name="logout" className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main id="content" className="mx-auto w-full max-w-[1280px] flex-1 px-5 pb-20 pt-8 md:pt-10">
        <Outlet />
      </main>
    </div>
  )
}
