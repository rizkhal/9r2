import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ icons */

const paths = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  download: <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l.9 1.2h7.3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />,
  link: <path d="M10 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1M14 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" />,
  pencil: <path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z" />,
  trash: <path d="M4 7h16M9 7V5h6v2M6.5 7l.8 13h9.4l.8-13M10 11v6M14 11v6" />,
  star: <path d="m12 4 2.4 5.1 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8L12 4Z" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.4} />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  monitor: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  copy: <path d="M8 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  external: <path d="M14 5h5v5M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  restore: <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4" />,
  logout: <path d="M15 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9M13 12h8m0 0-3.5-3.5M21 12l-3.5 3.5" />,
  database: <path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  up: <path d="M12 19V5m0 0-5 5m5-5 5 5" />,
  down: <path d="M12 5v14m0 0 5-5m-5 5-5-5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  key: <><circle cx="15" cy="9" r="4" /><path d="m12.2 11.8-8.2 8.2v0M7.5 17.5l2 2" /></>,
  share: <><circle cx="17" cy="6" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="m9 10.8 5.5-3.2M9 13.2l5.5 3.2" /></>,
}

export type IconName = keyof typeof paths

export function Icon({
  name,
  className,
  filled,
}: {
  name: IconName
  className?: string
  filled?: boolean
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('size-4 shrink-0', className)}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

/* ---------------------------------------------------------------- buttons */

const variants = {
  primary: 'border border-transparent bg-accent text-on-accent hover:brightness-[1.08]',
  quiet: 'border border-line bg-surface text-ink hover:border-line2 hover:bg-raise',
  ghost: 'border border-transparent text-muted hover:bg-raise hover:text-ink',
  danger: 'border border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft',
}

const sizes = {
  sm: 'h-8 gap-1.5 px-2.5 text-[12.5px]',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
  icon: 'size-8',
}

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({ variant = 'quiet', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-control font-medium transition duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
    />
  )
}

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-9 w-full rounded-control border border-line bg-surface px-3 text-[13px] text-ink transition-colors placeholder:text-faint focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:opacity-50',
        className,
      )}
    />
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] leading-relaxed text-faint">{hint}</span> : null}
    </label>
  )
}

/* --------------------------------------------------------------- surfaces */

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-panel border border-line bg-surface', className)}>{children}</section>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-faint', className)}>
      {children}
    </p>
  )
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Bar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
  return (
    <div className={cx('h-[3px] w-full overflow-hidden rounded-full bg-line', className)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'notice'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-control border px-3 py-2 text-[12.5px] leading-relaxed',
        tone === 'error' ? 'border-danger/25 bg-danger-soft text-danger' : 'border-accent/25 bg-accent/8 text-accent',
      )}
    >
      {children}
    </p>
  )
}

export function EmptyState({
  icon = 'folder',
  title,
  body,
  action,
}: {
  icon?: IconName
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-full border border-dashed border-line2 text-faint">
        <Icon name={icon} className="size-[18px]" />
      </span>
      <p className="mt-4 text-[14px] font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-[38ch] text-[12.5px] leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ glyph */

function extension(name: string) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  return ext && ext.length <= 5 ? ext.toUpperCase() : 'FILE'
}

export function Glyph({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-[6px] border border-line bg-raise font-mono text-[9px] font-semibold tracking-wide text-muted',
        className,
      )}
    >
      {extension(name)}
    </span>
  )
}

/* ------------------------------------------------------------------- menu */

type MenuChild = { label: string; onSelect: () => void }
export type MenuEntry =
  | 'separator'
  | {
      label: string
      onSelect?: () => void
      icon?: IconName
      danger?: boolean
      children?: MenuChild[]
    }

const MENU_WIDTH = 216

export function Menu({ items, label = 'More options' }: { items: MenuEntry[]; label?: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const [sub, setSub] = useState<{ title: string; items: MenuChild[] } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  function close() {
    setAt(null)
    setSub(null)
  }

  function open() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    setSub(null)
    setAt({
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
      top: rect.bottom + 6,
    })
  }

  // Flip above the trigger when there is no room below.
  useLayoutEffect(() => {
    if (!at || !panel.current) return
    const height = panel.current.offsetHeight
    const limit = window.innerHeight - height - 8
    if (at.top > limit) {
      const rect = trigger.current?.getBoundingClientRect()
      setAt({ ...at, top: Math.max(8, (rect?.top ?? at.top) - height - 6) })
    }
  }, [at])

  useEffect(() => {
    if (!at) return
    function onDown(event: MouseEvent) {
      const target = event.target as Node
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      setAt(null)
      setSub(null)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (sub) setSub(null)
      else setAt(null)
    }
    function onScroll() {
      setAt(null)
      setSub(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [at, sub])

  function pick(item: MenuEntry) {
    if (item === 'separator') return
    if (item.children) {
      setSub({ title: item.label, items: item.children })
      return
    }
    close()
    item.onSelect?.()
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={label}
        title={label}
        onClick={() => (at ? close() : open())}
        className="size-7 text-faint hover:text-ink"
      >
        <Icon name="more" className="size-4" />
      </Button>

      {at
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              style={{ left: at.left, top: at.top, width: MENU_WIDTH, maxHeight: 'calc(100dvh - 16px)' }}
              className="pop fixed z-50 overflow-y-auto rounded-panel border border-line bg-surface p-1 shadow-[0_18px_44px_-16px_rgba(30,20,12,0.45)]"
            >
              {sub ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSub(null)}
                    className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-faint transition-colors hover:bg-raise hover:text-ink"
                  >
                    <Icon name="chevron" className="size-3 rotate-180" />
                    {sub.title}
                  </button>
                  <div className="my-1 h-px bg-line" />
                  <div className="max-h-64 overflow-y-auto">
                    {sub.items.map((child) => (
                      <button
                        key={child.label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close()
                          child.onSelect()
                        }}
                        className="flex w-full items-center rounded-[5px] px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-raise"
                      >
                        <span className="truncate">{child.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                items.map((item, index) =>
                  item === 'separator' ? (
                    <div key={`sep-${index}`} className="my-1 h-px bg-line" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => pick(item)}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[12.5px] transition-colors',
                        item.danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-raise',
                      )}
                    >
                      {item.icon ? <Icon name={item.icon} className="size-3.5 text-faint" /> : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.children ? <Icon name="chevron" className="size-3 text-faint" /> : null}
                    </button>
                  ),
                )
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
