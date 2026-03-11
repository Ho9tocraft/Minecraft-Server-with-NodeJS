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
        EventEmitter.call(this);
    };
    send(data: string, cmd?: number, id?: number): void {
        let sendBuf: Buffer<ArrayBuffer> | null = null;
        if (this.tcp) {
            cmd = cmd || PacketType.COMMAND;
            id = id || this.rconId;
            const length = byteLength(data);
            sendBuf = alloc(length + 14);
            sendBuf.writeInt32LE(length + 10, 0);
            sendBuf.writeInt32LE(id, 4);
            sendBuf.writeInt32LE(cmd, 8);
            sendBuf.write(data, 12);
            sendBuf.writeInt16LE(0, length + 12);
        } else {
            if (this.challenge && !this._challengeToken) {
                this.emit('error', new Error('Not Authenticated'));
                return;
            }
            let str: string = 'rcon ';
            if (this._challengeToken) str += `${this._challengeToken} `;
            if (this.password) str += `${this.password} `;
            str += `${data}\n`;
            sendBuf = alloc(4 + byteLength(str));
            sendBuf.writeInt32LE(-1, 0);
            sendBuf.write(str, 4);
        }
        this._sendSocket(sendBuf);
    }
    connect(): void {
        if (this.tcp) {
            this._tcpSocket = createConnection(this.port, this.host);
            this._tcpSocket?.on('data', (data) => { this._tcpSocketOnData(typeof data === 'string' ? from(data, 'utf-8') : data); })
                .on('connect', () => { this.socketOnConnect(); })
                .on('error', (err) => { this.emit('error', err); })
                .on('close', () => { this.socketOnEnd(); });
        } else {
            this._udpSocket = createSocket('udp4');
            this._udpSocket.on('message', (data) => { this._udpSocketOnData(data); })
                .on('listening', () => { this.socketOnConnect(); })
                .on('error', (err) => { this.emit('error', err); })
                .on('close', () => { this.socketOnEnd(); });
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
        if (this.tcp) this.send(this.password, PacketType.AUTH);
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
        this.emit('end');
        this.hasAuthed = false;
    }
    protected _sendSocket(buf: Buffer<ArrayBuffer>): void {
        if (this._tcpSocket) this._tcpSocket.write(buf.toString('binary'), 'binary');
        else if (this._udpSocket) this._udpSocket.send(buf, 0, buf.length, this.port, this.host);
    }
    protected _tcpSocketOnData(data: Buffer<ArrayBuffer>): void {
        if (this.outstandingData !== null) {
            data = concat([this.outstandingData, data], this.outstandingData.length + data.length);
            this.outstandingData = null;
        }
        while (data.length >= 12) {
            const len: number = data.readInt32LE(0);
            if (!len) return;
            const packetLen: number = len + 4;
            const bodyLen: number = len - 10;
            if (data.length < packetLen) break;
            if (bodyLen < 0) {
                data = data.subarray(packetLen);
            }
            const id = data.readInt32LE(4);
            const type = data.readInt32LE(8);
            if (id === this.rconId) {
                if (!this.hasAuthed && type === PacketType.RESPONSE_AUTH) {
                    this.hasAuthed = true;
                    this.emit('auth');
                } else if (type === PacketType.RESPONSE_VALUE) {
                    let str = data.toString('utf-8', 12, 12 + bodyLen);
                    if (str.charAt(str.length - 1) === '\n') str = str.substring(0, str.length - 1);
                    this.emit('response', str);
                }
            } else if (id === -1) this.emit('error', new Error('Authentication Failed'));
            else {
                let str = data.toString('utf-8', 12, 12 + bodyLen);
                if (str.charAt(str.length - 1) === '\n') str = str.substring(0, str.length - 1);
                this.emit('server', str);
            }
            data = data.subarray(packetLen);
        }
        this.outstandingData = data;
    }
    protected _udpSocketOnData(data: Buffer<ArrayBuffer>): void {
        const a = data.readUInt32LE(0);
        if (a === 0xffffffff) {
            const str = data.toString('utf-8', 4);
            const tokens = str.split(' ');
            if (tokens.length === 3 && tokens[0] === 'challenge' && tokens[1] === 'rcon' && typeof tokens[2] === 'string') {
                this._challengeToken = substrEmu(tokens[2], 0, tokens[2].length - 1).trim();
                this.hasAuthed = true;
                this.emit('auth');
            } else this.emit('response', substrEmu(str, 1, str.length - 2));
        } else this.emit('error', new Error('Received malformed packet'));
    }
};
