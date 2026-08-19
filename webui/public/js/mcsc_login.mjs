'use strict';

import { connectMCSCWebSocket } from './mcsc_wsclient.mjs';

const authenticatedPanel = document.querySelector('#authed-panel');
const authenticatedUser = document.querySelector('#authed-user');
const loadingPanel = document.querySelector('#loading-panel');
const loginForm = document.querySelector('#login-form');
const loginSubmit = document.querySelector('#login-submit');
const loginPanel = document.querySelector('#login-panel');
const notice = document.querySelector('#notice');
const passwordInput = document.querySelector('#password');
const usernameInput = document.querySelector('#username');
const webSocketStatus = document.querySelector('#ws-status');
const serverList = document.querySelector('#server-list');
const serverPanel = document.querySelector('#server-panel');
const logoutSubmit = document.querySelector('#logout-submit');
const WebSocketReconnectDelayMs = 3 * 1000; // 3 sec
let shouldMaintainWebSocket = false;
let reconnectTimer = null;

const setNotice = (message) => {
  notice.textContent = message;
};

let activeWebSocket = null;
const serverCards = new Map();
const MaxConsoleEntries = 400;
let webSocketConnecting = false;

const setWebSocketStatus = (message) => {
  webSocketStatus.textContent = message;
};

const sendWebSocketTell = (tell) => {
  if (
    activeWebSocket === null
    || activeWebSocket.readyState !== WebSocket.OPEN
  ) {
    setNotice('WebSocket が接続されていません。');
    return false;
  }

  try {
    activeWebSocket.send(JSON.stringify(tell));
    return true;
  } catch {
    setNotice('WebSocket への送信に失敗しました。');
    return false;
  }
};

const submitCommandBatch = (serverId, commandInput, commandNotice) => {
  const cmds = commandInput.value
    .split(/\r?\n/)
    .filter((command) => command.trim().length > 0);

  if (cmds.length === 0) {
    commandNotice.textContent = 'コマンドを入力してください。';
    return;
  }

  if (cmds.length > 32) {
    commandNotice.textContent = '一度に送信できるコマンドは 32 件までです。';
    return;
  }

  const tell = {
    type: 'command-batch',
    serverId: serverId,
    cmds: cmds,
  };

  if (new TextEncoder().encode(JSON.stringify(tell)).byteLength > 4 * 1024) {
    commandNotice.textContent = 'コマンド内容が大きすぎます。';
    return;
  }

  if (!sendWebSocketTell(tell)) {
    commandNotice.textContent = 'コマンドを送信できませんでした。';
    return;
  }

  commandInput.value = '';
  commandNotice.textContent = `${cmds.length} 件のコマンドを送信しました。`;
};

const createStatusRow = (labelText) => {
  const row = document.createElement('p');
  const label = document.createElement('strong');
  const value = document.createElement('span');

  label.textContent = `${labelText}: `;
  value.textContent = '取得中';

  row.append(label, value);

  return { row, value };
};

const updateServerControlButtons = (cardInfo, status) => {
  const canStart = !status.processAlive && !(
    status.status === 'DEPLETED' && status.maintenance
  );

  cardInfo.startButton.disabled = !canStart;
  cardInfo.stopButton.disabled = status.status !== 'RUNNING';
  cardInfo.restartButton.disabled = status.status !== 'RUNNING';
};

const submitServerControl = (serverId, action) => {
  const cardInfo = serverCards.get(serverId);

  if (typeof cardInfo === 'undefined') return;

  const sent = sendWebSocketTell({
    type: 'server-control',
    serverId: serverId,
    action: action,
  });

  if (!sent) {
    cardInfo.controlNotice.textContent = 'サーバー操作を送信できませんでした。';
    return;
  }

  // 同じ操作を連打させず、次の server-status で状態に応じて再設定する。
  cardInfo.startButton.disabled = true;
  cardInfo.stopButton.disabled = true;
  cardInfo.restartButton.disabled = true;

  const actionNames = {
    start: '開始',
    stop: '停止',
    restart: '再起動',
  };

  cardInfo.controlNotice.textContent =
    `${actionNames[action]} を要求しました。`;
};

