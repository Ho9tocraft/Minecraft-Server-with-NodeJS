# Minecraft Server Controller (Powered by Node.js 26.7.0 LTS)
## 概要
## セットアップガイド
### インストール
1. nodeの最新版をインストールしてください。
2. git cloneします。
3. コマンドラインで「npm i」を実行してください。
4. `mcsc_webui.env.default`を`mcsc_webui.env`にリネームします。
### サーバーインスタンス セットアップガイド
事故防止のため、**必ず**手動で行って下さい。
> [!CAUTION]
> 「OpenSSL導入なんざめんどくせー！」という人向けに、「plaintext」モードも存在します。その場合、安全性が完全に欠如しますが、より簡単に実装することができます。
> OpenSSLによる暗号化を行うとき、「必ず」`-salt`が存在するコマンドにして下さい。断じて、`-nosalt`を使わないで下さい。

1. 必要なアプリケーション  
  安全性を高めるため、rconパスワードはシンプルながらもやや複雑に暗号化を施す必要があります。
  - できるだけ機能の多いテキストエディタ (推奨: Visual Studio Code)
  - OpenSSL (可能な限り、最新版を使用すること)
  - 暗号化を行うWebサイト
1. 手順
  1. SSHなどで、サーバーフォルダを作成し、その中にサーバー本体をダウンロードして導入する。
  2. *eula.txt*作成と、*server.properties*作成のため、SSHを駆使して、modやplugin導入前に空起動する。また同時に、*eula.txt*は*true*にする。
  3. *server.properties*を編集し、*enable-rcon*を*true*に、*rcon.port*を調整し、*rcon.password*を記入する(※項目がない場合、自分で追加すること)。
  4. *rcon.password*で記入した内容を、外部サイトを使って**Base64**に変換。生成されたものを、続けて**16進数文字列**に変換。
  5. *rcon.password*を二重に変換した*16進数文字列*を、**OpenSSLを使って暗号化**。暗号化方式は*AES-256-CBC*で、Base64であり、必ずpbkdf2とパスフレーズを設定すること。  
    出てきた暗号(パスワード)は、必ず控えておくこと。コマンド例は以下の通り。  
    ```bash
    echo 54455354 | openssl enc -salt -e -aes-256-cbc -base64 -k PASSPHRASE -pbkdf2 -iter 10000 -md sha256
    ```
  6. 暗号化の際に使ったパスフレーズを、外部サイトを使って**Base64**に変換。生成されたものを、続けて**16進数文字列**に変換。
  7. 簡素なJSON文字列を作成する。
  8. 作成したJSON文字列を、外部サイトを使って**Base64**に変換。
  9. 本プログラムのdataディレクトリ内にある、*server_data.json*を編集する。

### systemdによる常駐運用

[`systemd/mcserv-controller.service.example`](systemd/mcserv-controller.service.example) を `/etc/systemd/system/mcserv-controller.service` へ配置する前に、次の値を実環境の値へ置換します。

- `User` と `Group`: **root以外**の、専用運用ユーザー
- `WorkingDirectory`: プロジェクトの絶対パス
- `ExecStart`: 当該ユーザーが所有するNode.js実行ファイルの絶対パス

`nvm` はsystemdから自動では読み込まれないため、`ExecStart` に `node` や `nvm` の相対パスは使えません。ユニットは `SIGTERM` を受けると、WebUIの受付を止めてから各Minecraftサーバーの正常停止を待機します。`TimeoutStopSec=210s` はこの待機時間です。

### WebUIの直接HTTPS運用と証明書更新

SSHリモートポートフォワードで公開する場合も、WebUI自身でTLSを終端できます。`mcsc_webui.env` を次のように設定します。`MCSC_TRUST_PROXY=false` は維持してください。

```dotenv
MCSC_WEB_HOST=127.0.0.1
MCSC_WEB_PORT=11110
MCSC_WEB_ORIGIN=https://your-hostname.example:11110
MCSC_TRUST_PROXY=false
MCSC_COOKIE_SECURE=true
MCSC_TLS_CERT_FILE=./tls/fullchain.pem
MCSC_TLS_KEY_FILE=./tls/privkey.pem
```

WebUIをrootで実行したり、`/etc/letsencrypt/live/.../privkey.pem` を直接読ませたりしてはいけません。Certbot用root処理とWebUI実行ユーザーを分離するため、[`systemd/mcserv-controller-cert-deploy-hook.example`](systemd/mcserv-controller-cert-deploy-hook.example) を使います。

1. ファイル内の `__MCSC_USER__`、`__MCSC_GROUP__`、`__MCSC_PROJECT_DIR__`、必要なら `MCSC_SERVICE` を実値へ置換する。`__MCSC_PROJECT_DIR__` はsystemdユニットの `WorkingDirectory` と同じ絶対パスにする。
2. `/usr/local/sbin/mcserv-controller-cert-deploy` としてroot所有・`0755`で配置する。
3. 初回は次をrootで一度実行し、発行済み証明書をプロジェクト配下の `tls/` へコピーする。

```bash
RENEWED_LINEAGE=/etc/letsencrypt/live/your-hostname.example \
  /usr/local/sbin/mcserv-controller-cert-deploy
```

4. `/etc/letsencrypt/renewal-hooks/deploy/` に同スクリプトへの実行可能なシンボリックリンクを置く。以後、Certbotが証明書を更新した時だけ、専用ユーザーが読める証明書・秘密鍵へ差し替えられる。WebUIは `SIGHUP` でTLS証明書だけを再読込するため、Minecraftサーバーは停止しない。

```bash
ln -s /usr/local/sbin/mcserv-controller-cert-deploy \
  /etc/letsencrypt/renewal-hooks/deploy/mcserv-controller-cert-deploy
```
