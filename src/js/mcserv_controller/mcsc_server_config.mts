import { createHash } from 'crypto';
import { readFile, realpath, stat } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import writeFileAtomic from 'write-file-atomic';
import { type MinecraftServerBase, type ServerConfigFileInfo } from '../minecraft/servers.mjs';

const MaxServerConfigBytes = 1024 * 1024;

export type ServerConfigFieldMode = 'text' | 'boolean' | 'select' | 'readonly';
export type ServerConfigField = Readonly<{
  key: string,
  label: string,
  value: string,
  mode: ServerConfigFieldMode,
  options?: readonly string[],
  notice?: string,
}>;
export type ServerConfigReadErrorCode =
  | 'config_not_found'
  | 'config_not_regular_file'
  | 'config_outside_server_root'
  | 'config_too_large'
  | 'config_invalid_utf8'
  | 'config_format_unsupported'
  | 'config_server_running'
  | 'config_conflict'
  | 'config_invalid_update'
  | 'config_read_failed';

export type ServerConfigSnapshot = Readonly<{
  file: ServerConfigFileInfo,
  revision: string,
  bytes: number,
  fields: readonly ServerConfigField[],
}>;
export type ServerConfigChange = Readonly<{ key: string, value: string }>;

export class ServerConfigReadError extends Error {
  public readonly code: ServerConfigReadErrorCode;

  public constructor(code: ServerConfigReadErrorCode) {
    super(code);
    this.code = code;
  }
}

const isPathWithinRoot = (root: string, target: string): boolean => {
  const relativePath = relative(root, target);

  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
};

const buildField = (
  key: string,
  value: string,
  mode: ServerConfigFieldMode,
  options?: readonly string[],
  notice?: string,
  label?: string,
): ServerConfigField => {
  const field: { key: string, label: string, value: string, mode: ServerConfigFieldMode, options?: readonly string[], notice?: string } = {
    key,
    label: label ?? key,
    value,
    mode,
  };

  if (typeof options !== 'undefined') field.options = Object.freeze([...options]);
  if (typeof notice !== 'undefined') field.notice = notice;

  return Object.freeze(field);
};

/** 標準 server.properties 項目の画面表示用日本語名。未知の項目は設定キーをそのまま表示する。 */
const ServerPropertiesLabels: Readonly<Record<string, string>> = Object.freeze({
  'accepts-transfers': '接続転送を許可',
  'allow-flight': '飛行を許可',
  'allow-nether': 'ネザーを許可',
  'broadcast-console-to-ops': 'コンソール出力をOPへ送信',
  'broadcast-rcon-to-ops': 'RCON出力をOPへ送信',
  'bug-report-link': 'バグ報告URL',
  'debug': 'デバッグモード',
  'difficulty': '難易度',
  'enable-command-block': 'コマンドブロックを有効化',
  'enable-jmx-monitoring': 'JMX監視を有効化',
  'enable-query': 'Queryを有効化',
  'enable-rcon': 'RCONを有効化',
  'enable-status': 'サーバー状態応答を有効化',
  'enforce-secure-profile': 'セキュアプロフィールを強制',
  'enforce-whitelist': 'ホワイトリストを強制',
  'entity-broadcast-range-percentage': 'エンティティ送信距離の割合',
  'force-gamemode': 'ゲームモードを強制',
  'function-permission-level': 'function実行権限レベル',
  'gamemode': 'ゲームモード',
  'generate-structures': '構造物を生成',
  'generator-settings': 'ワールド生成設定',
  'hardcore': 'ハードコアモード',
  'hide-online-players': 'オンラインプレイヤーを非表示',
  'initial-disabled-packs': '初期無効データパック',
  'initial-enabled-packs': '初期有効データパック',
  'level-name': 'ワールド名',
  'level-seed': 'ワールドシード',
  'level-type': 'ワールドタイプ',
  'log-ips': 'IPアドレスをログへ記録',
  'max-chained-neighbor-updates': '連鎖近傍更新の最大数',
  'max-players': '最大プレイヤー数',
  'max-tick-time': '最大Tick時間',
  'max-world-size': '最大ワールドサイズ',
  'motd': 'サーバー説明',
  'network-compression-threshold': 'ネットワーク圧縮のしきい値',
  'online-mode': 'オンラインモード',
  'op-permission-level': 'OP権限レベル',
  'pause-when-empty-seconds': '無人時の一時停止までの秒数',
  'player-idle-timeout': 'プレイヤー放置キック時間（分）',
  'prevent-proxy-connections': 'プロキシ接続を拒否',
  'pvp': 'PvPを有効化',
  'query.port': 'Queryポート',
  'rate-limit': 'パケットレート制限',
  'rcon.port': 'RCONポート',
  'region-file-compression': 'リージョンファイル圧縮方式',
  'require-resource-pack': 'リソースパックを必須化',
  'resource-pack': 'リソースパックURL',
  'resource-pack-id': 'リソースパックID',
  'resource-pack-prompt': 'リソースパック案内文',
  'resource-pack-sha1': 'リソースパックSHA-1',
  'server-ip': '待受IPアドレス',
  'server-port': 'サーバーポート',
  'simulation-distance': 'シミュレーション距離',
  'spawn-animals': '動物をスポーン',
  'spawn-monsters': 'モンスターをスポーン',
  'spawn-npcs': 'NPCをスポーン',
  'spawn-protection': 'スポーン保護範囲',
  'sync-chunk-writes': 'チャンク書込を同期化',
  'text-filtering-config': 'テキストフィルター設定',
  'use-native-transport': 'ネイティブネットワーク転送を使用',
  'view-distance': '描画距離',
  'white-list': 'ホワイトリストを有効化',
});

