import { NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'

const links = [
  { to: '/', label: 'All files', end: true },
  { to: '/shared', label: 'Shared links' },
  { to: '/trash', label: 'Trash' },
  { to: '/storage', label: 'Storage' },
  { to: '/api-keys', label: 'API keys' },
]

export function Layout() {
  const { user, logout } = useSession()

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b border-slate-200 p-4 md:w-60 md:border-b-0 md:border-r dark:border-slate-800">
        <p className="mb-4 text-lg font-semibold tracking-tight">9r2</p>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 px-6 py-3 dark:border-slate-800">
          <span className="truncate text-sm text-slate-500">{user?.email}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
