import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Icon, Input } from '../components/ui'
import { api } from '../lib/api'
import { useSession } from '../lib/session'

const specs = [
  { label: 'Endpoints', value: 'R2 · any S3' },
  { label: 'Routing', value: 'free space · round robin · priority' },
  { label: 'Access', value: 'session cookie · bearer keys' },
]

export function LoginPage() {
  const { refresh } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/login', { body: { email, password } })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-12 lg:flex">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />

        <div className="relative flex items-baseline gap-2">
          <span className="font-mono text-[15px] font-semibold tracking-[-0.02em]">9r2</span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-faint">storage console</span>
        </div>

        <div className="relative max-w-[26rem]">
          <h1 className="text-[46px] font-medium leading-[1.04] tracking-[-0.035em] text-ink">
            Every bucket, one address.
          </h1>
          <p className="mt-5 max-w-[36ch] text-[13.5px] leading-relaxed text-muted">
            Uploads, folders, share links and quotas across every R2 and S3 account you run, behind a single
            sign-in.
          </p>
        </div>

        <dl className="relative max-w-sm space-y-2.5 border-t border-line pt-5">
          {specs.map((spec) => (
            <div key={spec.label} className="flex items-baseline gap-4">
              <dt className="w-20 shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                {spec.label}
              </dt>
              <dd className="font-mono text-[11px] text-muted">{spec.value}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="rise w-full max-w-[352px]">
          <div className="mb-8 lg:hidden">
            <span className="font-mono text-[15px] font-semibold tracking-[-0.02em]">9r2</span>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Sign in</p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink">Welcome back</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            This deployment has a single account. Use the credentials set in your environment.
          </p>

          <div className="mt-7 space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </Field>
          </div>

          {error ? (
            <div className="mt-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}

          <Button type="submit" variant="primary" disabled={busy} className="mt-6 w-full">
            {busy ? 'Signing in…' : 'Sign in'}
            {busy ? null : <Icon name="chevron" className="size-3.5" />}
          </Button>

          <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            credentials are compared server-side
          </p>
        </form>
      </main>
    </div>
  )
}