/** Velocityのルート設定項目の画面表示用日本語名。 */
const VelocityTomlLabels: Readonly<Record<string, string>> = Object.freeze({
  'bind': '待受アドレス',
  'motd': 'サーバー説明',
  'show-max-players': '最大プレイヤー数を表示',
  'online-mode': 'オンラインモード',
  'force-key-authentication': '公開鍵認証を強制',
  'prevent-client-proxy-connections': 'クライアントのプロキシ接続を拒否',
  'player-info-forwarding-mode': 'プレイヤー情報転送方式',
  'forwarding-secret-file': '転送シークレットファイル',
  'announce-forge': 'Forgeクライアントへ通知',
  'kick-existing-players': '重複ログイン時に既存接続を切断',
  'ping-passthrough': 'Ping応答の転送方式',
  'enable-player-address-logging': 'プレイヤーIPアドレスをログへ記録',
  'log-command-executions': 'コマンド実行をログへ記録',
  'log-player-connections': 'プレイヤー接続をログへ記録',
  'log-player-info': 'プレイヤー情報をログへ記録',
  'show-ping-requests': 'Pingリクエストを表示',
  'failover-on-unexpected-server-disconnect': '予期しない接続先切断時にフェイルオーバー',
  'announce-proxy-commands': 'プロキシコマンドを通知',
  'haproxy-protocol': 'HAProxyプロトコルを使用',
  'compression-level': '圧縮レベル',
  'login-ratelimit': 'ログイン試行レート制限',
  'connection-timeout': '接続タイムアウト（ミリ秒）',
  'read-timeout': '読取タイムアウト（ミリ秒）',
  'enable-reuse-port': 'ポート再利用を有効化',
  'command-rate-limit': 'コマンド送信レート制限',
  'forward-commands-if-rate-limited': 'レート制限時もコマンドを転送',
  'kick-after-rate-limited-commands': 'コマンド制限超過時に切断',
  'tab-complete-rate-limit': 'タブ補完レート制限',
  'kick-after-rate-limited-tab-completes': 'タブ補完制限超過時に切断',
  'config-version': '設定ファイルバージョン',
});

const buildPropertiesFields = (content: string): readonly ServerConfigField[] => {
  const hiddenKeys = new Set(['rcon.password']);
  const readOnlyKeys = new Set(['gamemode', 'difficulty', 'config-version']);
  const fields = new Map<string, ServerConfigField>();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!\s:=][^:=\s]*)\s*(?:=|:)\s*(.*)$/);
    if (match === null) continue;

    const key = match[1];
    if (typeof key !== 'string') continue;
    const value = match[2] ?? '';
    const normalizedKey = key.toLowerCase();

    if (hiddenKeys.has(normalizedKey)) continue;

    const mode: ServerConfigFieldMode = readOnlyKeys.has(normalizedKey)
      ? 'readonly'
      : /^(?:true|false)$/i.test(value.trim())
        ? 'boolean'
        : 'text';

    fields.set(key, buildField(key, value, mode, undefined, undefined, ServerPropertiesLabels[normalizedKey]));
  }

  return Object.freeze([...fields.values()]);
};

