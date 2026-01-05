import { parseGIF, decompressFrames } from 'gifuct-js';
import GIF from 'gif.js';
import { GifFrame } from '../types';
import { CHROMA_KEY_RGB, MAX_WIDTH } from '../constants';

// Worker script for gif.js
const workerBlob = new Blob([`
  importScripts('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js');
`], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);

/**
 * Converts an RGB color value to HSL.
 */
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

/**
 * Converts an HSL color value to RGB.
 */
function hslToRgb(h: number, s: number, l: number) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Parse Hex color to RGB
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Calculate Euclidean distance between two RGB colors
function colorDistance(c1: {r: number, g: number, b: number}, c2: {r: number, g: number, b: number}) {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) + 
    Math.pow(c1.g - c2.g, 2) + 
    Math.pow(c1.b - c2.b, 2)
  );
}

export const parseGifFrames = async (file: File): Promise<GifFrame[]> => {
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);

  const width = (gif as any).lsd.width;
  const height = (gif as any).lsd.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create canvas context");

  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');

  const loadedFrames: GifFrame[] = [];

  frames.forEach((frame) => {
    const patchData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height
    );

    if (patchCtx) {
        patchCanvas.width = frame.dims.width;
        patchCanvas.height = frame.dims.height;
        patchCtx.putImageData(patchData, 0, 0);
        ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    }
    
    loadedFrames.push({
      imageData: ctx.getImageData(0, 0, width, height),
      delay: frame.delay || 100 // Fallback to 100ms if delay is missing or 0
    });

    if (frame.disposalType === 2) {
       ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
  });

  return loadedFrames;
};

export const resizeFrame = (imageData: ImageData, targetWidth: number): ImageData => {
  if (imageData.width <= targetWidth) return imageData;

  const scale = targetWidth / imageData.width;
  const targetHeight = Math.round(imageData.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageData;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return imageData;
  tempCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
};

export const imageDataToBase64 = (imageData: ImageData): string => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Context null");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
};

export interface ProcessingConfig {
    recolorPairs?: { original: string, target: string }[];
    removeBgColor?: string; // The color to treat as "Background" to remove
    bgReplacementColor?: string | null; // The color to replace the background with (null = transparent)
}

/**
 * Advanced local processing for offline mode
 */
export const processFrameLocal = (
  imageData: ImageData, 
  modes: ('recolor' | 'remove-bg')[],
  config: ProcessingConfig
): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageData;
  
  const newImageData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  
  const data = newImageData.data;

  // 1. RECOLOR MODE
  // We use RGB Euclidean distance for better accuracy than Hue matching
  // Improved: We now look for the BEST match (minimum distance) instead of the first match
  if (modes.includes('recolor') && config.recolorPairs && config.recolorPairs.length > 0) {
    const processedPairs = config.recolorPairs.map(p => {
        const originalRGB = hexToRgb(p.original) || {r:0,g:0,b:0};
        const targetRGB = hexToRgb(p.target) || {r:0,g:0,b:0};
        const targetHSL = rgbToHsl(targetRGB.r, targetRGB.g, targetRGB.b);
        return { originalRGB, targetHSL };
    });

    const threshold = 60; // RGB distance threshold

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 10) continue; // Skip transparent

      const currentRGB = {r: data[i], g: data[i+1], b: data[i+2]};

      let bestMatch = null;
      let minDistance = threshold;

      // Check all pairs to find the specific closest color rule
      for (const pair of processedPairs) {
          const dist = colorDistance(currentRGB, pair.originalRGB);

          if (dist < minDistance) {
               minDistance = dist;
               bestMatch = pair;
          }
      }

      // If a valid match was found
      if (bestMatch) {
           const [tH, tS, tL] = bestMatch.targetHSL;
           
           // To preserve shading/texture, we keep the original Luminance (L)
           // and swap the Hue (H) and Saturation (S).
           const [cH, cS, cL] = rgbToHsl(currentRGB.r, currentRGB.g, currentRGB.b);
           
           const newRGB = hslToRgb(tH, tS, cL);
           
           data[i] = newRGB[0];
           data[i + 1] = newRGB[1];
           data[i + 2] = newRGB[2];
      }
    }
  } 
  
  // 2. REMOVE BG MODE
  if (modes.includes('remove-bg')) {
    const bgHex = config.removeBgColor || '#00FF00';
    const replaceHex = config.bgReplacementColor; // can be null (transparent)
    
    const bgRGB = hexToRgb(bgHex) || { r: 0, g: 255, b: 0 }; 
    const replaceRGB = replaceHex ? hexToRgb(replaceHex) : null;

    const tolerance = 60; 

    for (let i = 0; i < data.length; i += 4) {
      // Skip if already fully transparent (handled by previous step maybe?)
      if (data[i+3] === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const diff = Math.sqrt(
        Math.pow(r - bgRGB.r, 2) + 
        Math.pow(g - bgRGB.g, 2) + 
        Math.pow(b - bgRGB.b, 2)
      );

      if (diff < tolerance) {
         if (replaceRGB) {
             // Solid Color Replacement
             data[i] = replaceRGB.r;
             data[i+1] = replaceRGB.g;
             data[i+2] = replaceRGB.b;
             data[i+3] = 255; // Full opacity
         } else {
             // Transparency
             data[i + 3] = 0;
         }
      } else if (diff < tolerance + 20 && !replaceRGB) {
         // Feathering (Only for transparency mode, solid mode feathering needs blending which is complex per pixel)
         const alpha = (diff - tolerance) / 20;
         data[i + 3] = Math.max(0, Math.min(255, data[i+3] * alpha)); 
      }
    }
  }

  ctx.putImageData(newImageData, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

export const createGif = async (
  frames: ImageData[], 
  delays: number[], 
  transparentColor?: number | null // e.g. 0x00FF00
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const gif = new GIF({
      workers: 2,
      quality: 10, 
      workerScript: workerUrl,
      transparent: transparentColor as any
    });

    frames.forEach((frameData, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = frameData.width;
      canvas.height = frameData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.putImageData(frameData, 0, 0);
      
      gif.addFrame(canvas, { delay: delays[index] });
    });

    gif.on('finished', (blob: Blob) => {
      resolve(blob);
    });

    gif.render();
  });
};