# AI英会話 for Anki — セットアップガイド

## 1. APIキーの取得

### Anthropic (Claude) APIキー

1. [https://console.anthropic.com/](https://console.anthropic.com/) にアクセス
2. アカウント登録（Googleアカウント連携可）またはログイン
3. 左サイドバー **「API Keys」** → **「Create Key」** をクリック
4. 名前を入力（例: `ai-eikaiwa`）して生成
5. 表示された `sk-ant-...` で始まるキーをコピー（再表示不可なのでメモ必須）
6. 月ごとの利用上限（Spending Limit）を設定しておくと安心です

---

## 2. ローカル開発の手順

```bash
# 1. このディレクトリで依存パッケージをインストール
npm install

# 2. 環境変数ファイルを作成
cp .env.example .env.local
# .env.local を開いて ANTHROPIC_API_KEY= の後にキーを貼り付ける

# 3. 開発サーバー起動
npm run dev
# → http://localhost:3000 をスマホ・ブラウザで開く
```

> **スマートフォンからローカルにアクセスする場合**
> PCとスマホが同じWi-Fiに接続している状態で、
> `http://[PCのIPアドレス]:3000` にアクセスしてください。
> IPアドレスは `ipconfig`（Windows）で確認できます。

---

## 3. Vercel へのデプロイ

```bash
# Vercel CLIをインストール（初回のみ）
npm install -g vercel

# デプロイ
vercel

# 本番デプロイ
vercel --prod
```

**Vercel ダッシュボードでの環境変数設定:**

1. [vercel.com](https://vercel.com) でプロジェクトを開く
2. **Settings → Environment Variables**
3. `ANTHROPIC_API_KEY` を追加（Value = コピーしたAPIキー）
4. 全ての環境（Production / Preview / Development）にチェック
5. **Save** → プロジェクトを再デプロイ

---

## 4. AnkiDroidへの取り込み方

1. チャット画面右上の **「Anki」** ボタンをタップ
2. カードを確認・不要なものは削除
3. カードの向きを選択（英→日 または 日→英）
4. **「.apkgをダウンロード」** をタップ
5. ダウンロードされた `.apkg` ファイルをAndroidの「ファイル」アプリで開く
   → AnkiDroidが起動し、**「AI英会話」デッキ**に自動マージされます

> **ヒント:** 毎回同じデッキIDを使用しているため、何度ダウンロードしても
> AnkiDroid上の「AI英会話」デッキに新しいカードが追加されていきます。
> 重複カードはAnkiが自動的にスキップします。

---

## 5. 技術スタック早見表

| 項目 | 技術 |
|---|---|
| フレームワーク | Next.js 15 (App Router) |
| 言語 | TypeScript |
| スタイル | Tailwind CSS |
| AI API | Anthropic Claude (claude-sonnet-4-6) |
| 音声入力 | Web Speech API |
| 音声出力 | Web Speech API SpeechSynthesis |
| .apkg生成 | sql.js (WASM SQLite) + JSZip |
| ホスティング | Vercel |

---

## 6. ファイル構成

```
src/
├── app/
│   ├── layout.tsx              # ルートレイアウト（PWAメタ情報）
│   ├── page.tsx                # メインページ
│   ├── globals.css             # グローバルスタイル
│   └── api/
│       ├── chat/route.ts       # Claude チャット（ストリーミング）
│       ├── extract-cards/route.ts  # Ankiカード抽出（JSON）
│       └── generate-apkg/route.ts  # .apkg生成・ダウンロード
├── components/
│   ├── ChatInterface.tsx       # メインチャット画面
│   ├── MessageBubble.tsx       # メッセージバブル
│   └── AnkiExportModal.tsx     # Ankiエクスポートモーダル
├── hooks/
│   ├── useSpeechRecognition.ts # 音声入力フック
│   └── useSpeechSynthesis.ts   # 音声出力フック
└── lib/
    ├── types.ts                # 型定義
    └── anki-generator.ts       # .apkg生成ロジック
```
