# 開発ガイド

## ローカルテスト

### 1. パッケージをローカルでリンク
```bash
# dropcasterディレクトリで
npm link

# 別ディレクトリでテスト
mkdir test-project
cd test-project
npm link dropcaster
```

### 2. GitHubから直接npxでテスト
```bash
# GitHubから直接実行
npx github:yourusername/dropcaster init my-gallery

# 特定のブランチから
npx github:yourusername/dropcaster#feature-branch init my-gallery
```

### 3. ローカルリポジトリから直接npxでテスト
```bash
# ローカルのリポジトリパスを指定して実行
npx /path/to/dropcaster init my-gallery

# 相対パスでも可能
npx ../dropcaster init my-gallery

# カレントディレクトリがdropcasterの場合
npx . init my-gallery
```

### 4. GitHubからインストールしてテスト
```bash
# GitHubからグローバルインストール
npm install -g github:yourusername/dropcaster

# ローカルプロジェクトにインストール
npm install github:yourusername/dropcaster
```

## リリースチェックリスト

npmに公開する前に以下を確認:

- [ ] すべてのコア機能が動作
- [ ] ドキュメントが完成
- [ ] テストがパス
- [ ] ハードコードされたパスや認証情報がない
- [ ] サンプルプロジェクトが正しく動作
- [ ] CLIコマンドがテスト済み
- [ ] ビルドプロセスが安定
- [ ] エラーハンドリングが実装済み
- [ ] package.jsonのメタデータが正しい
- [ ] LICENSEファイルが存在

## バージョン戦略

- `0.x.x` - 開発/ベータ版（破壊的変更を許可）
- `1.0.0` - 最初の安定版リリース
- 1.0.0以降は[セマンティックバージョニング](https://semver.org/)に従う

## テストワークフロー

1. 変更を加える
2. `npm link`を実行してローカルリンクを更新
3. 別プロジェクトでテスト
4. 安定するまで繰り返し
5. 広範囲のテスト用にベータリリースを検討
6. 準備ができたら安定版をリリース

## GitHub経由での配布

### 利点
- npmアカウントが不要
- 即座にアップデート可能
- ブランチごとのテストが簡単
- プライベートリポジトリでも可能（権限があれば）

### 使用例

```bash
# 最新版を使用
npm install github:yourusername/dropcaster

# 特定のタグ/リリースを使用
npm install github:yourusername/dropcaster#v0.1.0

# 特定のコミットを使用
npm install github:yourusername/dropcaster#commit-hash

# プライベートリポジトリから（認証が必要）
npm install git+ssh://git@github.com:yourusername/dropcaster.git
```

### package.jsonでの指定

```json
{
  "dependencies": {
    "dropcaster": "github:yourusername/dropcaster"
  }
}
```

## トラブルシューティング

### npm linkが動作しない場合

```bash
# グローバルリンクを確認
npm ls -g --depth=0 --link=true

# リンクを削除して再作成
npm unlink -g dropcaster
npm link
```

### GitHubインストールでエラーが出る場合

```bash
# キャッシュをクリア
npm cache clean --force

# node_modulesを削除して再インストール
rm -rf node_modules package-lock.json
npm install
```