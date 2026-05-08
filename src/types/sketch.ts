export interface Sketch {
  id: string;
  title: string;
  description: string;
  path: string;
  type: string;
  tags: string[];
  interactiveElements: string[];
  lastModified: string;
  previewGif?: string; // オプショナルに変更
  sketchUrl?: string; // オリジナルスケッチのURL
  userData?: {
    userId: string;
    userName: string;
    userUrl: string;
    avatarUrl: string;
    avatarFile?: string; // オプショナルに変更
  };
}

export interface SketchService {
  loadSketches(): Promise<Sketch[]>;
  getSketchById(id: string): Sketch | undefined;
  getAllSketches(): Sketch[];
  isReady(): boolean;
}