const renderServerList = (servers) => {
  serverCards.clear();
  serverList.replaceChildren();

  servers.forEach((server) => {
    if (
      typeof server !== 'object'
      || server === null
      || typeof server.id !== 'string'
      || typeof server.name !== 'string'
      || typeof server.rconCompat !== 'boolean'
    ) {
      return;
    }

    const card = document.createElement('article');
    const title = document.createElement('h3');
    const serverId = document.createElement('p');
    const rconCompatible = document.createElement('p');
    const serverStatus = createStatusRow('サーバー状態');
    const processAlive = createStatusRow('プロセス');
    const maintenance = createStatusRow('メンテナンス');
    const rconStatus = createStatusRow('RCON 状態');
    const rconAuth = createStatusRow('RCON 認証');
    const rconFallback = createStatusRow('stdin フォールバック');
    const rconError = document.createElement('p');
    const consoleTitle = document.createElement('h4');
    const consoleView = document.createElement('pre');
    const controlTitle = document.createElement('h4');
    const controlButtons = document.createElement('div');
    const startButton = document.createElement('button');
    const stopButton = document.createElement('button');
    const restartButton = document.createElement('button');
    const controlNotice = document.createElement('p');
    const commandTitle = document.createElement('h4');
    const commandForm = document.createElement('form');
    const commandLabel = document.createElement('label');
    const commandInput = document.createElement('textarea');
    const commandSubmit = document.createElement('button');
    const commandNotice = document.createElement('p');
    const disconnectRConButton = document.createElement('button');
    const disconnectRConNotice = document.createElement('p');

    disconnectRConButton.type = 'button';
    disconnectRConButton.textContent = 'RCON 切断';
    disconnectRConButton.disabled = true;
    disconnectRConButton.hidden = !server.rconCompat;
    disconnectRConNotice.hidden = !server.rconCompat;

    disconnectRConButton.addEventListener('click', () => {
      const sent = sendWebSocketTell({
        type: 'rcon-disconnect',
        serverId: server.id,
      });

      disconnectRConNotice.textContent = sent
        ? 'RCON 切断を要求しました。'
        : 'RCON 切断要求を送信できませんでした。';
    });

    controlTitle.textContent = 'サーバー操作';
    controlButtons.className = 'server-controls';

    startButton.type = 'button';
    startButton.textContent = '開始';
    startButton.disabled = true;

    stopButton.type = 'button';
    stopButton.textContent = '停止';
    stopButton.disabled = true;

    restartButton.type = 'button';
    restartButton.textContent = '再起動';
    restartButton.disabled = true;

    startButton.addEventListener('click', () => {
      submitServerControl(server.id, 'start');
    });

    stopButton.addEventListener('click', () => {
      submitServerControl(server.id, 'stop');
    });

    restartButton.addEventListener('click', () => {
      submitServerControl(server.id, 'restart');
    });

    controlButtons.append(startButton, stopButton, restartButton);

    commandTitle.textContent = 'コマンド送信';
    commandLabel.textContent = '改行区切りで複数入力できます。';

    commandInput.name = 'commands';
    commandInput.rows = 3;
    commandInput.placeholder = '例:\nsay Hello\nlist';

    commandSubmit.type = 'submit';
    commandSubmit.textContent = '送信';
    commandSubmit.disabled = true;

    commandForm.append(commandLabel, commandInput, commandSubmit, commandNotice);

    commandForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitCommandBatch(server.id, commandInput, commandNotice);
    });
    commandInput.addEventListener('keydown', (event) => {
      if (
        event.isComposing
        || event.key !== 'Enter'
        || !event.ctrlKey
        || commandSubmit.disabled
      ) {
        return;
      }

      event.preventDefault();
      submitCommandBatch(server.id, commandInput, commandNotice);
    });

    consoleTitle.textContent = 'コンソール';
    consoleView.className = 'server-console';
    consoleView.tabIndex = 0;
    consoleView.textContent = 'ログを取得中';

    card.className = 'server-card';
    title.textContent = server.name;
    serverId.textContent = `ID: ${server.id}`;
    rconCompatible.textContent = server.rconCompat
      ? 'RCON: 対応'
      : 'RCON: 非対応';

    if (!server.rconCompat) {
      rconStatus.value.textContent = '非対応';
      rconAuth.value.textContent = '対象外';
      rconFallback.value.textContent = '対象外';
    }

    rconError.hidden = true;

    card.append(
      title,
      serverId,
      rconCompatible,
      serverStatus.row,
      processAlive.row,
      maintenance.row,
      rconStatus.row,
      rconAuth.row,
      rconFallback.row,
      rconError,
      controlTitle,
      controlButtons,
      controlNotice,
      consoleTitle,
      consoleView,
      commandTitle,
      commandForm,
      disconnectRConButton,
      disconnectRConNotice,
    );

    serverList.append(card);

    serverCards.set(server.id, {
      card,
      rconAuth: rconAuth.value,
      rconCompatible: server.rconCompat,
      rconError,
      rconFallback: rconFallback.value,
      rconStatus: rconStatus.value,
      maintenance: maintenance.value,
      processAlive: processAlive.value,
      serverStatus: serverStatus.value,
      consoleEntries: [],
      consoleView,
      startButton,
      stopButton,
      restartButton,
      controlNotice,
      lastServerStatus: null,
      commandNotice,
      commandSubmit,
      disconnectRConButton,
      disconnectRConNotice,
    });
  });

  serverPanel.hidden = false;
};

