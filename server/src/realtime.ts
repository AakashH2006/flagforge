import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { corsOrigins } from './config.js';

/**
 * The live scoreboard channel. A client connects with `?eventId=<uuid>` and is put in that
 * event's room; every scoreboard rebuild is pushed to the room as `UPDATE_SCOREBOARD`.
 *
 * The scoreboard is public, so the socket needs no token. Nothing private goes over it: the
 * payload is the same one `GET /api/events/:eventId/scoreboard` returns to anyone.
 */

export const SCOREBOARD_EVENT = 'UPDATE_SCOREBOARD';

const eventRoom = (eventId: string) => `event:${eventId}`;

let io: Server | undefined;

export function createRealtime(
  httpServer: HttpServer,
  options: { snapshot: (eventId: string) => Promise<unknown | null> },
): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins },
    serveClient: false,
  });

  io.on('connection', async (socket) => {
    const eventId = z.uuid().safeParse(socket.handshake.query.eventId);
    if (!eventId.success) {
      socket.emit('subscribe_error', 'Connect with a valid ?eventId= query parameter');
      socket.disconnect(true);
      return;
    }

    await socket.join(eventRoom(eventId.data));
    try {
      // Send the current standings straight away, so a client that connects mid-event doesn't
      // sit empty until the next solve.
      const snapshot = await options.snapshot(eventId.data);
      if (snapshot && socket.connected) socket.emit(SCOREBOARD_EVENT, snapshot);
    } catch {
      // The client also loads the scoreboard over HTTP, so a failed snapshot is not fatal.
    }
  });

  return io;
}

export function emitScoreboard(eventId: string, payload: unknown): void {
  io?.to(eventRoom(eventId)).emit(SCOREBOARD_EVENT, payload);
}

/** Number of clients watching an event. Used by tests and useful for a future organizer view. */
export async function watcherCount(eventId: string): Promise<number> {
  const sockets = await io?.in(eventRoom(eventId)).fetchSockets();
  return sockets?.length ?? 0;
}

export async function closeRealtime(): Promise<void> {
  const current = io;
  io = undefined;
  await new Promise<void>((resolve) => (current ? current.close(() => resolve()) : resolve()));
}
