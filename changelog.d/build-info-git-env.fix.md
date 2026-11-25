linked worktree (`git worktree add`) の git hook の中から `dropcaster build` / `dropcaster dev` / `dropcaster --version` を実行しても、dropcaster 自身の版とコミットを表示するようにした。これまでは、hook を起こしたリポジトリの HEAD を dropcaster のコミットとして表示し、版の番号が消えていた。

git が hook に渡す `GIT_DIR` などの環境変数を、版を調べる git が引き継いでいたのが原因。`GIT_DIR` を自分で設定した環境から実行した場合も同じように直る。
