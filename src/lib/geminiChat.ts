/**
 * Gemini AI Chat for Floor Plan Refinement
 *
 * Maintains a chat session where:
 * - User uploads an image (or uses parsed structure)
 * - User asks Gemini to modify the structure
 * - Gemini returns updated JSON with walls/rooms
 *
 * API key is read from localStorage (user-configurable in Settings)
 */

const STORAGE_KEY = 'floorvision_gemini_key';

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
- Typical Brazilian house has 8-15 walls. NEVER exceed 30 walls.
- DO NOT detect furniture (beds, sofas, tables) as walls
- DO NOT detect small icons or annotations as walls
- Be CONSERVATIVE — only detect clear walls and rooms

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
  "notes": "Optional: short description"
}

GUIDELINES:
- A "quarto" (bedroom) is typically 9-12 m²
- A "sala" (living room) is typically 15-25 m²
- A "cozinha" (kitchen) is typically 6-12 m²
- A "WC" (bathroom) is typically 2-4 m²
- Standard ceiling height: 2.80m
- Wall thickness: 25cm exterior, 15cm interior
- Brazilian houses typically have 6m x 8m, 8m x 10m, 10m x 12m dimensions

For the WALLS array:
- Include the 4 outer perimeter walls (type: "exterior")
- Include ALL internal walls (type: "interior")
- Order: exterior first, then interior

For the ROOMS array:
- Include EVERY enclosed space, with its polygonal corners
- The polygon should have 4+ points for non-rectangular rooms
- Calculate area in m² (width × height for rectangles)
- Use Portuguese names (Sala, Quarto, Cozinha, WC, etc.) when identifiable`;

const REFINEMENT_PROMPT = `You are helping refine a 3D floor plan. The user gives you an instruction in Portuguese or English.
Apply the instruction to the current structure and return the UPDATED FULL structure.

ALWAYS return the FULL updated structure (not just the changes).
ALWAYS return JSON in the same format as before.

If the user asks to:
- Add a wall: insert into walls[]
- Remove a wall: remove from walls[]
- Add a room: define new room in rooms[]
- Split a room: divide polygon, add internal wall
- Change dimensions: update widthMeters/heightMeters
- Anything else: do your best to interpret and update accordingly`;

interface ChatTurn {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function hasApiKey(): boolean {
  const key = getApiKey();
  return !!key && key.length > 10;
}

export class GeminiChat {
  private history: ChatTurn[] = [];
  private currentPlan: GeminiFloorPlan | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.history = [
      {
        role: 'user',
        parts: [{ text: SYSTEM_PROMPT }],
      },
      {
        role: 'model',
        parts: [{ text: 'Understood. I will return only valid JSON floor plans in the specified format. Send me the image.' }],
      },
    ];
    this.currentPlan = null;
  }

  /**
   * Send an image with optional initial prompt for analysis
   */
  async analyzeImage(
    imageDataUrl: string,
    userHint?: string
  ): Promise<GeminiFloorPlan> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

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

    const rawText = await this.callApi(apiKey);
    const plan = this.extractJson(rawText);

    if (plan && plan.walls && plan.walls.length >= 4) {
      this.currentPlan = plan;
      return plan;
    }
    throw new Error('NO_WALLS_FOUND');
  }

  /**
   * Send a refinement instruction (chat) and get updated plan
   */
  async refine(
    instruction: string
  ): Promise<{ plan: GeminiFloorPlan; reply: string }> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const contextMsg = this.currentPlan
      ? `\n\nCURRENT STRUCTURE:\n${JSON.stringify(this.currentPlan, null, 2)}`
      : '';

    this.history.push({
      role: 'user',
      parts: [{ text: `${REFINEMENT_PROMPT}${contextMsg}\n\nUSER INSTRUCTION: ${instruction}` }],
    });

    const rawText = await this.callApi(apiKey);
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

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private parseDataUrl(url: string): { mime: string; data: string } {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { mime: 'image/jpeg', data: url };
    }
    return { mime: match[1], data: match[2] };
  }

  private async callApi(apiKey: string): Promise<string> {
    // Try multiple models in case the primary is unavailable
    const models = [
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-1.5-flash',
    ];

    let lastError: Error | null = null;
    for (const model of models) {
      try {
        return await this.callApiWithModel(apiKey, model);
      } catch (e: any) {
        lastError = e;
        // Se for erro de chave (400/401) ou spending cap (429), não tenta outros modelos
        if (e.message?.includes('inválida') || e.message?.includes('esgotado')) {
          throw e;
        }
        // Se for 404 ou 503, tenta o próximo modelo
        continue;
      }
    }
    throw lastError || new Error('Todos os modelos Gemini falharam');
  }

  private async callApiWithModel(apiKey: string, model: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
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
        const errData = await response.json().catch(() => ({}));
        const msg = errData.error?.message || `HTTP ${response.status}`;
        if (response.status === 400) {
          throw new Error('Chave da API inválida. Gere uma nova em aistudio.google.com/apikey');
        }
        if (response.status === 429) {
          throw new Error('Limite mensal do projeto esgotado. Aumente em ai.studio/spend ou crie projeto novo.');
        }
        if (response.status === 404) {
          throw new Error(`Modelo ${model} indisponível`);
        }
        if (response.status === 503) {
          throw new Error(`Modelo ${model} sobrecarregado`);
        }
        throw new Error(msg);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Resposta vazia do Gemini');

      this.history.push({
        role: 'model',
        parts: [{ text }],
      });

      return text;
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error('Timeout: Gemini demorou demais para responder');
      }
      throw e;
    }
  }

  private extractJson(text: string): GeminiFloorPlan | null {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Try direct parse
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
    return text.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || 'Estrutura atualizada!';
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
        { start: { x: widthMeters / 2, y: 0 }, end: { x: widthMeters / 2, y: heightMeters }, thickness: 0.15, type: 'interior' },
      ],
      rooms: [
        { name: 'Sala', type: 'living', polygon: [{ x: 0, y: 0 }, { x: widthMeters / 2, y: 0 }, { x: widthMeters / 2, y: heightMeters }, { x: 0, y: heightMeters }], area: (widthMeters * heightMeters) / 2 },
        { name: 'Quarto', type: 'bedroom', polygon: [{ x: widthMeters / 2, y: 0 }, { x: widthMeters, y: 0 }, { x: widthMeters, y: heightMeters }, { x: widthMeters / 2, y: heightMeters }], area: (widthMeters * heightMeters) / 2 },
      ],
      notes: 'Estrutura padrão de fallback',
    };
  }
}

export const geminiChat = new GeminiChat();
