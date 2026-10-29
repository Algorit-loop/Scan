import { useEffect, useRef, useState } from 'react';

import { say } from '../feedback/announcer';
import { MESSAGES } from '../guidance/messages.vi';
import { getServerHost, ServerClient, type ServerStatus } from '../server/serverClient';

/** Mở kết nối tới server khi màn quét hiện ra, đóng khi rời đi; báo bằng giọng nói khi mất/có lại. */
export function useServerConnection() {
  const client = useRef<ServerClient | null>(null);
  const [status, setStatus] = useState<ServerStatus>('connecting');

  useEffect(() => {
    const host = getServerHost();
    if (!host) {
      setStatus('offline');
      return;
    }
    let alive = true;
    let wasOnline = false;
    const c = new ServerClient(host, (s) => {
      if (!alive) return;
      setStatus(s);
      if (s === 'online') {
        if (wasOnline) say(MESSAGES.serverBack);
        wasOnline = true;
      } else if (s === 'offline' && wasOnline) {
        say(MESSAGES.serverLost);
      }
    });
    client.current = c;
    c.connect();
    return () => {
      alive = false;
      c.close();
      client.current = null;
    };
  }, []);

  return { client, status };
}
