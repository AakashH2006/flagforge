import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ScoreboardPage } from './pages/ScoreboardPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<EventsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="events/:eventId"
          element={
            <RequireAuth>
              <EventPage />
            </RequireAuth>
          }
        />
        {/* Public: spectators can watch the standings without an account. */}
        <Route path="events/:eventId/scoreboard" element={<ScoreboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
