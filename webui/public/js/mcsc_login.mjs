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
const dashboardView = document.querySelector('#dashboard-view');
const serverDetailBack = document.querySelector('#server-detail-back');
const serverDetailContent = document.querySelector('#server-detail-content');
const serverDetailTitle = document.querySelector('#server-detail-title');
const serverDetailView = document.querySelector('#server-detail-view');
const logoutSubmit = document.querySelector('#logout-submit');
const navigationItems = document.querySelectorAll('[data-scroll-target]');

/** サイドバーメニューの選択表示を、操作した項目だけへ更新する。 */
const setActiveNavigation = (activeItem) => {
  navigationItems.forEach((navigationItem) => {
    navigationItem.classList.toggle(
      'admin-menu__item--active',
      navigationItem === activeItem,
    );
  });
};

navigationItems.forEach((navigationItem) => {
  navigationItem.addEventListener('click', () => {
    if (navigationItem.dataset.view === 'dashboard') {
      showDashboard();
    }

    const targetId = navigationItem.dataset.scrollTarget;

    if (typeof targetId !== 'string' || targetId.length === 0) return;

    requestAnimationFrame(() => {
      const target = document.querySelector(`#${targetId}`);

      if (target === null) return;

      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    setActiveNavigation(navigationItem);
  });
});

const WebSocketReconnectDelayMs = 3 * 1000; // 3 sec
let shouldMaintainWebSocket = false;
let reconnectTimer = null;

/** 画面共通の通知領域へメッセージを表示する。 */
const setNotice = (message) => {
  notice.textContent = message;
};

/** Material Icons付きのボタン内容を設定する。アイコン名はGoogle Fontsのリガチャ名を使う。 */
const setButtonContent = (button, label, iconName) => {
  const icon = document.createElement('span');

  icon.className = 'material-icons';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = iconName;
  button.classList.add('button-with-icon');
  button.replaceChildren(icon, document.createTextNode(label));
};

let activeWebSocket = null;
const serverCards = new Map();
const MaxConsoleEntries = 400;
const ConsoleLogLevels = new Set([
  'DEBUG', 'INFO', 'STDOUT', 'WARN', 'ERROR', 'FATAL',
]);
let webSocketConnecting = false;
let selectedServerId = null;

/** 詳細表示中のカードを一覧へ戻し、ダッシュボード表示へ切り替える。 */
const showDashboard = () => {
  selectedServerId = null;
  serverDetailContent.replaceChildren();
  serverDetailView.hidden = true;
  dashboardView.hidden = false;

  const cards = Array.from(serverCards.values(), (cardInfo) => {
    return cardInfo.card;
  });

  serverList.replaceChildren(...cards);
};

/** 指定サーバーのカードを詳細領域へ移動して完全表示に切り替える。 */
const showServerDetail = (serverId) => {
  const cardInfo = serverCards.get(serverId);

  if (typeof cardInfo === 'undefined') return;

  selectedServerId = serverId;
  serverDetailTitle.textContent = `${cardInfo.name} - サーバー詳細`;

  dashboardView.hidden = true;
  serverDetailView.hidden = false;
  serverDetailContent.replaceChildren(cardInfo.card);

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
};

serverDetailBack.addEventListener('click', () => {
  showDashboard();
});

/** WebSocketの接続状態をヘッダーの状態表示へ反映する。 */
const setWebSocketStatus = (message) => {
  webSocketStatus.textContent = message;
};

/** 接続済みWebSocketへ操作要求をJSON送信し、送信可否を返す。 */
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

/** 複数行のコンソール入力を検査して、コマンドバッチとして送信する。 */
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

/** サーバー状態グリッドで使う、ラベルと更新先要素の組を生成する。 */
const createStatusRow = (labelText, statusKey) => {
  const row = document.createElement('div');
  const label = document.createElement('span');
  const value = document.createElement('strong');

  row.className = 'server-status-row';
  row.dataset.statusKey = statusKey;
  label.className = 'server-status-row__label';
  value.className = 'server-status-row__value';

  label.textContent = labelText;
  value.textContent = '取得中';

  row.append(label, value);

  return { row, value };
};

/** 受信したサーバー状態に応じて起動・停止・再起動操作の可否を更新する。 */
const updateServerControlButtons = (cardInfo, status) => {
  const canStart = !status.processAlive && !(
    status.status === 'DEPLETED' && status.maintenance
  );

  cardInfo.startButton.disabled = !canStart;
  cardInfo.stopButton.disabled = !status.processAlive;
  cardInfo.restartButton.disabled = status.status !== 'RUNNING';
  cardInfo.maintenanceButton.disabled = false;
  setButtonContent(
    cardInfo.maintenanceButton,
    status.maintenance ? 'メンテナンス解除' : 'メンテナンス有効化',
    'construction',
  );
};

/** サーバー制御要求を送り、応答受信まで操作ボタンの連打を防止する。 */
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
    start: '起動',
    stop: '停止',
    restart: '再起動',
  };

  cardInfo.controlNotice.textContent =
    `${actionNames[action]} を要求しました。`;
};

/** スケジュールスナップショットから、指定タスクのcron式だけを取り出す。 */
const getScheduleExpression = (schedule, taskName) => {
  if (!Array.isArray(schedule.tasks)) return '';

  const task = schedule.tasks.find((candidate) =>
    typeof candidate === 'object'
    && candidate !== null
    && candidate.name === taskName
    && typeof candidate.expression === 'string',
  );

  return typeof task?.expression === 'string' ? task.expression : '';
};

