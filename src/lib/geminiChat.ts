/**
 * Gemini AI Chat for Floor Plan Refinement
 *
 * Maintains a chat session where:
 * - User uploads an image (or uses parsed structure)
 * - User asks Gemini to modify the structure
 * - Gemini returns updated JSON with walls/rooms
 *
 * This is the PRIMARY detection method - much more reliable than CV.
 */

const GEMINI_API_KEY = 'AIzaSyAQ.Ab8RN6Lmgm0ICDAvN5-q2UvmxC7Jibp4t2-PXwWo-6k3JHwwrQ';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export interface Wall2D {
  start: { x: number; y: number };
  end: { x: number; y: number };
  thickness: number;
  type: 'exterior' | 'interior' | 'partition';
}

export interface Room2D {
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'dining' | 'office' | 'hall' | 'garage' | 'utility' | 'unknown';
  polygon: { x: number; y: number }[];
  area: number;
}

export interface GeminiFloorPlan {
  walls: Wall2D[];
  rooms: Room2D[];
  widthMeters: number;
  heightMeters: number;
  notes?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  floorPlan?: GeminiFloorPlan;
  imageBase64?: string;
}

const SYSTEM_PROMPT = `You are an expert architectural floor plan analyzer. Your job: identify walls and rooms from images.

CRITICAL RULES:
- A wall is a STRAIGHT line (horizontal or vertical) that forms part of a room boundary
- A room is an ENCLOSED AREA surrounded by walls
- Coordinates are in METERS from the BOTTOM-LEFT corner (0,0 = bottom-left, X grows right, Y grows up)
- Return ONLY valid JSON, no markdown, no explanations outside JSON
- If the floor plan is unclear, return your BEST GUESS as a SIMPLE rectangular structure
- NEVER return 50+ walls. Typical house has 8-15 walls. NEVER exceed 30 walls.
- DO NOT detect furniture (beds, sofas, tables) as walls
- DO NOT detect small icons or annotations as walls

OUTPUT FORMAT (strict JSON, no other text):
{
  "widthMeters": <number>,
  "heightMeters": <number>,
  "walls": [
    {
      "start": {"x": 0, "y": 0},
      "end": {"x": 6, "y": 0},
      "thickness": 0.25,
      "type": "exterior"
    }
  ],
  "rooms": [
    {
      "name": "Sala",
      "type": "living",
      "polygon": [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 4}, {"x": 0, "y": 4}],
      "area": 12
    }
  ],
  "notes": "Optional: short description of what you see"
}

GUIDELINES:
- A "quarto" (bedroom) is typically 9-12 m²
- A "sala" (living room) is typically 15-25 m²
- A "cozinha" (kitchen) is typically 6-12 m²
- A "WC" (bathroom) is typically 2-4 m²
- Standard ceiling height: 2.80m
- Wall thickness: 25cm exterior, 15cm interior
- Brazilian houses typically have 6m x 8m, 8m x 10m, 10m x 12m dimensions`;

const REFINEMENT_PROMPT = `You are helping refine a 3D floor plan. The user will give you an instruction in Portuguese or English.
Apply the instruction to the current structure and return the UPDATED structure.

ALWAYS return the FULL updated structure (not just the changes).
ALWAYS return JSON in the same format as before.

If the user asks to:
- Add a wall: insert the new wall into walls[]
- Remove a wall: remove from walls[]
- Add a room: define new room in rooms[]
- Split a room: divide polygon, add internal wall
- Change dimensions: update widthMeters/heightMeters
- Anything else: do your best to interpret and update accordingly`;

interface ChatTurn {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export class GeminiChat {
  private history: ChatTurn[] = [];
  private currentPlan: GeminiFloorPlan | null = null;

  constructor() {
    this.history.push({
      role: 'user',
      parts: [{ text: SYSTEM_PROMPT }],
    });
    this.history.push({
      role: 'model',
      parts: [{ text: 'Understood. I will return only valid JSON floor plans in the specified format. Send me the image.' }],
    });
  }

