/**
 * Gemini AI Integration for Floor Plan Analysis
 * Uses Google Gemini API to intelligently parse floor plan images
 */

import type { Wall, Room, Opening, Point, ProcessedFloorPlan, WallType, OpeningType, RoomType } from './shared';
import { DEFAULT_WALL_HEIGHT, generateId } from './shared';

// Gemini API Key
const GEMINI_API_KEY = 'AIzaSyAQ.Ab8RN6Lmgm0ICDAvN5-q2UvmxC7Jibp4t2-PXwWo-6k3JHwwrQ';

interface GeminiAnalysisResult {
  walls: Array<{
    startPoint: Point;
    endPoint: Point;
    thickness: number;
    type: string;
  }>;
  rooms: Array<{
    name: string;
    type: string;
    polygon: Point[];
    area: number;
  }>;
  openings: Array<{
    type: string;
    position: Point;
    width: number;
    height: number;
    wallId?: string;
  }>;
  metadata: {
    scale?: string;
    totalArea?: number;
    roomCount: number;
    wallCount: number;
  };
}

/**
 * Analyze floor plan image using Gemini AI
 */
export async function analyzeFloorPlanWithGemini(
  imageData: string,
  imageWidth: number,
  imageHeight: number,
  timeout: number = 15000
): Promise<GeminiAnalysisResult | null> {
  try {
    console.log('[Gemini] Starting analysis...', { imageWidth, imageHeight });

    // Criar promise com timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert architect analyzing a floor plan image. 

Analyze this floor plan carefully and return a STRICT JSON object with exact structure:

{
  "walls": [
    {
      "startPoint": {"x": number, "y": number},
      "endPoint": {"x": number, "y": number},
      "thickness": number (8-15 for exterior, 5-10 for interior),
      "type": "exterior" | "interior" | "partition"
    }
  ],
  "rooms": [
    {
      "name": "Room Name",
      "type": "living" | "bedroom" | "kitchen" | "bathroom" | "dining" | "office" | "garage" | "utility" | "unknown",
      "polygon": [{"x": number, "y": number}],
      "area": number
    }
  ],
  "openings": [],
  "metadata": {
    "roomCount": number,
    "wallCount": number
  }
}

RULES:
- Return ONLY valid JSON, no markdown, no code blocks
- Coordinates are pixels from top-left corner (0,0)
- Detect at least 4 walls forming a closed shape
- If the image is NOT a floor plan, return empty arrays
- Be precise with coordinates`
            }, {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageData.replace(/^data:image\/\w+;base64,/, '')
              }
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 32,
            topP: 0.95,
            maxOutputTokens: 8192,
          }
        })
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('[Gemini] API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      console.error('[Gemini] Invalid response structure:', JSON.stringify(data).substring(0, 500));
      return null;
    }

    let responseText = data.candidates[0].content.parts[0].text;
    
    // Limpar resposta - remover markdown se presente
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    console.log('[Gemini] Raw response:', responseText.substring(0, 300));

    // Extrair JSON
    let result: GeminiAnalysisResult;
    
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      // Tentar encontrar JSON no texto
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[Gemini] Failed to parse JSON:', parseError);
        console.log('[Gemini] Response text was:', responseText.substring(0, 500));
        return null;
      }
    }

    console.log('[Gemini] Parsed result:', {
      walls: result.walls?.length || 0,
      rooms: result.rooms?.length || 0,
      openings: result.openings?.length || 0
    });

    return result;

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[Gemini] Request timeout after', timeout, 'ms');
    } else {
      console.error('[Gemini] Analysis error:', error.message);
    }
    return null;
  }
}

/**
 * Convert Gemini result to ProcessedFloorPlan
 */
export function convertGeminiResultToPlan(
  geminiResult: GeminiAnalysisResult,
  sourceType: 'image' | 'camera' | 'upload',
  name: string,
  imageWidth: number,
  imageHeight: number
): ProcessedFloorPlan {
  const walls: Wall[] = geminiResult.walls?.map((w, index) => ({
    id: `wall-${index}`,
    startPoint: w.startPoint,
    endPoint: w.endPoint,
    thickness: w.thickness || 10,
    height: DEFAULT_WALL_HEIGHT,
    type: (w.type || 'exterior') as WallType,
  })) || [];

  const rooms: Room[] = geminiResult.rooms?.map((r, index) => ({
    id: `room-${index}`,
    name: r.name || `Room ${index + 1}`,
    type: (r.type || 'unknown') as RoomType,
    polygon: r.polygon || [],
    area: r.area || 0,
    walls: [],
    openings: [],
  })) || [];

  const openings: Opening[] = geminiResult.openings?.map((o, index) => ({
    id: `opening-${index}`,
    type: (o.type || 'door') as OpeningType,
    position: o.position,
    width: o.width || 80,
    height: o.height || 200,
    wallId: o.wallId || '',
    rotation: 0,
  })) || [];

  return {
    id: generateId(),
    name,
    source: {
      type: sourceType,
      dimensions: { width: imageWidth, height: imageHeight },
    },
    scale: {
      pixelsPerUnit: 50,
      unit: 'meters',
    },
    walls,
    rooms,
    openings,
    annotations: [],
    dimensions: [],
    processedAt: new Date(),
    processingDuration: 0,
    confidence: 0.85,
  };
}

/**
 * Hybrid analysis with AI
 */
export async function smartFloorPlanAnalysis(
  imageData: string,
  imageWidth: number,
  imageHeight: number,
  name: string,
  sourceType: 'image' | 'camera' | 'upload'
): Promise<ProcessedFloorPlan | null> {
  console.log('[SmartAnalysis] Starting for:', name);
  
  try {
    // Tentar Gemini com timeout de 15 segundos
    const geminiResult = await analyzeFloorPlanWithGemini(
      imageData,
      imageWidth,
      imageHeight,
      15000
    );
    
    if (geminiResult && geminiResult.walls && geminiResult.walls.length >= 4) {
      console.log('[SmartAnalysis] Gemini found', geminiResult.walls.length, 'walls');
      return convertGeminiResultToPlan(geminiResult, sourceType, name, imageWidth, imageHeight);
    }
    
    console.log('[SmartAnalysis] Gemini did not return enough walls, will use CV fallback');
    return null;
    
  } catch (error) {
    console.error('[SmartAnalysis] Error:', error);
    return null;
  }
}
