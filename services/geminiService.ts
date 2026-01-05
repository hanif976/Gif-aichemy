import { GoogleGenAI } from "@google/genai";
import { CHROMA_KEY_COLOR } from '../constants';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const generateWithRetry = async (fn: () => Promise<any>, retries = 3, baseDelay = 2000): Promise<any> => {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = error.status === 429 ||
                         error.message?.includes('429') ||
                         error.message?.includes('quota') ||
                         error.message?.includes('exhausted');

    if (retries > 0 && isQuotaError) {
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, 3 - retries) + (Math.random() * 1000);
      console.warn(`Quota hit, retrying in ${Math.round(delay)}ms...`);
      await wait(delay);
      return generateWithRetry(fn, retries - 1, baseDelay);
    }
    throw error;
  }
};

export const editFrameWithGemini = async (
  base64Image: string,
  instruction: string,
  modes: ('recolor' | 'remove-bg')[]
): Promise<string> => {
  const ai = getClient();
  const model = 'gemini-2.5-flash-image'; // Optimized for editing tasks

  let prompt = instruction;
  
  if (modes.includes('remove-bg')) {
    // If removing background, we must ensure we get a chroma keyable background
    prompt += ` Remove the background from the main subject in this image. Replace the background with a solid green color (Hex: ${CHROMA_KEY_COLOR}). Ensure the subject retains its original colors (unless instructed to change) and details. High quality, clear edges.`;
  } else {
    // If NOT removing background, explicitly ask to keep it
    prompt += ` Maintain the background and other details exactly as they are.`;
  }

  // General constraints
  prompt += ` Photorealistic, consistent lighting, no noise. Output only the modified image.`;

  return generateWithRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          },
          { text: prompt }
        ]
      },
    });

    const candidate = response.candidates?.[0];

    // Use strict optional chaining to prevent "reading 'parts' of undefined"
    const parts = candidate?.content?.parts;

    if (!parts || parts.length === 0) {
      if (candidate?.finishReason) {
         throw new Error(`Gemini generation finished with reason: ${candidate.finishReason}`);
      }
      throw new Error("Gemini returned a response with no content parts.");
    }

    // Look for the part with inlineData (the image)
    const imagePart = parts.find(p => p.inlineData);
    
    if (imagePart?.inlineData?.data) {
      return imagePart.inlineData.data;
    }
    
    throw new Error("No image data found in Gemini response.");
  });
};