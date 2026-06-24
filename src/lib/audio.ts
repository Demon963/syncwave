export interface Song {
  id: string;
  title: string;
  fileData: string;
  mimeType: string;
  duration: number;
  size: number;
  createdAt: number;
  createdBy: string;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function base64ToBlobUrl(base64: string, mimeType: string): string {
  const byteChars = atob(base64);
  const byteNums = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
  return URL.createObjectURL(new Blob([byteNums], { type: mimeType }));
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function generateSongId(base64Data: string): string {
  let hash = 0;
  const str = base64Data.slice(0, 1024);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'song_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
}

export function formatFileSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
