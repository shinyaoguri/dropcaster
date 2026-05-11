#!/bin/bash

# ローカルテスト用スクリプト
# 使い方: ./src/core/local-test.sh [project-name]

PROJECT_NAME=${1:-test-gallery}
DROPCASTER_DIR=$(pwd)
TEST_DIR="/tmp/dropcaster-test/$PROJECT_NAME"

echo "🚀 Creating test project: $PROJECT_NAME"

# テストディレクトリを作成
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# initコマンドを実行
node "$DROPCASTER_DIR/src/cli/index.js" init -n "$PROJECT_NAME"

# テストプロジェクトに移動
cd "$TEST_DIR/../$PROJECT_NAME"

# ローカルパッケージを使用するようpackage.jsonを修正
sed -i '' "s|\"@dropcaster/viewer\": .*|\"@dropcaster/viewer\": \"file:$DROPCASTER_DIR\"|" package.json

echo "📦 Installing dependencies..."
npm install

echo "✅ Test project ready!"
echo ""
echo "Next steps:"
echo "  cd $TEST_DIR/../$PROJECT_NAME"
echo "  npm run scan"
echo "  npm run dev"
echo ""
echo "Your test project is located at: $TEST_DIR/../$PROJECT_NAME"