/** 「グローバル設定を使用する」の選択に合わせ、固有設定入力欄を有効・無効化する。 */
const setScheduleOverrideInputsDisabled = (
  useGlobalInput,
  motdInput,
  execInput,
) => {
  const disabled = useGlobalInput.checked;

  motdInput.disabled = disabled;
  execInput.disabled = disabled;
};

/** Velocityの関連先一覧を通常のサーバー状態から再計算し、表示だけを更新する。 */
const updateProxyLinkedServerStatuses = () => {
  serverCards.forEach((cardInfo) => {
    if (!cardInfo.isProxy) return;

    const linkedElements = [];
    let runningCount = 0;

    for (const linkedServerId of cardInfo.linkedServerIds) {
      const linkedCardInfo = serverCards.get(linkedServerId);
      const item = document.createElement('li');
      const name = document.createElement('strong');
      const detail = document.createElement('span');

      if (typeof linkedCardInfo === 'undefined') {
        name.textContent = linkedServerId;
        detail.textContent = '設定不備: サーバー未登録';
        detail.dataset.state = 'FAILED';
      } else if (linkedCardInfo.lastServerStatus === null) {
        name.textContent = linkedCardInfo.name;
        detail.textContent = `${linkedServerId}: 状態を取得中`;
      } else {
        const linkedStatus = linkedCardInfo.lastServerStatus;

        if (linkedStatus.status === 'RUNNING') runningCount += 1;

        name.textContent = linkedCardInfo.name;
        detail.textContent = `${linkedServerId}: ${linkedStatus.status} / ${
          linkedStatus.processAlive ? 'プロセス稼働中' : 'プロセス停止中'
        }`;
        detail.dataset.state = linkedStatus.status;
      }

      item.append(name, detail);
      linkedElements.push(item);
    }

    if (cardInfo.linkedServerIds.length === 0) {
      cardInfo.linkedStatus.textContent = '設定なし';
      cardInfo.linkedStatus.dataset.state = 'disabled';
    } else {
      cardInfo.linkedStatus.textContent =
        `${runningCount} / ${cardInfo.linkedServerIds.length} 稼働`;
      cardInfo.linkedStatus.dataset.state = runningCount === cardInfo.linkedServerIds.length
        ? 'alive'
        : runningCount === 0
          ? 'FAILED'
          : 'partial';
    }

    cardInfo.linkedList.replaceChildren(...linkedElements);
  });
};

/** 許可済み設定フィールドを詳細画面の表示専用コントロールへ描画する。 */
const renderServerConfig = (serverId, config) => {
  const cardInfo = serverCards.get(serverId);

  if (
    typeof cardInfo === 'undefined'
    || typeof config !== 'object'
    || config === null
    || typeof config.file !== 'object'
    || config.file === null
    || typeof config.file.fileName !== 'string'
    || typeof config.file.format !== 'string'
    || typeof config.revision !== 'string'
    || typeof config.bytes !== 'number'
    || !Array.isArray(config.fields)
  ) {
    return;
  }

  const fields = [];
  const wasSavePending = cardInfo.configSavePending;
  const canEdit = cardInfo.lastServerStatus !== null
    && !cardInfo.lastServerStatus.processAlive;

  for (const field of config.fields) {
    if (
      typeof field !== 'object'
      || field === null
      || typeof field.key !== 'string'
      || field.key.toLowerCase() === 'rcon.password'
      || typeof field.value !== 'string'
      || !['text', 'boolean', 'select', 'readonly'].includes(field.mode)
    ) {
      continue;
    }

    const row = document.createElement('div');
    const key = document.createElement('dt');
    const configKey = document.createElement('span');
    const value = document.createElement('dd');

    row.className = 'server-config-field';
    key.textContent = typeof field.label === 'string' && field.label.length > 0
      ? field.label
      : field.key;
    configKey.className = 'server-config-field__key';
    configKey.textContent = field.key;
    key.append(configKey);

    if (field.mode === 'boolean') {
      const input = document.createElement('input');

      input.type = 'checkbox';
      input.setAttribute('aria-label', field.key);
      input.checked = field.value.toLowerCase() === 'true';
      input.disabled = !canEdit;
      input.dataset.configKey = field.key;
      input.dataset.configValue = input.checked ? 'true' : 'false';
      value.append(input);
    } else if (field.mode === 'select') {
      const select = document.createElement('select');
      const options = Array.isArray(field.options) ? field.options : [];

      for (const optionValue of options) {
        if (typeof optionValue !== 'string') continue;

        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = optionValue === field.value;
        select.append(option);
      }

      select.disabled = !canEdit;
      select.dataset.configKey = field.key;
      select.dataset.configValue = field.value;
      value.append(select);
    } else if (field.mode === 'readonly') {
      const output = document.createElement('output');
      output.textContent = field.value;
      value.append(output);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = field.value;
      input.readOnly = !canEdit;
      input.dataset.configKey = field.key;
      input.dataset.configValue = field.value;
      value.append(input);
    }

    if (typeof field.notice === 'string' && field.notice.length > 0) {
      const fieldNotice = document.createElement('p');
      fieldNotice.className = 'server-config-field__notice';
      fieldNotice.textContent = field.notice;
      value.append(fieldNotice);
    }

    row.append(key, value);
    fields.push(row);
  }

  cardInfo.configMeta.textContent =
    `${config.file.fileName} (${config.file.format}, ${config.bytes} bytes)`;
  cardInfo.configFields.replaceChildren(...fields);
  cardInfo.configFields.hidden = false;
  cardInfo.configRevision = config.revision;
  cardInfo.configSaveButton.disabled = !canEdit;
  cardInfo.configSavePending = false;
  cardInfo.configNotice.textContent =
    wasSavePending
      ? '設定を保存しました。次回起動時から反映されます。'
      : canEdit
      ? '編集後に保存すると、次回起動時から設定が反映されます。'
      : 'サーバー停止中のみ設定を編集・保存できます。';
};

