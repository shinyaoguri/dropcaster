# 0010: Project v1 を共通保存形式にし、既存編集画面で 3D 練習を提供する

編集可能な実寸部材、Project v2、会場のみの配布は[ADR 0011](0011-measured-venue-authoring.md)で拡張する。

UI配置・入口・3Dの読み込み時期は[ADR 0012](0012-unified-mapping-workspace.md)で更新する。
取り込みを確定する時点は 2026-11-24 に改訂した（「保存・取込」。[#169](https://github.com/shinyaoguri/dropcaster/issues/169)）。

## 状態

採用（2026-11-11）。[0009](0009-3d-practice-contracts.md) の保存最小案を具体化する。
#124 の段階 0〜4 と #117 の共通保存基盤を実装する。#117 の全機能を完了した扱いにはしない。

## 文脈

会場共有には 2D 配置だけでなく、会場モデル、光学条件、作品参照が必要になる。
旧 v2 parser は未知フィールドを落とすため、3D 情報を v2 の直下に追加できない。
また、GLB を含むデータをマウス移動のたびに同期 localStorage へ書くべきではない。

既存ユーザーの操作を維持するため、別の 3D 編集アプリは作らない。#127 で修正済みの
WindowController の状態通知・復旧処理に、3D 消費者を追加する。

## 決定

### 共通 Project

`src/viewer/practice/project.ts` の型・parser と `docs/samples/textured-wall.dropcaster.json` を
形式の正本とする。配置場所は現在の利用側だが、#117 はこの形式と projectStore を再利用する。

| 区分 | v1 の内容 |
|---|---|
| envelope | `format: dropcaster-project`、`schemaVersion: 1`、id/name/createdAt/updatedAt |
| venue | id、単調増加 revision、`layout: MappingsState v2`、scene、projectors |
| scene | sample または glb、assetId、metersPerUnit、position/quaternion/scale、色の乗算 tint |
| projector | outputId、position/quaternion、縦画角、aspect、lensShift、near/far |
| content | local / op / gist / builtin の参照、title、revision、`revisionPinned: false` |
| show | contentIds の順序、intervalSeconds、currentIndex |
| assets | id/name/MIME と base64 GLB。画像・buffer は GLB 内へ埋め込む |

メートル、Y-up、右手系、quaternion の XYZW、lens shift の定義は 0009 に従う。
画角は縦画角のみを正本とし、2D 出力配置の変更・削除で物理姿勢を動かさない。
観察カメラ、選択状態、再生中の stream、復旧状態は runtime に置く。
書出時は端末固有 screen を除き、編集選択は先頭項目へ正規化する。

作品の本体は同梱しない。revision は取得時のメタデータであり、版を固定した保証ではない。
local は開いたギャラリーの catalog から解決する。op/gist は既存の取得経路を使う。
builtin/checkerboard は配布物に内蔵した調整用映像。順序・間隔を含む再開は `/project` で
全参照を解決してから切り替える。取得失敗時に実行中の画面を破棄しない。

### 保存・取込

- IndexedDB `dropcaster.projects` の `projects` store に draft と名前付き Project を保存。
  書込は直列化する。名前・フォームの確定・取り込み・プロジェクタの確定のような離散的な確定は、
  その場で書込を始める。600 ms の末尾 debounce は 2D のドラッグなど連続して届く変更と、
  スライドショーの作品送りに追従する参照の更新だけに残し、止まってから 1 回書く
  （2026-11-16 改訂。[#168](https://github.com/shinyaoguri/dropcaster/issues/168)）。
  容量不足でもメモリ内編集と export を維持する。
- 2D の作業状態は従来の `dropcaster.mappings.v2` を継続する。通常再開時は最新の
  WindowController の 2D 状態を優先し、古い IndexedDB の非同期読込で巻き戻さない。
- 明示 import は schema・有限値・一意 ID・参照・GLB を検証し、検証に成功した時点で全体を適用する。
  検証は WebGL / Three.js を使わない。3D scene は 3D を読み込んでいるときに、適用後の変更を見て
  構築する。構築の失敗（三角形が 0・30 万超、loader の失敗）では取り込みを取り消さず、3D の失敗として
  理由と再試行を出す。2D 編集とプロジェクトの操作は続けられ、取り込み前に戻せる。会場だけの取り込みは、
  受け取る側の作品参照・再生設定を維持する（2026-11-24 改訂。#169。当初は取り込みを 3D のパネルの中で行い、
  3D scene 構築の成功後に適用していた。3D のパネルを作れない環境ではプロジェクトも会場も取り込めなかった）。
  構築（`prepareVenue`）そのものは WebGL を使わないので、取り込みのときだけ Three.js を読み込んで構築まで
  確かめ、失敗なら取り消す形も取れる。ここでは、プロジェクトの操作で Three.js を読み込まないことを選んだ。
  代償: 構築できない会場は 3D を開くまで失敗が分からず、下書きにも保存される。再読み込みの後は
  「取り込み前に戻す」が使えない。読み込んだ会場が 2D 編集の背景に出るのも 3D を読み込んでから。
- 元の v2 JSON は既存 parser を使って取り込み、安全な数値・件数を追加検証する。
  import 前の Project に戻す操作を同じ練習セッション内に用意する。
- GLB は 20 MiB、package は 30 MiB、会場は 30 万三角形まで。静的・非圧縮の GLB を対象にし、
  skin/animation、未対応必須拡張、外部 URI、循環 node、範囲外 buffer を拒否する。
  三角形数は 3D scene の構築時に数えるので、取り込みでは拒否せず 3D の失敗になる。それ以外は取り込みの検証で拒否する。
  基本色と埋込 base-color texture を表示する。PBR の光学的再現は行わない。
- 書込失敗時に保存成功とは表示しない。離散的な確定は即時に保存を始め、保存待ちや書込中が
  残っているときは離脱前に確認を出して知らせる。黙って失わない。再読み込みでは離脱時に始めた
  IndexedDB の書込が完了しないため、pagehide での保存には頼らない（2026-11-16 改訂。#168）。
  OS の強制終了などは対象外で、保存表示の確認と portable package の書出で補う。
  この規則は `/venue` の会場下書きにも同じく適用する。

### UI と寿命

既存 ControlWindow のツール／ソース／マッピングを共用する。ソース欄の下に観察ビュー、
マッピング欄には投影行列と一致する背景を置く。背景・映像透過率は編集 DOM にだけ適用し、
実出力・合成 texture には渡さない。狭い画面ではソースと 3D を上、2D を下に配置する。
スライドショーの送り・停止・間隔は従来の header を表示したまま使う。

WindowController が stream を所有し、実出力と token で登録した練習消費者が共有する。
最後の消費者終了で capture を停止する。preview は借用した track を止めない。
終了・ルート離脱は購読、OrbitControls、video、GPU resources、rAF を解放する。
初期化失敗・context loss 時は 2D・実出力・プロジェクトの操作を残して再試行を提供する。遅延 import / GLB load
の完了には世代確認を入れ、終了後や後発操作の後に古い scene を復活させない。

## 影響

Three.js / GLTFLoader は練習開始時の chunk に分離する。CLI が配る viewer にも必要なので
Three.js は runtime dependency とする。PoC は本体と同じ compositor / renderer を検証する。

初期は対象 output を明示して 1 台分の 3D 投影を確認する。最大 4 台の既存実出力は維持。
複数仮想プロジェクタの同時寄与、作品固定・オフライン、cue・本番制御は別タスクに残す。
