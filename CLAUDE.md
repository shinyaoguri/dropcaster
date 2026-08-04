# CLAUDE.md

dropcaster — OpenProcessing 作品をブラウザベースの投影マッピングで使うツール。
使い方・アーキテクチャは [README.md](README.md)、このリポジトリ自体の開発手順は
[DEVELOPMENT.md](DEVELOPMENT.md) が正本。ここでは繰り返さない。

## 記録の規約（セッション記憶は揮発する前提）

状況・発見した課題・タスク・進捗・設計判断は、会話やセッション記憶ではなくリポジトリに記録し、
**記憶ゼロの新しいセッションが Issue / PR / docs だけで作業を再開できる状態**を常に保つ。

| 記録するもの | 置き場 |
|---|---|
| 課題・タスク・アイデア | GitHub Issue。`.github/ISSUE_TEMPLATE/task.yml` の構成（目的・完了条件・優先度）に合わせて自己完結に書く。起票前に `gh issue list --search` で重複確認 |
| 作業の進捗・中断時の状態 | 対象 Issue / PR のコメント（何をどこまで・次に何を・詰まった点） |
| 実装の意図・変更内容・確認方法 | PR 本文。WIP でも Draft PR を早めに開いて経過を残す |
| 設計判断・検討して断念した方向 | `docs/decisions/`（軽量 ADR。1 判断 1 ファイル、状態 / 文脈 / 決定 / 影響の 4 節） |
| 使い方・仕様の変化 | README.md |

- 作業を中断・終了するときは、再開に必要な文脈を上記いずれかに書き残してから終える
- Issue を閉じるときは、結論（何をしてどうなったか。やらない判断ならその理由）をコメントに残す

## コマンド

開発コマンド（dev / build / scan など）と CLI のローカルテスト手順は DEVELOPMENT.md を参照。
テストは `npm test`（node --test、`tests/`）。

## 壊してはいけない前提

- スケッチは**同一オリジン・sandbox なし iframe** で実行する。`captureStream` を tainted に
  しないための意図的設計（[ADR 0001](docs/decisions/0001-same-origin-sandboxless-iframe.md)）。
  変更するなら [#35](https://github.com/shinyaoguri/dropcaster/issues/35) の検討を経ること
- 投影出力の画質は canvas バッキングストア解像度だけで決まる設計。表示ウィンドウ側の
  解像度に依存させない（[ADR 0002](docs/decisions/0002-canvas-backing-store-decides-quality.md)）
- `src/viewer/` はユーザーギャラリーとホスト版（`apps/web/`）で共有。viewer の変更は両方の
  経路で確認する