/** サーバー状態変化に合わせ、既読の設定フィールドの編集可否を更新する。 */
const updateServerConfigEditability = (cardInfo, status) => {
  const canEdit = !status.processAlive && cardInfo.configRevision !== null;

  for (const control of cardInfo.configFields.querySelectorAll('[data-config-key]')) {
    if (control instanceof HTMLInputElement && control.type === 'text') {
      control.readOnly = !canEdit;
    } else if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.disabled = !canEdit;
    }
  }

  cardInfo.configSaveButton.disabled = !canEdit;
};

/** サーバー一覧メタデータから、ダッシュボード兼詳細画面用のカード群を再構築する。 */
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
      || typeof server.isProxy !== 'boolean'
      || !Array.isArray(server.linkedServerIds)
      || !server.linkedServerIds.every((serverId) => typeof serverId === 'string')
    ) {
      return;
    }

    const card = document.createElement('article');
    const cardHeader = document.createElement('header');
    const statusGrid = document.createElement('div');
    const title = document.createElement('button');
    const serverId = document.createElement('p');
    const rconCompatible = document.createElement('p');
    const serverStatus = createStatusRow('サーバー状態', 'server');
    const processAlive = createStatusRow('プロセス', 'process');
    const maintenance = createStatusRow('メンテナンス', 'maintenance');
    const rconStatus = createStatusRow('RCON 状態', 'rcon-status');
    const rconAuth = createStatusRow('RCON 認証', 'rcon-auth');
    const rconFallback = createStatusRow('stdin フォールバック', 'rcon-fallback');
    const linkedStatus = createStatusRow('連動先', 'linked');
    const playerStatus = createStatusRow('ログイン中', 'players');
    const rconError = document.createElement('p');
    const consoleTitle = document.createElement('h4');
    const consoleHeader = document.createElement('div');
    const consoleView = document.createElement('pre');
    const controlTitle = document.createElement('h4');
    const controlButtons = document.createElement('div');
    const startButton = document.createElement('button');
    const stopButton = document.createElement('button');
    const restartButton = document.createElement('button');
    const maintenanceButton = document.createElement('button');
    const controlNotice = document.createElement('p');
    const linkedHeader = document.createElement('div');
    const linkedTitle = document.createElement('h4');
    const linkedList = document.createElement('ul');
    const playersHeader = document.createElement('div');
    const playersTitle = document.createElement('h4');
    const playersList = document.createElement('ul');
    const configHeader = document.createElement('div');
    const configTitle = document.createElement('h4');
    const configReloadButton = document.createElement('button');
    const configSaveButton = document.createElement('button');
    const configMeta = document.createElement('p');
    const configFields = document.createElement('dl');
    const configNotice = document.createElement('p');
    const scheduleTitle = document.createElement('h4');
    const scheduleList = document.createElement('dl');
    const scheduleHeader = document.createElement('div');
    const scheduleEditButton = document.createElement('button');
    const scheduleEditor = document.createElement('form');
    const scheduleStartLabel = document.createElement('label');
    const scheduleStartInput = document.createElement('input');
    const rebootFieldset = document.createElement('fieldset');
    const rebootLegend = document.createElement('legend');
    const rebootUseGlobalLabel = document.createElement('label');
    const rebootUseGlobalInput = document.createElement('input');
    const rebootMotdLabel = document.createElement('label');
    const rebootMotdInput = document.createElement('input');
    const rebootExecLabel = document.createElement('label');
    const rebootExecInput = document.createElement('input');
    const shutdownFieldset = document.createElement('fieldset');
    const shutdownLegend = document.createElement('legend');
    const shutdownUseGlobalLabel = document.createElement('label');
    const shutdownUseGlobalInput = document.createElement('input');
    const shutdownMotdLabel = document.createElement('label');
    const shutdownMotdInput = document.createElement('input');
    const shutdownExecLabel = document.createElement('label');
    const shutdownExecInput = document.createElement('input');
    const scheduleActions = document.createElement('div');
    const scheduleSaveButton = document.createElement('button');
    const scheduleCancelButton = document.createElement('button');
    const scheduleNotice = document.createElement('p');
    const commandTitle = document.createElement('h4');
    const commandForm = document.createElement('form');
    const commandLabel = document.createElement('label');
    const commandInput = document.createElement('textarea');
    const commandSubmit = document.createElement('button');
    const commandNotice = document.createElement('p');
    const disconnectRConButton = document.createElement('button');
    const disconnectRConNotice = document.createElement('p');

    disconnectRConButton.type = 'button';
    setButtonContent(disconnectRConButton, 'RCON 切断', 'link_off');
    disconnectRConButton.disabled = true;
    disconnectRConButton.hidden = !server.rconCompat;
    disconnectRConNotice.hidden = !server.rconCompat;
    disconnectRConButton.title = '現在のRCON接続を手動で切断します。';

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
    controlTitle.className = 'server-card__control-title';
    controlButtons.className = 'server-controls';

    startButton.type = 'button';
    setButtonContent(startButton, '起動', 'play_arrow');
    startButton.disabled = true;

    stopButton.type = 'button';
    setButtonContent(stopButton, '停止', 'stop');
    stopButton.disabled = true;

    restartButton.type = 'button';
    setButtonContent(restartButton, '再起動', 'autorenew');
    restartButton.disabled = true;

    maintenanceButton.type = 'button';
    maintenanceButton.className = 'server-maintenance-toggle';
    setButtonContent(maintenanceButton, 'メンテナンス有効化', 'construction');
    maintenanceButton.disabled = true;

    maintenanceButton.addEventListener('click', () => {
      const cardInfo = serverCards.get(server.id);

      if (
        typeof cardInfo === 'undefined'
        || cardInfo.lastServerStatus === null
      ) {
        return;
      }

      const enabled = !cardInfo.lastServerStatus.maintenance;
      const sent = sendWebSocketTell({
        type: 'maintenance-set',
        serverId: server.id,
        enabled: enabled,
      });

      if (!sent) {
        cardInfo.controlNotice.textContent =
          'メンテナンス設定を送信できませんでした。';
        return;
      }

      maintenanceButton.disabled = true;
      cardInfo.controlNotice.textContent = enabled
        ? 'メンテナンス有効化を要求しました。'
        : 'メンテナンス解除を要求しました。';
    });

    startButton.addEventListener('click', () => {
      submitServerControl(server.id, 'start');
    });

    stopButton.addEventListener('click', () => {
      submitServerControl(server.id, 'stop');
    });

    restartButton.addEventListener('click', () => {
      submitServerControl(server.id, 'restart');
    });

    controlButtons.append(startButton, stopButton, restartButton, maintenanceButton);

    scheduleTitle.textContent = 'cron管理';
    scheduleList.className = 'server-schedule-list server-card__detail-only';

    scheduleHeader.className = 'server-card__section-header server-card__detail-only';

    scheduleEditButton.type = 'button';
    setButtonContent(scheduleEditButton, '編集', 'edit');
    scheduleEditButton.className = 'server-schedule-edit';

    scheduleEditButton.addEventListener('click', () => {
      const cardInfo = serverCards.get(server.id);

      if (
        typeof cardInfo === 'undefined'
        || cardInfo.scheduleSnapshot === null
      ) {
        scheduleNotice.textContent = 'cron設定をまだ取得できていません。';
        return;
      }

      const schedule = cardInfo.scheduleSnapshot;

      scheduleStartInput.value = getScheduleExpression(schedule, 'start');
      rebootMotdInput.value = getScheduleExpression(schedule, 'reboot-motd');
      rebootExecInput.value = getScheduleExpression(schedule, 'reboot-exec');
      shutdownMotdInput.value = getScheduleExpression(schedule, 'shutdown-motd');
      shutdownExecInput.value = getScheduleExpression(schedule, 'shutdown-exec');

      rebootUseGlobalInput.checked = schedule.rebootUsesOverride !== true;
      shutdownUseGlobalInput.checked = schedule.shutdownUsesOverride !== true;

      setScheduleOverrideInputsDisabled(
        rebootUseGlobalInput,
        rebootMotdInput,
        rebootExecInput,
      );
      setScheduleOverrideInputsDisabled(
        shutdownUseGlobalInput,
        shutdownMotdInput,
        shutdownExecInput,
      );

      scheduleNotice.textContent = '';
      scheduleList.hidden = true;
      scheduleEditor.hidden = false;
      scheduleEditButton.hidden = true;
      scheduleStartInput.focus();
    });

    rebootUseGlobalInput.addEventListener('change', () => {
      setScheduleOverrideInputsDisabled(
        rebootUseGlobalInput,
        rebootMotdInput,
        rebootExecInput,
      );
    });

    shutdownUseGlobalInput.addEventListener('change', () => {
      setScheduleOverrideInputsDisabled(
        shutdownUseGlobalInput,
        shutdownMotdInput,
        shutdownExecInput,
      );
    });

    scheduleCancelButton.addEventListener('click', () => {
      const cardInfo = serverCards.get(server.id);

      if (typeof cardInfo !== 'undefined') {
        cardInfo.scheduleSavePending = false;
      }

      scheduleEditor.hidden = true;
      scheduleList.hidden = false;
      scheduleEditButton.hidden = false;
      scheduleSaveButton.disabled = false;
      scheduleNotice.textContent = '';
    });

    scheduleEditor.addEventListener('submit', (event) => {
      event.preventDefault();

      const sent = sendWebSocketTell({
        type: 'schedule-set',
        serverId: server.id,
        schedule: {
          start: scheduleStartInput.value,
          reboot: {
            useOverride: !rebootUseGlobalInput.checked,
            motd: rebootMotdInput.value,
            exec: rebootExecInput.value,
          },
          shutdown: {
            useOverride: !shutdownUseGlobalInput.checked,
            motd: shutdownMotdInput.value,
            exec: shutdownExecInput.value,
          },
        },
      });

      if (!sent) {
        scheduleNotice.textContent = 'cron設定を送信できませんでした。';
        return;
      }

      const cardInfo = serverCards.get(server.id);

      if (typeof cardInfo !== 'undefined') {
        cardInfo.scheduleSavePending = true;
      }

      scheduleSaveButton.disabled = true;
      scheduleNotice.textContent = 'cron設定を保存しています。';
    });

    scheduleHeader.append(scheduleTitle, scheduleEditButton);

    scheduleEditor.className = 'server-schedule-editor server-card__detail-only';
    scheduleEditor.hidden = true;

    scheduleStartLabel.textContent = '定時起動';
    scheduleStartInput.type = 'text';
    scheduleStartInput.maxLength = 128;
    scheduleStartInput.autocomplete = 'off';
    scheduleStartInput.placeholder = '例: 0 6 * * *';
    scheduleStartLabel.append(scheduleStartInput);

    rebootLegend.textContent = '日次再起動';
    rebootUseGlobalInput.type = 'checkbox';
    rebootUseGlobalLabel.append(rebootUseGlobalInput, ' グローバル設定を使用する');

    rebootMotdLabel.textContent = '予告メッセージのcron式';
    rebootMotdInput.type = 'text';
    rebootMotdInput.maxLength = 128;
    rebootMotdInput.autocomplete = 'off';
    rebootMotdLabel.append(rebootMotdInput);

    rebootExecLabel.textContent = '再起動実行のcron式';
    rebootExecInput.type = 'text';
    rebootExecInput.maxLength = 128;
    rebootExecInput.autocomplete = 'off';
    rebootExecLabel.append(rebootExecInput);

    rebootFieldset.append(rebootLegend, rebootUseGlobalLabel, rebootMotdLabel, rebootExecLabel);

    shutdownLegend.textContent = '週間停止';
    shutdownUseGlobalInput.type = 'checkbox';
    shutdownUseGlobalLabel.append(shutdownUseGlobalInput, ' グローバル設定を使用する');

    shutdownMotdLabel.textContent = '予告メッセージのcron式';
    shutdownMotdInput.type = 'text';
    shutdownMotdInput.maxLength = 128;
    shutdownMotdInput.autocomplete = 'off';
    shutdownMotdLabel.append(shutdownMotdInput);

    shutdownExecLabel.textContent = '停止実行のcron式';
    shutdownExecInput.type = 'text';
    shutdownExecInput.maxLength = 128;
    shutdownExecInput.autocomplete = 'off';
    shutdownExecLabel.append(shutdownExecInput);

    shutdownFieldset.append(shutdownLegend, shutdownUseGlobalLabel, shutdownMotdLabel, shutdownExecLabel);

    scheduleSaveButton.type = 'submit';
    setButtonContent(scheduleSaveButton, '保存', 'save');

    scheduleCancelButton.type = 'button';
    setButtonContent(scheduleCancelButton, 'キャンセル', 'cancel');

    scheduleActions.className = 'server-schedule-editor__actions';
    scheduleNotice.className = 'server-card__notice';

    scheduleActions.append(scheduleSaveButton, scheduleCancelButton);
    scheduleEditor.append(scheduleStartLabel, rebootFieldset, shutdownFieldset, scheduleActions, scheduleNotice);

    commandTitle.textContent = 'コマンド送信';
    commandLabel.textContent = '改行区切りで複数入力できます。';

    commandInput.name = 'commands';
    commandInput.rows = 3;
    commandInput.placeholder = '例:\nsay Hello\nlist';

    commandSubmit.type = 'submit';
    setButtonContent(commandSubmit, '送信 (Ctrl+Enter)', 'send');
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
    consoleHeader.className = 'server-card__section-header server-card__detail-only';
    consoleHeader.append(consoleTitle, disconnectRConButton);

    consoleView.className = 'server-console';
    consoleView.tabIndex = 0;
    consoleView.textContent = 'ログを取得中';

    card.className = 'server-card';
    card.dataset.proxyServer = server.isProxy ? 'true' : 'false';
    cardHeader.className = 'server-card__header';
    statusGrid.className = 'server-status-grid';

    serverId.className = 'server-card__id';
    rconCompatible.className = 'server-card__rcon-compatible';
    rconError.className = 'server-card__error';
    controlNotice.className = 'server-card__notice';
    commandNotice.className = 'server-card__notice';
    disconnectRConNotice.className = 'server-card__notice';
    rconError.classList.add('server-card__detail-only');
    linkedHeader.className = 'server-card__section-header server-card__detail-only';
    linkedTitle.textContent = '連動先サーバー状態';
    linkedHeader.append(linkedTitle);
    linkedList.className = 'server-linked-list server-card__detail-only';
    linkedHeader.hidden = !server.isProxy;
    linkedList.hidden = !server.isProxy;
    playersHeader.className = 'server-card__section-header server-card__detail-only';
    playersTitle.textContent = 'ログイン中のプレイヤー';
    playersHeader.append(playersTitle);
    playersList.className = 'server-player-list server-card__detail-only';
    configHeader.className = 'server-card__section-header server-card__detail-only';
    configTitle.textContent = 'サーバー設定';
    configReloadButton.type = 'button';
    setButtonContent(configReloadButton, '設定を読み込む', 'refresh');
    configReloadButton.addEventListener('click', () => {
      const sent = sendWebSocketTell({ type: 'config-get', serverId: server.id });
      configNotice.textContent = sent
        ? '設定を読み込んでいます。'
        : '設定を読み込めませんでした。';
    });
    configSaveButton.type = 'button';
    setButtonContent(configSaveButton, '保存', 'save');
    configSaveButton.disabled = true;
    configSaveButton.addEventListener('click', () => {
      const cardInfo = serverCards.get(server.id);
      if (typeof cardInfo === 'undefined' || cardInfo.configRevision === null) return;

      const changes = [];
      for (const control of configFields.querySelectorAll('[data-config-key]')) {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) continue;
        const key = control.dataset.configKey;
        const previousValue = control.dataset.configValue;
        if (typeof key !== 'string' || typeof previousValue !== 'string') continue;
        const value = control instanceof HTMLInputElement && control.type === 'checkbox'
          ? control.checked ? 'true' : 'false'
          : control.value;
        if (value !== previousValue) changes.push({ key, value });
      }
      if (changes.length === 0) {
        configNotice.textContent = '変更された設定はありません。';
        return;
      }
      const sent = sendWebSocketTell({
        type: 'config-set', serverId: server.id,
        revision: cardInfo.configRevision, changes,
      });
      if (!sent) {
        configNotice.textContent = '設定を保存できませんでした。';
        return;
      }
      cardInfo.configSavePending = true;
      configSaveButton.disabled = true;
      configNotice.textContent = '設定を保存しています。';
    });
    configHeader.append(configTitle, configReloadButton, configSaveButton);
    configMeta.className = 'server-config-meta server-card__detail-only';
    configFields.className = 'server-config-fields server-card__detail-only';
    configFields.hidden = true;
    configNotice.className = 'server-card__notice server-card__detail-only';
    consoleTitle.classList.add('server-card__detail-only');
    consoleView.classList.add('server-card__detail-only');
    commandTitle.classList.add('server-card__detail-only');
    commandForm.classList.add('server-card__detail-only');
    disconnectRConButton.classList.add('server-card__detail-only');
    disconnectRConNotice.classList.add('server-card__detail-only');

    title.type = 'button';
    title.className = 'server-card__title';

    title.addEventListener('click', () => {
      showServerDetail(server.id);
    });
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

    linkedStatus.row.hidden = !server.isProxy;
    linkedStatus.row.classList.add('server-status-row--linked');
    serverStatus.row.append(linkedStatus.row);
    playerStatus.row.classList.add('server-status-row--linked');
    serverStatus.row.append(playerStatus.row);

    rconError.hidden = true;

    cardHeader.append(title, serverId, rconCompatible);

    statusGrid.append(
      serverStatus.row,
      processAlive.row,
      maintenance.row,
      rconStatus.row,
      rconAuth.row,
      rconFallback.row,
    );

    card.append(
      cardHeader,
      statusGrid,
      rconError,
      controlTitle,
      controlButtons,
      controlNotice,
      linkedHeader,
      linkedList,
      playersHeader,
      playersList,
      consoleHeader,
      disconnectRConNotice,
      consoleView,
      commandTitle,
      commandForm,
      scheduleHeader,
      scheduleList,
      scheduleEditor,
      configHeader,
      configMeta,
      configFields,
      configNotice,
    );

    serverList.append(card);

    serverCards.set(server.id, {
      card,
      name: server.name,
      rconAuth: rconAuth.value,
      rconCompatible: server.rconCompat,
      rconError,
      rconFallback: rconFallback.value,
      rconStatus: rconStatus.value,
      isProxy: server.isProxy,
      linkedServerIds: Object.freeze([...server.linkedServerIds]),
      linkedStatus: linkedStatus.value,
      linkedList,
      playerStatus: playerStatus.value,
      playersList,
      configMeta,
      configFields,
      configNotice,
      configRevision: null,
      configSaveButton,
      configSavePending: false,
      maintenance: maintenance.value,
      processAlive: processAlive.value,
      serverStatus: serverStatus.value,
      consoleEntries: [],
      consoleView,
      startButton,
      stopButton,
      restartButton,
      maintenanceButton,
      controlNotice,
      lastServerStatus: null,
      commandNotice,
      commandSubmit,
      scheduleList,
      scheduleEditButton,
      scheduleEditor,
      scheduleStartInput,
      rebootUseGlobalInput,
      rebootMotdInput,
      rebootExecInput,
      shutdownUseGlobalInput,
      shutdownMotdInput,
      shutdownExecInput,
      scheduleSaveButton,
      scheduleNotice,
      scheduleSnapshot: null,
      scheduleSavePending: false,
      disconnectRConButton,
      disconnectRConNotice,
    });
  });

  updateProxyLinkedServerStatuses();

  serverPanel.hidden = false;

  if (selectedServerId !== null && serverCards.has(selectedServerId)) {
    showServerDetail(selectedServerId);
  } else {
    showDashboard();
  }
};

