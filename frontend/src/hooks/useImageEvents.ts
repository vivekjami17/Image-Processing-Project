import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '../api/types';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to the server's image status stream (Server-Sent Events).
 * EventSource reconnects on its own; `onResync` fires after any reconnect because
 * events emitted while we were disconnected are gone and state must be refetched.
 */
export function useImageEvents(onEvent: (event: ServerEvent) => void, onResync: () => void): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  // Keep the latest callbacks without tearing down the connection on every render.
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  useEffect(() => {
    const source = new EventSource('/api/images/events');
    let hasConnected = false;

    const handle = (e: MessageEvent<string>) => {
      try {
        handlers.current.onEvent(JSON.parse(e.data) as ServerEvent);
      } catch {
        // Ignore malformed frames rather than breaking the stream.
      }
    };

    source.onopen = () => {
      setConnection('live');
      if (hasConnected) handlers.current.onResync();
      hasConnected = true;
    };
    source.onerror = () => setConnection('reconnecting');
    source.addEventListener('image.updated', handle);
    source.addEventListener('image.deleted', handle);
    source.addEventListener('resync', () => handlers.current.onResync());

    return () => source.close();
  }, []);

  return connection;
}