const updateServerStatus = (serverId, status) => {
  const cardInfo = serverCards.get(serverId);

  if (
    typeof cardInfo === 'undefined'
    || typeof status !== 'object'
    || status === null
    || typeof status.status !== 'string'
    || typeof status.maintenance !== 'boolean'
    || typeof status.processAlive !== 'boolean'
  ) {
    return;
  }

  cardInfo.card.dataset.runningStatus = status.status;
  cardInfo.serverStatus.textContent = status.status;
  cardInfo.maintenance.textContent = status.maintenance ? '有効' : '無効';
  cardInfo.processAlive.textContent = status.processAlive ? '稼働中' : '停止中';
  cardInfo.commandSubmit.disabled = status.status !== 'RUNNING';

  cardInfo.lastServerStatus = status;
  updateServerControlButtons(cardInfo, status);
};

const updateRConStatus = (serverId, status) => {
  const cardInfo = serverCards.get(serverId);

  if (
    typeof cardInfo === 'undefined'
    || !cardInfo.rconCompatible
    || typeof status !== 'object'
    || status === null
    || typeof status.status !== 'string'
    || typeof status.authed !== 'boolean'
    || typeof status.fallbacked !== 'boolean'
  ) {
    return;
  }

  cardInfo.rconStatus.textContent = status.status;
  cardInfo.rconAuth.textContent = status.authed ? '認証済み' : '未認証';
  cardInfo.rconFallback.textContent = status.fallbacked ? '有効' : '無効';
  cardInfo.disconnectRConButton.disabled = !(
    status.status === 'CONNECTING'
    || status.status === 'AUTHENTICATING'
    || status.status === 'CONNECTED'
  );

  if (typeof status.lastError === 'string' && status.lastError.length > 0) {
    cardInfo.rconError.hidden = false;
    cardInfo.rconError.textContent = `RCON エラー: ${status.lastError}`;
  } else {
    cardInfo.rconError.hidden = true;
    cardInfo.rconError.textContent = '';
  }
};

const formatConsoleEntry = (entry) => {
  if (
    typeof entry !== 'object'
    || entry === null
    || typeof entry.at !== 'string'
    || typeof entry.source !== 'string'
    || typeof entry.message !== 'string'
  ) {
    return null;
  }

  return `[${entry.at}][${entry.source}] ${entry.message}`;
};

