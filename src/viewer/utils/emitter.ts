/**
 * 値を保持する小さな pub/sub。set で値を更新すると購読者へ通知し、
 * get で現在値が取り出せる。新規購読では発火せず、必要なら get → 渡しを呼び出し側が行う。
 *
 * InlineControlHost と WindowController が共有して使う。
 */
export type Listener<T> = (value: T) => void;
export type Unsubscribe = () => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  private value: T;

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    for (const l of this.listeners) {
      try { l(next); } catch (error) { console.error('Emitter: listener エラー', error); }
    }
  }

  /** 値が equal 比較で同じならスキップしたい場合に使う薄い shortcut。 */
  setIfChanged(next: T, equals: (a: T, b: T) => boolean): void {
    if (equals(this.value, next)) return;
    this.set(next);
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