/** WebSocketで受信したサーバー稼働状態を、対象カードと操作ボタンへ反映する。 */
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
  cardInfo.serverStatus.dataset.state = status.status;
  cardInfo.maintenance.dataset.state = status.maintenance ? 'enabled' : 'disabled';
  cardInfo.processAlive.dataset.state = status.processAlive ? 'alive' : 'stopped';
  cardInfo.commandSubmit.disabled = status.status !== 'RUNNING';

  cardInfo.lastServerStatus = status;
  updateServerControlButtons(cardInfo, status);
  updateServerConfigEditability(cardInfo, status);
  updateProxyLinkedServerStatuses();
};

/** WebSocketで受信したログイン中プレイヤー一覧を、件数と詳細リストへ反映する。 */
const updateOnlinePlayers = (serverId, status) => {
  const cardInfo = serverCards.get(serverId);

  if (
    typeof cardInfo === 'undefined'
    || typeof status !== 'object'
    || status === null
    || !Array.isArray(status.players)
    || !status.players.every((playerName) => typeof playerName === 'string')
  ) {
    return;
  }

  const players = status.players;
  cardInfo.playerStatus.textContent = players.length === 0
    ? '0 名'
    : `${players.length} 名`;
  cardInfo.playerStatus.dataset.state = players.length === 0 ? 'disabled' : 'alive';

  const entries = players.length === 0
    ? ['ログイン中のプレイヤーはいません。']
    : players;
  const elements = entries.map((playerName) => {
    const item = document.createElement('li');

    item.textContent = playerName;
    return item;
  });

  cardInfo.playersList.replaceChildren(...elements);
};