const updateConsole = (serverId, entries, replace) => {
  const cardInfo = serverCards.get(serverId);

  if (typeof cardInfo === 'undefined' || !Array.isArray(entries)) {
    return;
  }

  const formattedEntries = entries
    .map((entry) => formatConsoleEntry(entry))
    .filter((entry) => entry !== null);

  if (replace) {
    cardInfo.consoleEntries = formattedEntries;
  } else {
    cardInfo.consoleEntries.push(...formattedEntries);
  }

  if (cardInfo.consoleEntries.length > MaxConsoleEntries) {
    cardInfo.consoleEntries.splice(
      0,
      cardInfo.consoleEntries.length - MaxConsoleEntries,
    );
  }

  cardInfo.consoleView.textContent = cardInfo.consoleEntries.join('\n');
  cardInfo.consoleView.scrollTop = cardInfo.consoleView.scrollHeight;
};

const clearAuthenticatedView = () => {
  shouldMaintainWebSocket = false;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeWebSocket !== null) {
    activeWebSocket.close(1000, 'Logout');
    activeWebSocket = null;
  }

  authenticatedUser.textContent = '';
  serverCards.clear();
  serverList.replaceChildren();
  serverPanel.hidden = true;
  setWebSocketStatus('未接続');
};

const logout = async () => {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 204) return;

  throw new Error('ログアウトに失敗しました。');
};

const connectWebSocket = async () => {
  if (webSocketConnecting) return;

  if (
    activeWebSocket !== null
    && (
      activeWebSocket.readyState === WebSocket.OPEN
      || activeWebSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  webSocketConnecting = true;
  setWebSocketStatus('接続中');

  try {
    const socket = await connectMCSCWebSocket({
      onClose: (event) => {
        activeWebSocket = null;

        const reason = event.reason.length > 0
          ? `: ${event.reason}`
          : '';

        setWebSocketStatus(`切断されました (${event.code})${reason}`);

        if (!shouldMaintainWebSocket) return;

        if (event.code === 1008) {
          void reconnectWebSocket();
          return;
        }

        scheduleWebSocketReconnect();
      },
      onMessage: (message) => {
        // 接続ゥ
        if (message.type === 'hello') {
          setWebSocketStatus('接続済み');
          return;
        }
        if (message.type === 'server-list' && Array.isArray(message.servers)) {
          renderServerList(message.servers);
          setWebSocketStatus(`接続済み (${message.servers.length} サーバー)`);
          return;
        }

        // ステータスチェック
        if (message.type === 'server-status') {
          updateServerStatus(message.serverId, message.status);
          return;
        }
        if (message.type === 'rcon-status') {
          updateRConStatus(message.serverId, message.status);
          return;
        }

        // コンソール履歴・出力
        if (message.type === 'console-history') {
          updateConsole(message.serverId, message.entries, true);
          return;
        }
        if (message.type === 'console-output') {
          updateConsole(message.serverId, [message.entry], false);
          return;
        }

        // コマンド送信・拒否
        if (message.type === 'command-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.commandNotice.textContent =
              `${message.commandCount} 件のコマンドを受理しました。`;
          }

          return;
        }
        if (message.type === 'command-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const errors = {
              invalid_message: 'コマンド形式が不正です。',
              server_not_found: '対象サーバーが見つかりません。',
              server_not_running: 'サーバーが起動していません。',
            };

            cardInfo.commandNotice.textContent =
              errors[message.error] ?? 'コマンドは拒否されました。';
          }
          return;
        }

        // サーバーコンソール関連
        if (message.type === 'server-control-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const actionNames = {
              start: '開始',
              stop: '停止',
              restart: '再起動',
            };

            cardInfo.controlNotice.textContent =
              `${actionNames[message.action]} を受理しました。`;
          }

          return;
        }
        if (message.type === 'server-control-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const errors = {
              server_already_active: 'サーバープロセスは既に存在します。',
              maintenance_locked: 'DEPLETED 状態かつメンテナンス有効のため、開始できません。',
              server_not_found: '対象サーバーが見つかりません。',
              server_not_running: 'サーバーは起動していません。',
            };

            cardInfo.controlNotice.textContent =
              errors[message.error] ?? 'サーバー操作は拒否されました。';

            if (cardInfo.lastServerStatus !== null) {
              updateServerControlButtons(
                cardInfo,
                cardInfo.lastServerStatus,
              );
            }
          }

          return;
        }

        // RCon送信・拒否
        if (message.type === 'rcon-disconnect-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.disconnectRConNotice.textContent =
              'RCON 切断を受理しました。';
          }

          return;
        }
        if (message.type === 'rcon-disconnect-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const errors = {
              rcon_unavailable: 'RCON は利用できません。',
              server_not_found: '対象サーバーが見つかりません。',
              server_not_running: 'サーバーが起動していません。',
            };

            cardInfo.disconnectRConNotice.textContent =
              errors[message.error] ?? 'RCON 切断は拒否されました。';
          }
          return;
        }
      },
    });

    activeWebSocket = socket;
    setWebSocketStatus('接続済み');
  } catch (error) {
    activeWebSocket = null;

    const message = error instanceof Error
      ? error.message
      : 'WebSocket 接続中にエラーが発生しました。';

    setWebSocketStatus(message);
    scheduleWebSocketReconnect();
  } finally {
    webSocketConnecting = false;
  }
};

