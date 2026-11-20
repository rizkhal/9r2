import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = '9r2-theme'
const QUERY = '(prefers-color-scheme: dark)'

function resolve(mode: ThemeMode) {
  if (mode !== 'system') return mode
  return window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

/** `data-theme` on <html> is set before paint by an inline script in index.html; this keeps it in sync. */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(KEY)
      return stored === 'light' || stored === 'dark' ? stored : 'system'
    } catch {
      return 'system'
    }
  })

  const apply = useCallback((next: ThemeMode) => {
    document.documentElement.dataset.theme = resolve(next)
  }, [])

  useEffect(() => {
    apply(mode)
    if (mode !== 'system') return
    const media = window.matchMedia(QUERY)
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode, apply])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Private mode: the theme just won't persist.
    }
  }, [])

  return { mode, setMode }
}