/** TOMLの # コメントを、引用符で囲まれた文字列内の # と区別して分離する。 */
const splitTomlComment = (line: string): Readonly<{ assignment: string, comment: string }> => {
  let quote: 'single' | 'double' | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote === 'double' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === 'double' && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quote = quote === 'double' ? null : quote === null ? 'double' : quote;
      continue;
    }
    if (char === "'") {
      quote = quote === 'single' ? null : quote === null ? 'single' : quote;
      continue;
    }
    if (char === '#' && quote === null) {
      return Object.freeze({ assignment: line.slice(0, index), comment: line.slice(index) });
    }
  }

  return Object.freeze({ assignment: line, comment: '' });
};

const buildVelocityFields = (content: string): readonly ServerConfigField[] => {
  const fields = new Map<string, ServerConfigField>();
  let sectionName: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);

    if (sectionMatch !== null) {
      sectionName = sectionMatch[1]?.trim() ?? null;
      continue;
    }

    if (sectionName !== null) continue;

    const { assignment } = splitTomlComment(line);
    const match = assignment.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
    if (match === null) continue;

    const key = match[1];
    if (typeof key !== 'string') continue;
    const rawValue = match[2] ?? '';
    const quotedValue = rawValue.match(/^(["'])(.*)\1$/);
    const value = typeof quotedValue?.[2] === 'string'
      ? quotedValue[2]
      : rawValue;
    let field: ServerConfigField;

    if (key === 'forwarding-secret-file' || key === 'config-version') {
      field = buildField(key, value, 'readonly', undefined, undefined, VelocityTomlLabels[key]);
    } else if (key === 'player-info-forwarding-mode') {
      field = buildField(
        key,
        value,
        'select',
        ['none', 'legacy', 'bungeeguard', 'modern'],
        'none はプレイヤー情報転送を行わないため非推奨です。',
        VelocityTomlLabels[key],
      );
    } else if (key === 'ping-passthrough') {
      field = buildField(
        key,
        value,
        'select',
        ['disabled', 'mods', 'description', 'all'],
        undefined,
        VelocityTomlLabels[key],
      );
    } else {
      field = buildField(
        key,
        value,
        /^(?:true|false)$/i.test(value) ? 'boolean' : 'text',
        undefined,
        undefined,
        VelocityTomlLabels[key],
      );
    }

    fields.set(key, field);
  }

  return Object.freeze([...fields.values()]);
};

const extractServerConfigFields = (
  file: ServerConfigFileInfo,
  content: string,
): readonly ServerConfigField[] => {
  if (file.format === 'properties') return buildPropertiesFields(content);
  if (file.format === 'toml') return buildVelocityFields(content);

  throw new ServerConfigReadError('config_format_unsupported');
};

const replacePropertiesValues = (content: string, changes: ReadonlyMap<string, string>): string => {
  return content.split(/(\r?\n)/).map((part) => {
    const match = part.match(/^(\s*([^#!\s:=][^:=\s]*)(\s*(?:=|:)\s*))(.*)$/);
    const key = match?.[2];
    const prefix = match?.[1];

    if (typeof key !== 'string' || typeof prefix !== 'string' || !changes.has(key)) return part;
    return `${prefix}${changes.get(key) ?? ''}`;
  }).join('');
};

const replaceVelocityValues = (content: string, changes: ReadonlyMap<string, string>): string => {
  let sectionName: string | null = null;

  return content.split(/(\r?\n)/).map((part) => {
    const sectionMatch = part.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch !== null) {
      sectionName = sectionMatch[1]?.trim() ?? null;
      return part;
    }
    if (sectionName !== null) return part;

    const { assignment, comment } = splitTomlComment(part);
    const match = assignment.match(/^(\s*([A-Za-z0-9_-]+)\s*=\s*)(.*?)\s*$/);
    const key = match?.[2];
    const prefix = match?.[1];
    const originalValue = match?.[3];
    if (typeof key !== 'string' || typeof prefix !== 'string' || typeof originalValue !== 'string' || !changes.has(key)) return part;

    const value = changes.get(key) ?? '';
    const replacement = originalValue.startsWith('"') ? JSON.stringify(value)
      : originalValue.startsWith("'") ? `'${value.replaceAll("'", "\\'")}'`
      : value;
    return `${prefix}${replacement}${comment}`;
  }).join('');
};

/**
 * 管理対象サーバーの固定設定ファイルだけを、UTF-8・サイズ・実パス検証付きで読み込む。
 * 生テキストは秘密値を含み得るため返却せず、後段で許可フィールドだけを抽出して公開する。
 * revision は後段の保存時に楽観ロックとして使用する、元バイト列の SHA-256 である。
 */
export const readServerConfig = async (
  server: MinecraftServerBase,
): Promise<ServerConfigSnapshot> => {
  const file = server.getServerConfigFile();
  let serverRoot: string;

  try {
    serverRoot = await realpath(server.srvCwd);
  } catch {
    throw new ServerConfigReadError('config_read_failed');
  }

  const requestedPath = resolve(serverRoot, file.fileName);

  if (!isPathWithinRoot(serverRoot, requestedPath)) {
    throw new ServerConfigReadError('config_outside_server_root');
  }

  let fileStats;

  try {
    fileStats = await stat(requestedPath);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new ServerConfigReadError('config_not_found');
    }

    throw new ServerConfigReadError('config_read_failed');
  }

  if (!fileStats.isFile()) {
    throw new ServerConfigReadError('config_not_regular_file');
  }

  if (fileStats.size > MaxServerConfigBytes) {
    throw new ServerConfigReadError('config_too_large');
  }

  let resolvedFilePath: string;

  try {
    resolvedFilePath = await realpath(requestedPath);
  } catch {
    throw new ServerConfigReadError('config_not_found');
  }

  if (!isPathWithinRoot(serverRoot, resolvedFilePath)) {
    throw new ServerConfigReadError('config_outside_server_root');
  }

  let rawContent: Buffer;

  try {
    rawContent = await readFile(resolvedFilePath);
  } catch {
    throw new ServerConfigReadError('config_read_failed');
  }

  let content: string;

  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(rawContent);
  } catch {
    throw new ServerConfigReadError('config_invalid_utf8');
  }

  return Object.freeze({
    file,
    revision: createHash('sha256').update(rawContent).digest('hex'),
    bytes: rawContent.byteLength,
    fields: extractServerConfigFields(file, content),
  });
};

/** 停止中のサーバー設定へ、許可された既存キーだけをrevision照合付きで原子的に保存する。 */
export const writeServerConfig = async (
  server: MinecraftServerBase,
  revision: string,
  changes: readonly ServerConfigChange[],
): Promise<ServerConfigSnapshot> => {
  if (server.getServStatus().processAlive) throw new ServerConfigReadError('config_server_running');
  const current = await readServerConfig(server);
  if (current.revision !== revision) throw new ServerConfigReadError('config_conflict');
  if (changes.length === 0) return current;

  const editableFields = new Map(current.fields
    .filter((field) => field.mode !== 'readonly')
    .map((field) => [field.key, field] as const));
  const changeMap = new Map<string, string>();
  for (const change of changes) {
    const field = editableFields.get(change.key);
    if (typeof field === 'undefined' || change.value.length > 1024) {
      throw new ServerConfigReadError('config_invalid_update');
    }
    if (field.mode === 'boolean' && !/^(?:true|false)$/i.test(change.value)) throw new ServerConfigReadError('config_invalid_update');
    if (field.mode === 'select' && !field.options?.includes(change.value)) throw new ServerConfigReadError('config_invalid_update');
    changeMap.set(change.key, change.value);
  }

  const file = server.getServerConfigFile();
  const serverRoot = await realpath(server.srvCwd);
  const filePath = resolve(serverRoot, file.fileName);
  const resolvedFilePath = await realpath(filePath);
  if (!isPathWithinRoot(serverRoot, resolvedFilePath)) throw new ServerConfigReadError('config_outside_server_root');
  const rawContent = await readFile(resolvedFilePath, 'utf-8');
  const output = file.format === 'properties'
    ? replacePropertiesValues(rawContent, changeMap)
    : file.format === 'toml'
      ? replaceVelocityValues(rawContent, changeMap)
      : (() => { throw new ServerConfigReadError('config_format_unsupported'); })();
  await writeFileAtomic(resolvedFilePath, output, { encoding: 'utf-8' });
  return readServerConfig(server);
};
