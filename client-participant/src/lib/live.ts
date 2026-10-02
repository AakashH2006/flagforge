import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Scoreboard } from './types';

/**
 * The live scoreboard feed. The server pushes the whole standings on connect and again after
 * every solve, so there is no polling and no patching of partial updates to get wrong.
 *
 * In development Vite proxies /socket.io to the API, so the socket runs on the page's own origin.
 * A build served from somewhere else connects to VITE_API_URL, the same origin the REST calls use.
 */
const SOCKET_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '') || undefined;

export const SCOREBOARD_EVENT = 'UPDATE_SCOREBOARD';

export type LiveScoreboard = { scoreboard?: Scoreboard; connected: boolean };

export function useLiveScoreboard(eventId: string | null): LiveScoreboard {
  const [scoreboard, setScoreboard] = useState<Scoreboard>();
  const [connected, setConnected] = useState(false);
  // Kept in a ref so a late or duplicated push can be compared without re-subscribing.
  const latest = useRef<string>('');

  useEffect(() => {
    if (!eventId) return;
    latest.current = '';
    const socket: Socket = io(SOCKET_URL, { query: { eventId } });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on(SCOREBOARD_EVENT, (payload: Scoreboard) => {
      if (payload.eventId !== eventId || payload.updatedAt < latest.current) return;
      latest.current = payload.updatedAt;
      setScoreboard(payload);
    });

    return () => {
      socket.close();
      setConnected(false);
      setScoreboard(undefined);
    };
  }, [eventId]);

  return { scoreboard, connected };
}

/** True for a moment after `value` changes. Used to flash a score that just moved. */
export function useRecentlyChanged(value: unknown, ms = 1400): boolean {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
    const id = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(id);
  }, [value, ms]);

  return changed;
}

/**
 * Calls `reload` when `trigger` changes, but at most once every `ms`. The standings arrive over
 * the socket; the graph behind them is a separate request, and a busy event should not refetch it
 * on every solve.
 */
export function useThrottledReload(trigger: unknown, reload: () => void, ms = 10_000) {
  const lastRun = useRef(0);
  const firstTrigger = useRef(trigger);
  const latestReload = useRef(reload);
  latestReload.current = reload;

  useEffect(() => {
    if (trigger === firstTrigger.current) return;
    const wait = Math.max(0, lastRun.current + ms - Date.now());
    const id = setTimeout(() => {
      lastRun.current = Date.now();
      latestReload.current();
    }, wait);
    return () => clearTimeout(id);
  }, [trigger, ms]);
}

/** Honours the viewer's reduced-motion setting, so rank changes don't animate against their wishes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
