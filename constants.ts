// Max frames to process to avoid hitting API rate limits too hard/long waits
export const MAX_FRAMES = 50; 
// Resize larger GIFs to this width to speed up processing and save tokens
// Increased to 300 to reduce pixelation/shimmer while staying fast
export const MAX_WIDTH = 300; 

// We use a specific color for background removal "chroma key" strategy
// This helps because generative models don't always support RGBA output natively in all formats
export const CHROMA_KEY_COLOR = '#00FF00'; 
export const CHROMA_KEY_RGB = { r: 0, g: 255, b: 0 };