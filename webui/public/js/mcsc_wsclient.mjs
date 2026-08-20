/** 現在開いているWebUIと同一オリジンのWebSocket接続先を組み立てる。 */
const getWebSocketURL = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${window.location.host}/ws`;
};

/** HTTPセッションを使って、単発利用のWebSocket接続チケットを取得する。 */
const requestWebSocketTicket = async () => {
  const response = await fetch('/api/auth/ws-ticket', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('WebSocket 接続チケットを取得できませんでした。');
  }

  const ticketInfo = await response.json();

  if (
    typeof ticketInfo !== 'object'
    || ticketInfo === null
    || ticketInfo.protocol !== 'mcsc-v1'
    || typeof ticketInfo.ticket !== 'string'
  ) {
    throw new Error('WebSocket 接続チケットの形式が不正です。');
  }

  return ticketInfo;
};

/**
 * 接続チケットを取得してWebSocketを確立し、受信JSONを呼出元のハンドラへ渡す。
 * 接続確立前の失敗は Promise の reject として返す。
 */
export const connectMCSCWebSocket = async ({
  onClose,
  onMessage,
}) => {
  const ticketInfo = await requestWebSocketTicket();

  return new Promise((resolve, reject) => {
    let opened = false;

    const socket = new WebSocket(
      getWebSocketURL(),
      [ticketInfo.protocol, ticketInfo.ticket],
    );

    socket.addEventListener('open', () => {
      opened = true;
      resolve(socket);
    }, { once: true });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;

      try {
        const message = JSON.parse(event.data);

        if (typeof message === 'object' && message !== null) {
          onMessage(message);
        }
      } catch {
        // サーバーからの不正JSONは、ガン無視決め込んで無停止！
      }
    });

    socket.addEventListener('error', () => {
      if (!opened) {
        reject(new Error('WebSocket を接続できませんでした。'));
      }
    });

    socket.addEventListener('close', (event) => {
      onClose(event);

      if (!opened) {
        reject(new Error('WebSocket 接続が確立する前に閉じられました。'));
      }
    });
  });
};