  /**
   * Send an image with optional initial prompt for analysis
   */
  async analyzeImage(
    imageDataUrl: string,
    userHint?: string
  ): Promise<GeminiFloorPlan> {
    const { mime, data } = this.parseDataUrl(imageDataUrl);

    const userText = userHint ||
      'Analyze this floor plan image. Return the structure as JSON. Be CONSERVATIVE — only detect clear walls and rooms. Do not over-detect.';

    this.history.push({
      role: 'user',
      parts: [
        { text: userText },
        { inlineData: { mimeType: mime, data } },
      ],
    });

    const result = await this.callApi();
    const plan = this.parseResponse(result);

    if (plan) {
      this.currentPlan = plan;
    }
    return plan || this.simpleFallback();
  }

  /**
   * Send a refinement instruction (chat) and get updated plan
   */
  async refine(
    instruction: string
  ): Promise<{ plan: GeminiFloorPlan; reply: string }> {
    const contextMsg = this.currentPlan
      ? `\n\nCURRENT STRUCTURE:\n${JSON.stringify(this.currentPlan, null, 2)}`
      : '';

    this.history.push({
      role: 'user',
      parts: [{ text: `${REFINEMENT_PROMPT}${contextMsg}\n\nUSER INSTRUCTION: ${instruction}` }],
    });

    const rawText = await this.callApiRaw();
    const plan = this.extractJson(rawText);

    if (plan) {
      this.currentPlan = plan;
    }

    return {
      plan: plan || this.currentPlan || this.simpleFallback(),
      reply: this.extractTextOutsideJson(rawText),
    };
  }

  getCurrentPlan(): GeminiFloorPlan | null {
    return this.currentPlan;
  }

  setCurrentPlan(plan: GeminiFloorPlan): void {
    this.currentPlan = plan;
  }

  reset(): void {
    this.history = this.history.slice(0, 2);
    this.currentPlan = null;
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private parseDataUrl(url: string): { mime: string; data: string } {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      // Not a data URL — assume JPEG
      return { mime: 'image/jpeg', data: url };
    }
    return { mime: match[1], data: match[2] };
  }

  private async callApi(): Promise<string> {
    return this.callApiRaw();
  }

  private async callApiRaw(): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: this.history,
          generationConfig: {
            temperature: 0.1,
            topK: 32,
            topP: 0.95,
            maxOutputTokens: 8192,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');

      // Add model response to history
      this.history.push({
        role: 'model',
        parts: [{ text }],
      });

      return text;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  private parseResponse(rawText: string): GeminiFloorPlan | null {
    return this.extractJson(rawText);
  }

  private extractJson(text: string): GeminiFloorPlan | null {
    // Try direct parse
    try {
      return JSON.parse(text);
    } catch {}

    // Remove markdown
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {}

    // Find JSON object in text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }

  private extractTextOutsideJson(text: string): string {
    return text.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || 'Pronto!';
  }

  /**
   * Fallback rectangle structure when AI fails
   */
  simpleFallback(widthMeters = 6, heightMeters = 8): GeminiFloorPlan {
    return {
      widthMeters,
      heightMeters,
      walls: [
        { start: { x: 0, y: 0 }, end: { x: widthMeters, y: 0 }, thickness: 0.25, type: 'exterior' },
        { start: { x: widthMeters, y: 0 }, end: { x: widthMeters, y: heightMeters }, thickness: 0.25, type: 'exterior' },
        { start: { x: widthMeters, y: heightMeters }, end: { x: 0, y: heightMeters }, thickness: 0.25, type: 'exterior' },
        { start: { x: 0, y: heightMeters }, end: { x: 0, y: 0 }, thickness: 0.25, type: 'exterior' },
        // Internal divider
        { start: { x: widthMeters / 2, y: 0 }, end: { x: widthMeters / 2, y: heightMeters }, thickness: 0.15, type: 'interior' },
      ],
      rooms: [
        { name: 'Sala', type: 'living', polygon: [{ x: 0, y: 0 }, { x: widthMeters / 2, y: 0 }, { x: widthMeters / 2, y: heightMeters }, { x: 0, y: heightMeters }], area: widthMeters * heightMeters / 2 },
        { name: 'Quarto', type: 'bedroom', polygon: [{ x: widthMeters / 2, y: 0 }, { x: widthMeters, y: 0 }, { x: widthMeters, y: heightMeters }, { x: widthMeters / 2, y: heightMeters }], area: widthMeters * heightMeters / 2 },
      ],
      notes: 'Estrutura padrão de fallback (IA offline)',
    };
  }
}

export const geminiChat = new GeminiChat();
