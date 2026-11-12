# エージェントの開発環境

共通規約は [AGENTS.md](../AGENTS.md)。環境構築と検証コマンドは [DEVELOPMENT.md](../DEVELOPMENT.md)。
この手順はリポジトリ内で完結し、個人のプラグインやモデル設定を要求しない。

## 読み込みとスキル

Claude Code は root の `CLAUDE.md` から `AGENTS.md` を読み、スキルは `.claude/skills/` を読む。
Codex は root の `AGENTS.md` と `.agents/skills/` の相対 symlink から同じスキルを読む。
symlink を含めて checkout する。自動発見しない環境では次の正本を直接読む。

| 場面 | スキル |
| --- | --- |
| 未トリアージの調査・着手前の確認 | [stock-triage](../.claude/skills/stock-triage/SKILL.md) |
| バグ修正後の独立した反証 | [bug-refute](../.claude/skills/bug-refute/SKILL.md) |
| 表示・動き・出力の before/after | [visual-evidence](../.claude/skills/visual-evidence/SKILL.md) |

スキルを個人ディレクトリへコピーしない。追加の hook や `.codex/config.toml` は不要。
`.claude/settings.json` の既存コマンド許可は維持する。利用できるブラウザ・エージェント・添付機能は
製品とセッションごとに確認し、手順が読めることを実行可能の証拠にしない。

## GitHub とラベル

実行環境から `gh auth status` を確認し、対象リポジトリの既存認証を使う。
秘密をリポジトリに置かず、個人設定・認証・権限を勝手に変更しない。

メンテナが初回に用意するラベル (既存なら作り直さない):

```bash
gh label create 'verify: triaged' --color 0E8A16 --description '現行コードで完了条件を確認済み・着手可能'
gh label create 'status: in progress' --color FBCA04 --description '作業中'
```

実装可能な Issue は native の検索で一覧する:

```bash
gh issue list --state open --label 'verify: triaged' --search '-label:"status: in progress"' --limit 100
```

一覧は推薦順や自動実行キューではない。選ぶ際に優先度、sub-issue、blocked by の未解決依存と
最新の完了条件を確認する。既存 Issue にトリアージ印を一括で付けない。
着手時に進行中ラベルを付け、中断・merge 後に外す。issue close 時の自動解除 hook は設けない。

## 記録と PR

プラン・経過は Issue / PR に直接残す。一時ファイルは投稿の材料にだけ使い、再開の正本にしない。
長文は先頭に要約と人の判断事項、投稿末尾にエージェント名と分かる範囲のモデル名を付ける。
`gh issue comment` / `gh pr comment` / `gh pr create` は `--body-file` を使うと改行を保てる。
例: `Assisted by Codex (GPT-6)`。ブラウザや MCP から投稿するときも同じ形にする。

PR は製品のセッションに関連付ける。Codex では利用可能なら PR の attach 機能を使う。
CI とレビューを受けて必要な修正を行い、待機や監視は利用製品の機能と委任範囲に従う。
PR チェックの名前は `verify` と `pr-policy`。管理権限がない場合は branch protection の適用済みと
推測しない。変更が必要ならメンテナが両チェックの設定を確認する。
