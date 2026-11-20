import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useSession } from './lib/session'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { FilesPage } from './pages/FilesPage'
import { LoginPage } from './pages/LoginPage'
import { PublicFilePage } from './pages/PublicFilePage'
import { SharedPage } from './pages/SharedPage'
import { StoragePage } from './pages/StoragePage'
import { TrashPage } from './pages/TrashPage'

function RequireAuth() {
  const { user, loading } = useSession()

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <span className="animate-pulse font-mono text-[13px] tracking-[0.3em] text-faint">9R2</span>
      </div>
    )
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/f/:token" element={<PublicFilePage />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<FilesPage />} />
          <Route path="shared" element={<SharedPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
