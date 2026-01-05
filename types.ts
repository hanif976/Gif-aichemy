export enum ProcessingStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  PROCESSING = 'PROCESSING',
  ENCODING = 'ENCODING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface GifFrame {
  imageData: ImageData;
  delay: number;
}

export interface ProcessedFrame {
  blob: Blob;
  delay: number;
}

export interface ProcessingOptions {
  mode: 'recolor' | 'remove-bg';
  targetObject?: string;
  targetColor?: string;
  customPrompt?: string;
  fps?: number;
}
