import { EventEmitter } from 'events';
import { createConnection, Socket as tcpSocket } from 'net';
import { createSocket, Socket as dgramSocket } from 'dgram';
import { Buffer } from 'buffer';
import { substrEmu } from './general_utils/string_utils.mjs';

const { byteLength, alloc, concat, from } = Buffer;

const PacketType = {
  COMMAND: 0x02,
  AUTH: 0x03,
  RESPONSE_VALUE: 0x00,
  RESPONSE_AUTH: 0x02
};
const PacketLength = {
  Min: 10,
  MaxPacket: 1024 * 1024,
  MaxBuffer: 1024 * 1024 + 4,
  MaxCommand: 16 * 1024,
};

export const MaxCommandPacketLength = PacketLength.MaxCommand;

export class Rcon extends EventEmitter {
  host: string;
  port: number;
  password: string;
  rconId: number;
  hasAuthed: boolean;
  outstandingData: Buffer<ArrayBuffer> | null;
  tcp: boolean;
  challenge: boolean;
  _tcpSocket: tcpSocket | undefined;
  _udpSocket: dgramSocket | undefined;
  _challengeToken: string | undefined;
  constructor(host: string, port: number, password: string, options?: rconConstructorOptions) {
    super();
    options = options || {
      id: 0x0012d4a6,
      tcp: true,
      challenge: true
    };
    this.host = host;
    this.port = port;
    this.password = password;
    this.rconId = options.id;
    this.hasAuthed = false;
    this.outstandingData = null;
    this.tcp = options.tcp;
    this.challenge = options.challenge;
    this._tcpSocket = undefined;
    this._udpSocket = undefined;
    this._challengeToken = undefined;
    EventEmitter.call(this);
  };
  send(data: string, options: { cmd?: number, id?: number, callback?: () => void }): void {
    const cmd = options.cmd ?? PacketType.COMMAND;
    const id = options.id ?? this.rconId;
    const dataLength = byteLength(data);
    // RCON Protocol's MAXIMUM
    if (dataLength > (PacketLength.MaxPacket - 10)) {
      this._failRconConnection(`OVERPACKET ERROR: detect ${dataLength}, maximum ${PacketLength.MaxPacket}`);
      return;
    }

    /**
     * --------------------------------------------------------------------
     * UI由来通常コマンドは、接続障害ではなく入力拒否 (RconCommandError)
     * サーバー側において、stdin フォールバックモードの起動をトリガーしない
     * --------------------------------------------------------------------
     */
    if (cmd === PacketType.COMMAND && dataLength > PacketLength.MaxCommand) {
      this.emit('error', new RconCommandError(`RCON Command too big! Max: ${PacketLength.MaxCommand} bytes.`));
      return;
    }

    let sendBuf: Buffer<ArrayBuffer>;

    if (this.tcp) {
      sendBuf = alloc(dataLength + 14);
      sendBuf.writeInt32LE(dataLength + 10, 0);
      sendBuf.writeInt32LE(id, 4);
      sendBuf.writeInt32LE(cmd, 8);
      sendBuf.write(data, 12);
      sendBuf.writeInt16LE(0, dataLength + 12);
    } else {
      if (this.challenge && !this._challengeToken) {
        this.emit('error', new RconError(`RCON isn't authenticated.`));
        return;
      }

      const text = `rcon ${this._challengeToken ? `${this._challengeToken} ` : ''}${this.password ? `${this.password} ` : ''}${data}\n`;

      sendBuf = alloc(4 + byteLength(text));
      sendBuf.writeUInt32LE(-1, 0);
      sendBuf.write(text, 4);
    }
    this._sendSocket(sendBuf, options.callback);
  }
  connect(): void {
    if (this.tcp) {
      if (this._tcpSocket) return;
      this._tcpSocket = createConnection({ port: this.port, host: this.host });
      this._tcpSocket?.on('data', (data) => { this._tcpSocketOnData(typeof data === 'string' ? from(data, 'utf-8') : data); })
        .on('connect', () => { this.socketOnConnect(); })
        .on('error', (err) => { this.emit('error', err); })
        .on('close', () => { this.socketOnEnd(); this._tcpSocket = undefined; });
    } else {
      if (this._udpSocket) return;
      this._udpSocket = createSocket({ type: 'udp4', reuseAddr: true });
      this._udpSocket.on('message', (data) => { this._udpSocketOnData(data); })
        .on('listening', () => { this.socketOnConnect(); })
        .on('error', (err) => { this.emit('error', err); })
        .on('close', () => { this.socketOnEnd(); this._udpSocket = undefined; });
      this._udpSocket.bind(0);
    }
  }
  disconnect(): void {
    if (this._tcpSocket) this._tcpSocket.end();
    if (this._udpSocket) this._udpSocket.close();
  }
  setTimeout(timeout: number, callback?: () => {}): void {
    if (!this._tcpSocket) return;
    this._tcpSocket.setTimeout(timeout, () => {
      this._tcpSocket?.end();
      if (callback) callback();
    });
  }
  socketOnConnect(): void {
    this.emit('connect');
    if (this.tcp) this.send(this.password, { cmd: PacketType.AUTH });
    else if (this.challenge) {
      const str = 'challenge rcon\n';
      const sendBuf = alloc(str.length + 4);
      sendBuf.writeInt32LE(-1, 0);
      sendBuf.write(str, 4);
      this._sendSocket(sendBuf);
    } else {
      const sendBuf = alloc(5);
      sendBuf.writeInt32LE(-1, 0);
      sendBuf.writeUInt8(0, 4);
      this._sendSocket(sendBuf);
      this.hasAuthed = true;
      this.emit('auth');
    }
  }
  socketOnEnd(): void {
    this.hasAuthed = false;
    this.outstandingData = null;
    this._challengeToken = undefined;
    this.emit('end');
  }
  isOpen(): boolean {
    if (this.tcp) return this._tcpSocket?.readyState === 'open';
    else return typeof this._udpSocket !== 'undefined';
  }
  protected _sendSocket(buf: Buffer<ArrayBuffer>, callback?: () => void): void {
    try {
      if (this.tcp) {
        const socket = this._tcpSocket;

        if (typeof socket === 'undefined' || socket.destroyed || socket.writableEnded) {
          this._failRconConnection('RCON command cannot be sent: TCP Socket is closed.');
          return;
        }

        socket.write(buf, callback);
      } else {
        if (typeof this._udpSocket === 'undefined') {
          this._failRconConnection('RCON command cannot be sent: UDP Socket is closed.');
          return;
        }

        this._udpSocket.send(buf, 0, buf.length, this.port, this.host, (error) => {
          if (error) this._failRconConnection(error.message);
          else if (callback) callback();
        });
      }
    } catch (error) {
      this._failRconConnection(error instanceof Error ? error.message : `${error}`);
    }
  }
  protected _failRconConnection(message: string): void {
    this.outstandingData = null;
    if (this.tcp) this._tcpSocket?.destroy();
    else this._udpSocket?.close();

    this.emit('error', new RconError(message));
  }
  protected _tcpSocketOnData(data: Buffer<ArrayBuffer>): void {
    // 解析前にデカすぎるやつを黙らせる処理
    const incomingLength = data.length + (this.outstandingData?.length ?? 0);
    const preParseMax = Math.ceil(PacketLength.MaxBuffer * 1.2);
    if (incomingLength > preParseMax) {
      this._failRconConnection(`Malformed RCON Packet: receive burset exceeds ${preParseMax} bytes.`);
      return;
    }

    if (this.outstandingData !== null) {
      data = concat([this.outstandingData, data], this.outstandingData.length + data.length);
      this.outstandingData = null;
    }

    while (data.length >= 4) {
      const packetBodyLength = data.readInt32LE(0);

      if (packetBodyLength < PacketLength.Min || packetBodyLength > PacketLength.MaxPacket) {
        this._failRconConnection(`Malformed RCON Packet Length: ${packetBodyLength}`);
        return;
      }

      const packetLength = packetBodyLength + 4;

      if (data.length < packetLength) break;

      if (data[packetLength - 2] !== 0 || data[packetLength - 1] !== 0) {
        this._failRconConnection('MalFormed RCON Packet: Missing NUL TERMINATORS.');
        return;
      }

      const inBodyLength = packetBodyLength - 10;
      const _Id = data.readInt32LE(4);
      const _Type = data.readInt32LE(8);

      if (_Type !== PacketType.RESPONSE_VALUE && _Type !== PacketType.RESPONSE_AUTH) {
        this._failRconConnection(`Malformed RCON Packet Type: ${_Type.toString(16)}`);
        return;
      }
      const text = data.toString('utf-8', 12, 12 + inBodyLength);

      if (!this.hasAuthed && _Type === PacketType.RESPONSE_AUTH) {
        if (_Id === -1) {
          this._failRconConnection('RCON Auth FAILED.');
          return;
        }
        if (_Id !== this.rconId) {
          this._failRconConnection(`Unexpected RCON Auth Response ID: ${_Id}`);
          return;
        }

        this.hasAuthed = true;
        this.emit('auth');
      } else if (_Id === this.rconId && _Type === PacketType.RESPONSE_VALUE) this.emit('response', text);
      else {
        this.emit('server', text);
      }

      data = data.subarray(packetLength);
    }
    // 解析後
    if (data.length > PacketLength.MaxBuffer) {
      this._failRconConnection(`Malformed RCON Packet: incomplete buffered data exceeds ${PacketLength.MaxBuffer} bytes.`);
      return;
    }

    this.outstandingData = data.length > 0 ? data : null;
  }
  protected _udpSocketOnData(data: Buffer<ArrayBuffer>): void {
    if (data.length < 4 || data.length > PacketLength.MaxPacket) {
      this._failRconConnection(`Malformed UDP RCON Packet Length: ${data.length}`);
      return;
    }

    if (data.readUInt32LE(0) !== 0xffffffff) {
    this._failRconConnection('Malformed UDP RCON Packet Header.');
    return;
  }

  const str = data.toString('utf-8', 4);

  if (this.challenge && !this.hasAuthed) {
    const tokens = str.split(' ');

    if (tokens.length === 3 && tokens[0] === 'challenge' && tokens[1] === 'rcon' && typeof tokens[2] === 'string') {
      const token = substrEmu(tokens[2], 0, tokens[2].length - 1).trim();

      if (token.length > 0) {
        this._challengeToken = token;
        this.hasAuthed = true;
        this.emit('auth');
        return;
      }
    }

    this._failRconConnection('Malformed UDP RCON challenge response.');
    return;
  }

  this.emit('response', substrEmu(str, 1, str.length - 2));
  }
};

export class RconError extends Error {
  override name = 'RconError';
}

export class RconCommandError extends RconError {
  override name = 'RconCommandError';
}
