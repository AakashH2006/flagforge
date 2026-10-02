import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Banner, PageLoader } from './components/ui';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The whole dashboard is organizers only. The API would refuse a player's token anyway, but
 * saying so here is friendlier than a wall of 403s.
 */
function RequireOrganizer({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== 'admin') {
    return (
      <Banner tone="warning" title="This dashboard is for organizers">
        You are signed in as <strong>{user.username}</strong>, a player account. Sign out and use an organizer
        account, or head to the player site to compete.
      </Banner>
    );
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <RequireOrganizer>
              <EventsPage />
            </RequireOrganizer>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="events/:eventId"
          element={
            <RequireOrganizer>
              <EventPage />
            </RequireOrganizer>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
