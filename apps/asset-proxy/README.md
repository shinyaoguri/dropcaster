# dropcaster asset proxy

dropcaster viewer から OpenProcessing 作品をフル機能で読むための Cloudflare Worker。

OP の CDN (`https://deckard.openprocessing.org`) は `Access-Control-Allow-Origin` を返さない。viewer は iframe 内 canvas を `captureStream` で投影出力に流すため、アセットがある作品では canvas が tainted になり captureStream が黒フレームになってしまう。この Worker は OP CDN を同一オリジン化して CORS ヘッダを後付けし、その問題を回避する。

## 開発

```sh
cd apps/asset-proxy
npm install
npm run dev      # ローカル: http://localhost:8787/user.../X.png
```

## デプロイ

Cloudflare アカウントが必要。`wrangler login` 済みであれば:

```sh
npm run deploy
```

デプロイ先 URL は `https://dropcaster-asset-proxy.<your-account>.workers.dev`。viewer の設定 (`assetProxyBaseUrl`) にこの URL を入れる。

無料枠は 1 日 100,000 リクエスト。エッジキャッシュを 30 日に振っているので、人気スケッチは初回以外ほとんど Cache HIT になる想定。

## 動作確認

```sh
# CORS ヘッダが付いて返ることの確認
curl -i -H 'Origin: https://dropcaster.soui.dev' \
  https://dropcaster-asset-proxy.<account>.workers.dev/user110137/visual971813/h633916068bd1b407c34c836e090f1ba2/Sargeant-Square.png

# 期待されるヘッダ:
#   access-control-allow-origin: *
#   cache-control: public, max-age=86400, s-maxage=2592000, immutable
```

## 設計メモ

- `ALLOWED_PREFIXES = ['/user']` で任意 URL の prefetch を防ぐ (OP の S3 構造は `user{ID}/visual{ID}/...` のみ)
- Cloudflare Cache API でエッジキャッシュ。アセット URL は content hash (`h<32hex>`) を含むので immutable 扱いで良い
- `Vary: Origin` は削除 (ACAO=* なら無関係)
- ストリーム転送 (body をそのまま流用) なので Worker のメモリ消費は小さい