const showLoginPanel = () => {
  loadingPanel.hidden = true;
  authenticatedPanel.hidden = true;
  loginPanel.hidden = false;
};

const showAuthenticatedPanel = (username) => {
  loadingPanel.hidden = true;
  loginPanel.hidden = true;
  authenticatedUser.textContent = `ログインユーザー: ${username}`;
  authenticatedPanel.hidden = false;
  shouldMaintainWebSocket = true;
  void connectWebSocket();
};

const loadSession = async () => {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('セッション状態を取得できませんでした。');
  }

  return response.json();
};

const reconnectWebSocket = async () => {
  if (!shouldMaintainWebSocket) return;

  try {
    const session = await loadSession();

    if (!session.authenticated) {
      clearAuthenticatedView();
      showLoginPanel();
      setNotice('ログインセッションの有効期限が切れました。');
      return;
    }

    void connectWebSocket();
  } catch {
    scheduleWebSocketReconnect();
  }
};

const scheduleWebSocketReconnect = () => {
  if (!shouldMaintainWebSocket || reconnectTimer !== null) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnectWebSocket();
  }, WebSocketReconnectDelayMs);
};

const login = async (username, password) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: username,
      password: password,
    }),
  });

  if (response.status === 204) return;

  if (response.status === 401) throw new Error('ユーザー名またはパスワードが正しくありません。');

  if (response.status === 429) throw new Error('ログイン試行回数が多すぎます。しばらく待ってください。');

  throw new Error('ログインに失敗しました。');
};

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = usernameInput.value;
  const password = passwordInput.value;

  loginSubmit.disabled = true;
  setNotice('ログインしています。');

  try {
    await login(username, password);

    passwordInput.value = '';
    const session = await loadSession();

    if (!session.authenticated) {
      throw new Error('ログイン後のセッション確認に失敗しました。');
    }

    showAuthenticatedPanel(session.username);
    setNotice('ログインしました。');
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'ログイン処理中にエラーが発生しました。';

    setNotice(message);
    showLoginPanel();
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutSubmit.addEventListener('click', async () => {
  logoutSubmit.disabled = true;
  setNotice('ログアウトしています。');

  try {
    await logout();

    clearAuthenticatedView();
    showLoginPanel();
    setNotice('ログアウトしました。');
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'ログアウト処理中にエラーが発生しました。';

    setNotice(message);
  } finally {
    logoutSubmit.disabled = false;
  }
});

try {
  const session = await loadSession();

  if (session.authenticated) showAuthenticatedPanel(session.username);
  else showLoginPanel();
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'セッション確認中にエラーが発生しました。';

  setNotice(message);
  showLoginPanel();
}