/** RCON接続・認証・stdinフォールバック状態を対象カードへ反映する。 */
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
  cardInfo.rconStatus.dataset.state = status.status;
  cardInfo.rconAuth.dataset.state = status.authed ? 'authenticated' : 'unauthenticated';
  cardInfo.rconFallback.dataset.state = status.fallbacked ? 'enabled' : 'disabled';
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

/** 代表的なcron式を日本語の簡易説明へ変換し、判別不能な式は null を返す。 */
const describeCronExpression = (expression) => {
  const fields = expression.trim().split(/\s+/);

  if (fields.length === 5) fields.unshift('0');
  if (fields.length !== 6) return null;

  const [second, minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const isNumber = (value) => /^(?:0|[1-9]\d?)$/.test(value);

  if (!isNumber(second) || !isNumber(minute) || !isNumber(hour)) {
    return null;
  }

  const time = second === '0'
    ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    : `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `毎日 ${time}`;
  }

  const weekdayNames = {
    0: '日曜',
    1: '月曜',
    2: '火曜',
    3: '水曜',
    4: '木曜',
    5: '金曜',
    6: '土曜',
    7: '日曜',
  };

  if (
    dayOfMonth === '*'
    && month === '*'
    && Object.hasOwn(weekdayNames, dayOfWeek)
  ) {
    return `毎週 ${weekdayNames[dayOfWeek]} ${time}`;
  }

  if (
    isNumber(dayOfMonth)
    && month === '*'
    && dayOfWeek === '*'
  ) {
    return `毎月 ${Number(dayOfMonth)}日 ${time}`;
  }

  return null;
};

/** ISO日時を日本時間の管理画面向け表示へ整形し、無効値は null とする。 */
const formatScheduleNextRun = (value) => {
  if (typeof value !== 'string') return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
};

/**
 * スケジューラのスナップショットを一覧表示と編集用キャッシュへ反映する。
 * 保存待ちなら、サーバーからの反映通知を成功として編集フォームを閉じる。
 */
const updateScheduleStatus = (serverId, schedule) => {
  const cardInfo = serverCards.get(serverId);

  if (typeof cardInfo === 'undefined' || typeof schedule !== 'object' || schedule === null || !Array.isArray(schedule.tasks)) {
    return;
  }
  cardInfo.scheduleSnapshot = schedule;

  const taskNames = {
    start: 'サーバー起動',
    'reboot-motd': '日次再起動の予告',
    'reboot-exec': '日次再起動',
    'shutdown-motd': '週間停止の予告',
    'shutdown-exec': '週間停止',
  };

  const sourceInfo = document.createElement('div');
  const sourceTitle = document.createElement('dt');
  const sourceValue = document.createElement('dd');

  const rebootSource = schedule.rebootUsesOverride === true
    ? 'このサーバー固有の設定'
    : 'グローバル設定を使用中';

  const shutdownSource = schedule.shutdownUsesOverride === true
    ? 'このサーバー固有の設定'
    : 'グローバル設定を使用中';

  sourceInfo.className = 'server-schedule-source';
  sourceTitle.textContent = '設定元';
  sourceValue.textContent =
    `日次再起動: ${rebootSource} / 週間停止: ${shutdownSource}`;

  sourceInfo.append(sourceTitle, sourceValue);

  const taskElements = [sourceInfo];

  for (const task of schedule.tasks) {
    if (
      typeof task !== 'object'
      || task === null
      || typeof task.name !== 'string'
      || typeof task.expression !== 'string'
      || typeof task.configured !== 'boolean'
      || typeof task.valid !== 'boolean'
    ) {
      continue;
    }

    const item = document.createElement('div');
    const title = document.createElement('dt');
    const summary = document.createElement('dd');
    const state = document.createElement('dd');
    const expression = document.createElement('dd');

    item.className = 'server-schedule-item';
    title.textContent = taskNames[task.name] ?? task.name;

    if (!task.configured) {
      summary.textContent = '設定されていません';
      state.textContent = '無効';
    } else if (!task.valid) {
      summary.textContent = 'cron式が不正です';
      state.textContent = '無効';
    } else {
      summary.textContent =
        describeCronExpression(task.expression)
        ?? '複雑なcron設定';

      const taskStateNames = {
        idle: '待機中',
        running: '実行中',
        stopped: '停止中',
        destroyed: '破棄済み',
      };

      state.textContent = typeof task.taskStatus === 'string'
        ? taskStateNames[task.taskStatus] ?? task.taskStatus
        : '未登録';

      const nextRun = formatScheduleNextRun(task.nextRun);

      if (nextRun !== null) {
        state.textContent += ` / 次回: ${nextRun}`;
      }
    }

    expression.textContent = task.expression.length > 0
      ? `cron式: ${task.expression}`
      : '';

    summary.className = 'server-schedule-item__summary';
    state.className = 'server-schedule-item__state';
    expression.className = 'server-schedule-item__expression';

    item.append(title, summary, state, expression);
    taskElements.push(item);
  }

  cardInfo.scheduleList.replaceChildren(...taskElements);

  if (cardInfo.scheduleSavePending) {
    cardInfo.scheduleSavePending = false;
    cardInfo.scheduleEditor.hidden = true;
    cardInfo.scheduleList.hidden = false;
    cardInfo.scheduleEditButton.hidden = false;
    cardInfo.scheduleSaveButton.disabled = false;
    cardInfo.scheduleNotice.textContent = 'cron設定を保存しました。';
  }
};

/** コンソールイベントを検証し、色分けに必要なログレベル付き表示データへ変換する。 */
const formatConsoleEntry = (entry) => {
  if (
    typeof entry !== 'object'
    || entry === null
    || typeof entry.at !== 'string'
    || typeof entry.source !== 'string'
    || typeof entry.level !== 'string'
    || typeof entry.message !== 'string'
  ) {
    return null;
  }

  const level = ConsoleLogLevels.has(entry.level)
    ? entry.level
    : entry.source === 'stderr' ? 'ERROR' : 'STDOUT';

  return {
    text: `[${entry.at}][${entry.source}] ${entry.message}`,
    level: level,
  };
};

/** コンソール履歴を初期置換または追記し、保持件数を制限して末尾へスクロールする。 */
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

  const consoleLines = cardInfo.consoleEntries.map((entry) => {
    const line = document.createElement('span');

    line.className = `server-console__line server-console__line--${entry.level.toLowerCase()}`;
    line.textContent = entry.text;
    return line;
  });

  cardInfo.consoleView.replaceChildren(...consoleLines);
  cardInfo.consoleView.scrollTop = cardInfo.consoleView.scrollHeight;
};

/** ログアウト時にWebSocket・再接続予約・サーバーカードを破棄して初期状態へ戻す。 */
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

  selectedServerId = null;
  serverDetailContent.replaceChildren();
  serverDetailView.hidden = true;
  dashboardView.hidden = false;

  serverCards.clear();
  serverList.replaceChildren();
  serverPanel.hidden = true;
  setWebSocketStatus('未接続');
};

/** ログアウトAPIを呼び出し、成功・失敗を問わず認証済み画面を終了する。 */
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

/** WebSocket接続を確立し、受信イベントを各表示更新処理へ振り分ける。 */
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
        if (message.type === 'player-status') {
          updateOnlinePlayers(message.serverId, message.status);
          return;
        }
        if (message.type === 'rcon-status') {
          updateRConStatus(message.serverId, message.status);
          return;
        }
        if (message.type === 'schedule-status') {
          updateScheduleStatus(message.serverId, message.status);
          return;
        }
        if (message.type === 'config-content') {
          renderServerConfig(message.serverId, message.config);
          return;
        }
        if (message.type === 'config-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const errors = {
              server_not_found: '対象サーバーが見つかりません。',
              config_not_found: '設定ファイルが見つかりません。',
              config_not_regular_file: '設定ファイルではありません。',
              config_outside_server_root: '設定ファイルの場所が許可範囲外です。',
              config_too_large: '設定ファイルが大きすぎます。',
              config_invalid_utf8: '設定ファイルはUTF-8ではありません。',
              config_format_unsupported: 'この設定形式はまだ未対応です。',
              config_server_running: 'サーバー稼働中は設定を保存できません。',
              config_conflict: '設定ファイルが更新されています。再読込してください。',
              config_invalid_update: '変更できない項目または不正な値が含まれています。',
              config_read_failed: '設定ファイルを読み込めませんでした。',
            };

            cardInfo.configSavePending = false;
            if (cardInfo.lastServerStatus !== null) {
              updateServerConfigEditability(cardInfo, cardInfo.lastServerStatus);
            }
            cardInfo.configNotice.textContent =
              errors[message.error] ?? '設定ファイルを読み込めませんでした。';
          }

          return;
        }

        // スケジュール送信
        if (message.type === 'schedule-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.scheduleNotice.textContent =
              'cron設定を受理しました。反映を待っています。';
          }

          return;
        }
        if (message.type === 'schedule-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.scheduleSavePending = false;
            cardInfo.scheduleSaveButton.disabled = false;
            cardInfo.scheduleNotice.textContent =
              message.error === 'invalid_schedule'
                ? 'cron式または設定値が不正です。'
                : '対象サーバーが見つかりません。';
          }

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
        if (message.type === 'maintenance-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.controlNotice.textContent = message.enabled
              ? 'メンテナンスモードを有効化しました。'
              : 'メンテナンスモードを解除しました。';
          }

          return;
        }

        if (message.type === 'maintenance-rejected') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            cardInfo.controlNotice.textContent =
              message.error === 'server_not_found'
                ? '対象サーバーが見つかりません。'
                : 'メンテナンス設定は拒否されました。';

            if (cardInfo.lastServerStatus !== null) {
              updateServerControlButtons(
                cardInfo,
                cardInfo.lastServerStatus,
              );
            }
          }

          return;
        }

        // サーバーコンソール関連
        if (message.type === 'server-control-submitted') {
          const cardInfo = serverCards.get(message.serverId);

          if (typeof cardInfo !== 'undefined') {
            const actionNames = {
              start: '起動',
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
              maintenance_locked: 'DEPLETED 状態かつメンテナンス有効のため、起動できません。',
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

/** 読み込み中画面を閉じ、ログインフォームを表示する。 */
const showLoginPanel = () => {
  loadingPanel.hidden = true;
  authenticatedPanel.hidden = true;
  loginPanel.hidden = false;
};

/** 認証済みユーザー名を表示し、管理画面とWebSocket接続を開始する。 */
const showAuthenticatedPanel = (username) => {
  loadingPanel.hidden = true;
  loginPanel.hidden = true;
  authenticatedUser.textContent = `ログインユーザー: ${username}`;
  authenticatedPanel.hidden = false;
  shouldMaintainWebSocket = true;
  void connectWebSocket();
};

/** ページ初期化時にHTTPセッションを照会し、表示する画面を決定する。 */
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

/** 切断後の再接続を直列化し、チケット失効時は接続処理を作り直す。 */
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

/** 多重予約を避けながら、一定時間後のWebSocket再接続を予約する。 */
const scheduleWebSocketReconnect = () => {
  if (!shouldMaintainWebSocket || reconnectTimer !== null) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnectWebSocket();
  }, WebSocketReconnectDelayMs);
};

/** ログインAPIへ資格情報を送り、成功時は認証済み画面へ遷移する。 */
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
