import { Suspense, lazy, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './index.css'
import { queryClient } from './lib/queryClient'
import { AuthProvider, useAuth } from './contexts'
import { createNewThreadId } from './services/threadService'

const App = lazy(() => import('./App'))
const IndexPage = lazy(() =>
  import('./pages/IndexPage').then((module) => ({ default: module.IndexPage }))
)
const GraphPage = lazy(() =>
  import('./pages/GraphPage').then((module) => ({ default: module.GraphPage }))
)
const CaseExtractionPage = lazy(() =>
  import('./pages/CaseExtractionPage').then((module) => ({ default: module.CaseExtractionPage }))
)
// 重定向组件：访问 /chat 时自动重定向到 /chat/:threadId
function ChatRedirect() {
  // 使用 useMemo 确保在 StrictMode 下也只生成一次 ID
  const newThreadId = useMemo(() => createNewThreadId(), []);
  return <Navigate to={`/chat/${newThreadId}`} replace state={{ isNewThread: true }} />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return (
      <Navigate
        to="/"
        replace
        state={{ from: location.pathname + location.search, showLogin: true }}
      />
    );
  }

  return children;
}

function LoginRoute() {
  const location = useLocation();
  const targetPath = (location.state as { from?: string } | null)?.from || "/";
  return <Navigate to="/" replace state={{ from: targetPath, showLogin: true }} />;
}

function AuthSessionSync() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  useEffect(() => {
    queryClient.clear();
  }, [currentUser?.id, queryClient]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <AuthSessionSync />
        <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/" element={<IndexPage />} />
            <Route path="/graph" element={<RequireAuth><GraphPage /></RequireAuth>} />
            <Route path="/case-extraction" element={<RequireAuth><CaseExtractionPage /></RequireAuth>} />
            <Route path="/chat" element={<RequireAuth><ChatRedirect /></RequireAuth>} />
            <Route path="/chat/:threadId" element={<RequireAuth><App /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>,
)
