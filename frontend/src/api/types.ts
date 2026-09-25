// Mirrors the backend's ImageDto (backend/src/images/imageDto.ts).

export type ImageStatus = 'pending' | 'processing' | 'accepted' | 'rejected' | 'failed';

export interface RejectionReason {
  code: string;
  message: string;
}

export interface ImageDto {
  id: string;
  originalFilename: string;
  format: 'jpeg' | 'png' | 'heic' | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReasons: RejectionReason[];
  metrics: {
    blurScore: number | null;
    faceCount: number | null;
    faceHeightRatio: number | null;
  };
  similarToId: string | null;
  urls: {
    thumbnail: string | null;
    processed: string | null;
    original: string | null;
  };
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export type ServerEvent =
  | { type: 'image.updated'; image: ImageDto }
  | { type: 'image.deleted'; id: string }
  | { type: 'resync' };
